/**
 * Module for discovering and monitoring devices running the Wasm-IoT
 * supervisor.
 */

const bonjour = require("bonjour-service");
const { DEVICE_DESC_ROUTE, DEVICE_HEALTH_ROUTE, DEVICE_HEALTH_CHECK_INTERVAL_MS, DEVICE_SCAN_DURATION_MS, DEVICE_SCAN_INTERVAL_MS } = require("../constants.js");

const { ORCHESTRATOR_ADVERTISEMENT } = require("./orchestrator.js");

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

        this.deviceScanDuration = DEVICE_SCAN_DURATION_MS;
        this.deviceScanInterval = DEVICE_SCAN_INTERVAL_MS;
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


        // Continuously do new scans for devices in an interval.
        let scanBound = this.startScan.bind(this);
        scanBound(this.deviceScanDuration);
        this.scannerId = setInterval(() => scanBound(this.deviceScanDuration), this.deviceScanInterval);
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
     * Do a scan for devices for a duration of time.
     * @param {*} duration The (maximum) amount of time to scan for devices in
     * milliseconds.
     */
    startScan(duration=10000) {
        console.log("Scanning for devices", this.queryOptions, "...");

        // Do not start again, if already scanning.
        if (this.browser) {
            return;
        }

        // Save browser in order to end its life when required.
        this.browser = this.bonjourInstance.find(this.queryOptions);

        // Binding the callbacks is needed in order to refer to outer "this"
        // instead of the bonjour-browser-"this" inside the callback...
        this.browser.on("up", this.#saveDevice.bind(this));
        this.browser.on("down", this.#forgetDevice.bind(this));

        setTimeout(this.#stopScan.bind(this), duration);
    }

    /**
     * Stop and reset scanning.
     */
    #stopScan() {
        this.browser.stop();
        this.browser = null;

        console.log("Stopped scanning for devices.");
    }

    /**
     * Transform the data of a service into usable device data and query needed
     * additional information like WoT-description and platform.
     * @param {*} serviceData Object containing needed data of the service discovered via mDNS.
     */
    async #saveDevice(serviceData) {
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
            // Transform the service into usable device data.
            device = new Device(serviceData.name, serviceData.addresses, serviceData.port);
            this.deviceCollection.insertOne(device);
        } else {
            if (device.description && device.description.platform) {
                return null;
            }
        }

        return device;
    }

    /**
     * Perform tasks for device introduction.
     *
     * Query device __for 'data'-events__ on its description path and if fails,
     * remove from mDNS-cache.
     * @param {*} device The device to introduce.
     */
    async #deviceIntroduction(device) {
        const handleIntroductionErrorBound = (function handleIntroductionError(errorMsg) {
                // Find and forget the service in question whose advertised
                // host failed to answer to HTTP-GET.
                console.log(" Error in device introduction: ", errorMsg);
                this.#forgetDevice(device.name);
            })
            .bind(this);

        // FIXME: Using first address but might want to try all available.
        let url = new URL(`http://${device.communication.addresses[0]}:${device.communication.port}`);
        url.pathname = device.deviceDescriptionPath || DEVICE_DESC_ROUTE;

        console.log("Querying device description via GET", url.toString());

        let res;
        try {
            res = await fetch(url);
            if (res.status !== 200) {
                handleIntroductionErrorBound(
                    `${JSON.stringify(device.communication, null, 2)} responded ${res.status} ${res.statusText}`
                );
                return;
            }
        } catch (error) {
            handleIntroductionErrorBound(`fetch error with url ${url}: ${error}`);
            return;
        }

        let deviceDescription;
        try {
            // The returned description should follow the common schema for
            // WasmIoT TODO Perform validation.
            deviceDescription = await res.json();
        } catch (error) {
            handleIntroductionErrorBound(`description JSON is malformed: ${error}`);
            return;
        }

        this.deviceCollection.updateOne({ name: device.name }, { $set: { description: deviceDescription } });

        console.log(`Added description for device '${device.name}'`);

        // Do an initial health check on the new device.
        this.healthCheck(device.name);
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

        let date = new Date();
        let healthChecks = devices.map(x => ({
                device: x.name,
                // Gather promises to be awaited.
                check: this.#healthCheckDevice(x),
                timestamp: date,
            }));

        let healthyCount = 0;
        for (let x of healthChecks) {
            let health;
            try {
                health = await x.check;
                healthyCount++;
            } catch (e) {
                console.log(
                    `Forgetting device with health problems (device: ${x.device}, timestamp: ${x.timestamp.toISOString()}):`, e.message
                );
                this.#forgetDevice(x.device);
                continue;
            }

            this.deviceCollection.updateOne(
                { name: x.device },
                {
                    $set: {
                        health: {
                            report: health,
                            timeOfQuery: x.timestamp,
                        }
                    }
                }
            );
        }
        return healthyCount;
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
        let url = new URL(`http://${device.communication.addresses[0]}:${device.communication.port}/${device.healthCheckPath || DEVICE_HEALTH_ROUTE}`);
        let res = await fetch(url);

        if (res.status !== 200) {
            throw `${url.toString()} responded ${res.status} ${res.statusText}`
        }

        return res.json();
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
