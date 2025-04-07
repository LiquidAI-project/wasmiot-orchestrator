/**
 * Module for discovering and monitoring devices running the Wasm-IoT
 * supervisor.
 */

const bonjour = require("bonjour-service");
const { DEVICE_DESC_ROUTE, DEVICE_HEALTH_ROUTE, DEVICE_HEALTH_CHECK_INTERVAL_MS, PUBLIC_BASE_URI, DEVICE_HEALTHCHECK_FAILED_THRESHOLD } = require("../constants.js");

const { ORCHESTRATOR_ADVERTISEMENT } = require("./orchestrator.js");
const failedHealthCheckCounts = {};

/**
 * Thing running the Wasm-IoT supervisor.
 */
class Device {
    constructor(name, addresses, port, supervisorInterfaces) {
        // Devices are identified by their "fully qualified" name.
        this.name = name,
        this.communication = {
            addresses: addresses,
            port: port,
        };
        // This is set by querying the device later.
        this.description = {
            supervisorInterfaces: supervisorInterfaces
        };
    }
}

/**
 * Interface to list available devices and send them messages.
 *
 * "Device" is used as a term for a thing running the Wasm-IoT supervisor.
 *
 * Uses mDNS for discovering devices.
 */
class DeviceManager {
    /**
     * Initialize fields needed in querying for IoT-devices.
     * @param type The type of mDNS service to search for.
     * @param database Reference to the database to save devices into.
     */
    constructor(type, database) {
        if (!type || !database) {
            throw "device type or database missing from device discovery constructor!";
        }
        this.bonjourInstance = new bonjour.Bonjour();
        this.browser = null;
        this.deviceCollection = database.collection("device");
        this.queryOptions = { type };

        this.deviceHealthCheckInterval = DEVICE_HEALTH_CHECK_INTERVAL_MS;
    }

    /**
     * Start browsing for the services and save their descriptions to database as
     * needed. Also set handling when a "well behaving" device leaves the
     * discovery's reach.
     */
    startDiscovery() {
        // NOTE: Start advertising orchestrator's core services to "itself", so
        // that it passes through the same pipeline and shows up as any other
        // supervisor would.
        this.orchestratorAdvertiser = new bonjour.Bonjour();
        this.orchestratorAdvertiser.publish(ORCHESTRATOR_ADVERTISEMENT);

        // Continuously scan for devices
        this.startScan();

        // Check the status of the services every 2 minutes. (NOTE: This is
        // because the library used does not seem to support re-querying the
        // services on its own).
        let healthCheckBound = this.healthCheck.bind(this);
        this.healthCheckId = setInterval(
            async () => {
                let healthyCount = await healthCheckBound();
                console.log((new Date()).toISOString(), "# of healthy devices:", healthyCount);
            },
            this.deviceHealthCheckInterval
        );
    }

    /**
     * Start a continuous scan for devices.
     */
    async startScan() {
        console.log("Scanning for devices", this.queryOptions, "...");

        // Save browser in order to end its life when required.
        this.browser = this.bonjourInstance.find(this.queryOptions);

        // Binding the callbacks is needed in order to refer to outer "this"
        // instead of the bonjour-browser-"this" inside the callback...
        this.browser.on("up", this.saveDevice.bind(this));
        this.browser.on("down", this.#forgetDevice.bind(this));

        this.browser.start();
    }

    /**
     * Transform the data of a service into usable device data and query needed
     * additional information like WoT-description and platform.
     * @param {*} serviceData Object containing needed data of the service discovered via mDNS.
     */
    async saveDevice(serviceData) {
        console.log("Service found:", serviceData);
        let newDevice = await this.#addNewDevice(serviceData);
        // Check for duplicate or unknown (i.e., non-queried) device.
        if (!newDevice) {
            console.log(`Service '${serviceData.name}' is already known!`);
            return;
        }

        this.#deviceIntroduction(newDevice);
    }

    /**
     * Based on found service, create a device entry of it if the device is not
     * already known.
     * @param {*} serviceData
     * @returns The device entry created or null if the device is already fully
     * known.
     */
    async #addNewDevice(serviceData) {
        let device = await this.deviceCollection.findOne({ name: serviceData.name });
        if (!device) {
            // Add the address from txt field to the address list if it is not already there.
            // (The supervisors should set this field to correspond to the device's address.)
            if (
                serviceData.txt && serviceData.txt.address &&
                !serviceData.addresses.includes(serviceData.txt.address)
            ) {
                serviceData.addresses.push(serviceData.txt.address);
            }

            // Transform the service into usable device data.
            device = new Device(serviceData.name, serviceData.addresses, serviceData.port);
            device.status = "active";
            this.deviceCollection.insertOne(device);
        } else {
            if (device.description && device.description.platform) {
                return null;
            }
        }

        return device;
    }

    async handleDeviceIntroduction(device, address) {
        const reportIntroductionErrorBound = (function reportIntroductionError(errorMsg) {
                console.log(" Error in device introduction: ", errorMsg);
            });

        let url = null;
        try {
            url = new URL(`http://${address}:${device.communication.port}`);
            url.pathname = device.deviceDescriptionPath || DEVICE_DESC_ROUTE;
        } catch (error) {
            reportIntroductionErrorBound(`Invalid URL for device description: ${error}`);
            return false;
        }

        console.log("Querying device description via GET", url.toString());

        let res;
        try {
            res = await fetch(url);
            if (res.status !== 200) {
                reportIntroductionErrorBound(
                    `${JSON.stringify(device.communication, null, 2)} responded ${res.status} ${res.statusText}`
                );
                return false;
            }
        } catch (error) {
            reportIntroductionErrorBound(`fetch error with url ${url}: ${error}`);
            return false;
        }

        let deviceDescription;
        try {
            // The returned description should follow the common schema for
            // WasmIoT TODO Perform validation.
            deviceDescription = await res.json();
        } catch (error) {
            reportIntroductionErrorBound(`description JSON is malformed: ${error}`);
            return false;
        }

        this.deviceCollection.updateOne({ name: device.name }, { $set: { description: deviceDescription } });

        return true;
    }

    /**
     * Perform tasks for device introduction.
     *
     * Query device __for 'data'-events__ on its description path and if fails,
     * remove from mDNS-cache.
     * @param {*} device The device to introduce.
     */
    async #deviceIntroduction(device) {
        for (let address of device.communication.addresses) {
            const deviceIntroductionSuccess = await this.handleDeviceIntroduction(
                device,
                address
            );
            if (deviceIntroductionSuccess) {
                console.log(`Added description for device '${device.name}'`);

                // Do an initial health check on the new device.
                this.healthCheck(device.name);
                return;
            }
        }
        // If no address worked, then forget the device.
        console.log(`No address worked for device '${device.name}', forgetting it.`);
        this.#forgetDevice(device.name);
    }

    async registerOrchestratorUrl(device) {
        // Register the public URL of the orchestrator to the discovered device.
        for (let address of device.communication.addresses) {
            let check = await this.#registerOrchestratorUrlToDevice(device, address);
            if (check) {
                return;
            }
        }
    }

    async #registerOrchestratorUrlToDevice(device, address) {
        // Register the public URL of the orchestrator to the discovered device.
        // An error here is not considered fatal, so only output the result to console.
        try {
            let url = new URL(`http://${address}:${device.communication.port}`);
            url.pathname = "register";
            console.log(`Registering orchestrator URL with device (${device.name})`);
            let registerResponse = await fetch(url, {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({ url: PUBLIC_BASE_URI.slice(0, -1) }),
            })
            if (registerResponse.status !== 200) {
                console.log(`Error registering orchestrator URL (${device.name}): (${registerResponse.status}) ${registerResponse.statusText}`);
            }
        } catch (error) {
            console.log(`Error registering orchestrator URL (${device.name}): ${error}`);
        }
    }

    /**
     * Stop and clean up the device discovery process and currently active
     * callbacks for device health.
     */
    destroy() {
        clearInterval(this.scannerId);
        this.scannerId = null;

        clearInterval(this.healthCheckId);
        this.healthCheckId = null;

        this.bonjourInstance.destroy();
    }

    /**
     * Check and update "health" of currently known devices.
     * TODO: This should be restful in that the one running in interval should
     * not clash with direct calls.
     * @param {*} deviceName Identifying name of the device to check. If not
     * given, check all.
     */
    async healthCheck(deviceName) {
        let devices = await (await this.deviceCollection.find(deviceName ? { name: deviceName } : {})).toArray();

        let healthyCount = 0;
        for (let device of devices) {
            try {
                const healthCheck = await this.successfulHealthCheck(device);
                await this.deviceCollection.updateOne(
                    { name: device.name },
                    { $set:
                        {
                            status: "active",
                            health:
                            {
                                report: healthCheck.result,
                                timeOfQuery: healthCheck.timestamp,
                            }
                        }
                    }
                );
                healthyCount++;
            }
            catch (e) {
                await this.unsuccessfulHealthCheck(device);
                await this.deviceCollection.updateOne(
                    { name: device.name },
                    {
                        $set: { status: "inactive" }
                    }
                );
            }
        }
         
        return healthyCount;
    }

    async successfulHealthCheck(device) {
        const date = new Date();
        const checkResult = await this.#healthCheckDevice(device);
        failedHealthCheckCounts[device.name] = 0; // Reset failed health check count on successful health check
        console.log('Health check count for device', device.name, 'reseted.');
        
        return {
            result: checkResult,
            timestamp: date,
        }
    }

    async unsuccessfulHealthCheck(device) {
        if (DEVICE_HEALTHCHECK_FAILED_THRESHOLD <= failedHealthCheckCounts[device.name]) {
            console.log(`Device '${device.name}' remains inactive...`);
            return;
        }

        failedHealthCheckCounts[device.name] = (failedHealthCheckCounts[device.name] || 0) + 1;
        console.log('Health check failed for device', device.name, ', the count is:', failedHealthCheckCounts[device.name]);

        if (DEVICE_HEALTHCHECK_FAILED_THRESHOLD <= failedHealthCheckCounts[device.name]) {
            console.log(`Setting device '${device.name}' to inactive due to repeated health check failures.`);
            //TODO: Tarkista onko laitetta käytetty deploymenteissa
            //TODO: Logit databaseen active/inactive tilaan mennessä    
        }
        else {
            console.log(`Incrementing failed health check count for device '${device.name}' (count: ${failedHealthCheckCounts[device.name]}).`);
        }
    }

    /**
     * Forget a device based on an identifier or one derived from mDNS service data.
     * @param {*} x The string-identifier or service data (i.e., name) of the
     * device to forget.
     */
    #forgetDevice(x) {
        let name = null;
        if (typeof x === "string") {
            name = x;
        } else {
            console.log(`Service '${x.name}' seems to have emitted 'goodbye'`);
            // Assume the service data from mDNS is used to remove a device.
            name = x.name;
        }

        this.deviceCollection.deleteOne({ name: name });
    }


    /**
     * Query the device for health
     * @param {*} device The device to query.
     * @throws If there were error querying the device.
     */
    async #healthCheckDevice(device) {
        const healthCheckPath = device.healthCheckPath || DEVICE_HEALTH_ROUTE.substring(1);
        const public_ip = new URL(PUBLIC_BASE_URI).hostname;
        let failedAddresses = [];

        for (let address of device.communication.addresses) {
            try {
                let url = new URL(`http://${address}:${device.communication.port}/${healthCheckPath}`);
                let res = await fetch(url, {headers: {"X-Forwarded-For": public_ip}})

                if (res.status !== 200) {
                    console.log(`Health-check for device '${device.name}' using address '${address}' failed: ${res.status} ${res.statusText}`);
                    continue;
                }
                else if (device.name !== "orchestrator") {
                    const orchestratorHeader = res.headers.get("Custom-Orchestrator-Set");
                    if (orchestratorHeader !== "true") {
                        console.log("Orchestrator URL not set for device", device.name);
                        this.registerOrchestratorUrl(device);
                    }
                }

                if (failedAddresses.length > 0) {
                    // Since we got a successful response, we can remove the failed addresses from the device.
                    device.communication.addresses = device.communication.addresses.filter(
                        addr => !failedAddresses.includes(addr)
                    );
                    this.deviceCollection.updateOne(
                        { name: device.name },
                        { $set: { communication: device.communication } }
                    );
                }
                return res.json();
            }
            catch (error) {
                console.log(`Health-check failed for device '${device.name}' using address '${address}': ${error}`);
                failedAddresses.push(address);
                console.log(errorString);
                throw error;
            }
        }

        // If all addresses failed, return false
        return false;
    }
}

class MockDeviceDiscovery {
    /**
     * A fully queried device.
     */
    static mockDevice = new Device(
        "a",
        ["localhost"],
        8080,
        []
    );

    constructor(type, database) {
        this.database = database;
    }

    startDiscovery() {
        console.log("Running mock device discovery...");

        console.log("Adding mock device:", MockDeviceDiscovery.mockDevice);
        this.database.update("device", {}, MockDeviceDiscovery.mockDevice);
    }

    destroy() { console.log("Destroyed mock device discovery."); };
}

module.exports = {
    DeviceDiscovery: DeviceManager,
    MockDeviceDiscovery,
    Device,
};
