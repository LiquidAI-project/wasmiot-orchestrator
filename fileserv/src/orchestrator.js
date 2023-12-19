const fs = require("fs");

const { ObjectId } = require("mongodb");

const constants = require("../constants.js");
const utils = require("../utils.js");


class DeviceNotFound extends Error {
    constructor(dId) {
        super("device not found");
        this.name = "DeviceNotFound";
        this.device = { id: dId };
    }
}

class ParameterMissing extends Error {
    constructor(dId, execPath, param) {
        super("parameter missing");
        this.name = "ParameterMissing";
        this.deployment = { id: dId };
        this.execPath = execPath;
        this.param = param;
    }
}

class DeploymentFailed extends Error {
    constructor(combinedResponse) {
        super("deployment failed");
        this.combinedResponse = combinedResponse;
        this.name = "DeploymentFailed";
    }
}


class MountPathFile {
    constructor(path, mediaType, stage) {
        this.path = path;
        this.media_type = mediaType;
        this.stage = stage;
    }

    static listFromMultipart(multipartMediaTypeObj) {
        const mediaType = multipartMediaTypeObj.media_type;
        if (mediaType !== 'multipart/form-data') {
            throw new Error(`Expected multipart/form-data media type, but got "${mediaType}"`);
        }

        const schema = multipartMediaTypeObj.schema;
        if (schema.type !== 'object') {
            throw new Error('Only object schemas supported');
        }
        if (!schema.properties) {
            throw new Error('Expected properties for multipart schema');
        }

        const mounts = [];
        const encoding = multipartMediaTypeObj.encoding;
        for (const [path, _] of getSupportedFileSchemas(schema, encoding)) {
            const mediaType = encoding[path]['contentType'];
            // NOTE: The other encoding field ('format') is not regarded here.
            const mount = new MountPathFile(path, mediaType);
            mounts.push(mount);
        }

        return mounts;
    }
}

    function* getSupportedFileSchemas(schema, encoding) {
        for (const [path, property] of Object.entries(schema.properties)) {
            if (property.type === 'string' && property.format === 'binary') {
                if (encoding[path] && encoding[path]['contentType']) {
                    yield [path, property];
                }
            }
        }
    }
/**
 * Fields for instruction about reacting to calls to modules and functions on a
 * device.
 */
class Instructions {
    constructor() {
        this.modules = {};
    }

    add(moduleName, funcName, instruction) {
        if (!this.modules[moduleName]) {
            this.modules[moduleName] = {};
        }
        // Initialize each function to match to an
        // instruction object. NOTE: This makes it so that each function in a
        // module can only be chained to one function other than itself (i.e. no
        // recursion).
        this.modules[moduleName][funcName] = instruction;
    }
}

/**
 * Struct for storing information that a single node (i.e. a device) needs for
 * deployment.
 */
class DeploymentNode {
    constructor(deploymentId) {
        // Used to separate similar requests between deployments at
        // supervisor.
        this.deploymentId = deploymentId;
        // The modules the device needs to download.
        this.modules = [];
        // Mapping of functions to endpoints for "transparent" RPC-calls _to_
        // this node. Endpoints that the node exposes to others.
        this.endpoints = {};
        // Chaining of results to others.
        this.instructions = new Instructions();
        // Mounts needed for the module's functions.
        this.mounts = {};
    }
}

/**
 * Core interface and logic of orchestration functionality.
 */
class Orchestrator {
    /**
    * @param {*} dependencies Things the orchestrator logic can't do without.
    * @param {*} options Options with defaults for orchestrator to use. Possible
    * properties are:
    * - packageManagerBaseUrl The base of the package manager server address for
    * devices to pull modules from.
    */
    constructor(dependencies, options) {
        let database = dependencies.database;
        this.deviceCollection = database.collection("device");
        this.moduleCollection = database.collection("module");
        this.deploymentCollection = database.collection("deployment");

        this.packageManagerBaseUrl = options.packageManagerBaseUrl || constants.PUBLIC_BASE_URI;
        if (!options.deviceMessagingFunction) {
            throw new utils.Error("method for communicating to devices not given");
        }
        this.messageDevice = options.deviceMessagingFunction;
    }

    async solve(manifest, resolving=false) {
        // Gather the devices and modules attached to deployment in "full"
        // (i.e., not just database IDs).
        let availableDevices = await (await this.deviceCollection.find()).toArray();
        // The original deployment should be saved to database as is with the
        // IDs TODO: Exactly why should it be saved?.
        let hydratedManifest = structuredClone(manifest);
        for (let step of hydratedManifest.sequence) {
            step.device = availableDevices.find(x => x._id.toString() === step.device);
            // Find with id or name to support finding core modules more easily.
            let filter = {};
            try {
                filter._id = ObjectId(step.module)
            } catch (e) {
                console.error(`Passed in module-ID '${step.module}' not compatible as ObjectID. Using it as 'name' instead`);
                filter.name = step.module;
            }

            // Fetch the modules from remote URL similarly to how Docker fetches
            // from registry/URL if not found locally.
            // TODO: Actually use a remote-fetch.
            step.module = await this.moduleCollection.findOne(filter);
        }

        //TODO: Start searching for suitable packages using saved file.
        //startSearch();

        let assignedSequence = fetchAndFindResources(hydratedManifest.sequence, availableDevices);

        // Now that the deployment is deemed possible, an ID is needed to
        // construct the instructions on devices.
        let deploymentId;
        if (resolving) {
            deploymentId = manifest._id;
        } else {
            deploymentId = (await this.deploymentCollection.insertOne(manifest)).insertedId;
        }

        let solution = createSolution(deploymentId, assignedSequence, this.packageManagerBaseUrl)

        // Update the deployment with the created solution.
        this.deploymentCollection.updateOne(
            { _id: ObjectId(deploymentId) },
            { $set: solution }
        );

        return resolving ? solution : deploymentId;
    }

    async deploy(deployment) {
        let deploymentSolution = deployment.fullManifest;

        let requests = [];
        for (let [deviceId, manifest] of Object.entries(deploymentSolution)) {
            let device = await this.deviceCollection.findOne({ _id: ObjectId(deviceId) });

            if (!device) {
                throw new DeviceNotFound("", deviceId);
            }

            // Start the deployment requests on each device.
            requests.push([deviceId, this.messageDevice(device, "/deploy", manifest)]);
        }

        // Return devices mapped to their awaited deployment responses.
        let deploymentResponse = Object.fromEntries(await Promise.all(
            requests.map(async ([deviceId, request]) => {
                // Attach the device information to the response.
                let response = await request;
                return [deviceId, response];
            })
        ));

        if (!deploymentResponse) {
            throw new DeploymentFailed(deploymentResponse);
        }

        return deploymentResponse;
    }

    /**
     * Start the execution of a deployment with inputs.
     * @param {*} deployment The deployment to execute.
     * @param {*} {body, files} The inputs to the deployment. Includes local
     * system filepaths as well.
     * @returns Promise of the response from the first device in the deployment
     * sequence.
     */
    async schedule(deployment, { body, files }) {
        // Pick the starting point based on sequence's first device and function.
        const { url, path, method, request } = utils.getStartEndpoint(deployment);

        // OpenAPI Operation Object's parameters.
        for (let param of request.parameters) {
            if (!(param.name in body)) {
                throw new ParameterMissing(deployment._id, path, param);
            }

            let argument = body[param.name];
            switch (param.in) {
                case "path":
                    path = path.replace(param.name, argument);
                    break;
                case "query":
                    url.searchParams.append(param.name, argument);
                    break;
                default:
                    throw `parameter location not supported: '${param.in}'`;
            }
        }
        // NOTE: The URL should not contain any path before this point.
        url.pathname = path;

        let options = { method: method };

        // Request with GET/HEAD method cannot have body.
        if (!(["get", "head"].includes(method.toLowerCase()))) {
            // OpenAPI Operation Object's requestBody (including files as input).
            if (request.request_body) {
                let formData = new FormData();
                for (let { path, name } of files) {
                    formData.append(name, new Blob([fs.readFileSync(path)]));
                }
                options.body = formData;
            } else {
                options.body = { foo: "bar" };
            }
        }

        // Message the first device and return its reaction response.
        return fetch(url, options);
    }
}

/**
 * Solve for M2M-call interfaces and create individual instructions
 * (deployments) to send to devices.
 * @param {*} deploymentId The deployment ID is used to identify received POSTs
 * on devices regarding this deployment.
 * @returns The created solution.
 * @throws An error if building the solution fails.
 */
function createSolution(deploymentId, sequence, packageBaseUrl) {
    let deploymentsToDevices = {};
    for (let step of sequence) {
        let deviceIdStr = step.device._id.toString();

        // __Prepare__ to make a mapping of devices and their instructions in order to
        // bulk-send the instructions to each device when deploying.
        if (!(deviceIdStr in deploymentsToDevices)) {
            deploymentsToDevices[deviceIdStr] = new DeploymentNode(deploymentId);
        }

        // Add module needed on device.
        let moduleDataForDevice = moduleData(step.module, packageBaseUrl);
        deploymentsToDevices[deviceIdStr].modules.push(moduleDataForDevice);

        // Add needed endpoint to call function in said module on the device.
        let funcPathKey = utils.supervisorExecutionPath(step.module.name, step.func);
        let moduleEndpointTemplate = step.module.description.paths[funcPathKey];

        // Build the __SINGLE "MAIN" OPERATION'S__ parameters for the request
        // according to the description.
        const OPEN_API_3_1_0_OPERATIONS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];
        let methods = Object.keys(moduleEndpointTemplate)
            .filter((method) => OPEN_API_3_1_0_OPERATIONS.includes(method.toLowerCase()));
        console.assert(methods.length === 1, "expected one and only one operation on an endpoint");
        let method = methods[0];

        let [responseMediaType, responseObj] = Object.entries(moduleEndpointTemplate[method].responses[200].content)[0];
        let requestBody = moduleEndpointTemplate[method].requestBody;
        let [requestMediaType, requestObj] = [undefined, undefined];
        if (requestBody != undefined) {
            [requestMediaType, requestObj] = Object.entries(requestBody.content)[0];
        }

        // Create the module object if this is the first one.
        if (!(step.module.name in deploymentsToDevices[deviceIdStr].endpoints)) {
            deploymentsToDevices[deviceIdStr]
                .endpoints[step.module.name] = {};
        }

        let endpoint = {
            // TODO: Hardcodedly selecting first(s) from list(s) and
            // "url" field assumed to be template "http://{serverIp}:{port}".
            // Should this instead be provided by the device or smth?
            url: step.module.description.servers[0].url
                .replace("{serverIp}", step.device.communication.addresses[0])
                .replace("{port}", step.device.communication.port),
            path: funcPathKey.replace("{deployment}", deploymentId),
            method: method,
            request: {
                parameters: moduleEndpointTemplate[method].parameters,
            },
            response: {
                media_type: responseMediaType,
                schema: responseObj?.schema
            }
        };
        if (requestObj) {
            endpoint.request.request_body = {
                media_type: requestMediaType,
                schema: requestObj?.schema,
                encoding: requestObj?.encoding
            };
        }

        // Finally add mounts needed for the module's functions.
        if (!(step.module.name in deploymentsToDevices[deviceIdStr].mounts)) {
            deploymentsToDevices[deviceIdStr].mounts[step.module.name] = {};
        }

        deploymentsToDevices[deviceIdStr].mounts[step.module.name][step.func] =
            mountsFor(step.module, step.func, endpoint);

        deploymentsToDevices[deviceIdStr]
            .endpoints[step.module.name][step.func] = endpoint;
    }

    // It does not make sense to have a device without any possible
    // interaction (and this would be a bug).
    let unnecessaryDevice = Object.entries(deploymentsToDevices)
        .find(([_, x]) => Object.entries(x.endpoints).length === 0);
    if (unnecessaryDevice) {
        return `no endpoints defined for device '${unnecessaryDevice[0]}'`;
    }

    // According to deployment manifest describing the composed
    // application-calls, create a structure to represent the expected behaviour
    // and flow of data between nodes.
    for (let i = 0; i < sequence.length; i++) {
        const [device, modulee, func] = Object.values(sequence[i]);

        let deviceIdStr = device._id.toString();

        let forwardFunc = sequence[i + 1]?.func;
        let forwardDeviceIdStr = sequence[i + 1]?.device._id.toString();
        let forwardDeployment = deploymentsToDevices[forwardDeviceIdStr];

        let forwardEndpoint;
        if (forwardFunc === undefined || forwardDeployment === undefined) {
            forwardEndpoint = null;
        } else {
            // The order of endpoints attached to deployment is still the same
            // as it is based on the execution sequence and endpoints are
            // guaranteed to contain at least one item.
            let forwardModuleId = sequence[i + 1]?.module.name;
            forwardEndpoint = forwardDeployment.endpoints[forwardModuleId][forwardFunc];
        }

        // This is needed at device to figure out how to interpret WebAssembly
        // function's result.
        let sourceEndpoint = deploymentsToDevices[deviceIdStr].endpoints[modulee.name][func];

        let instruction = {
            from: sourceEndpoint,
            to: forwardEndpoint,
        };

        // Attach the created details of deployment to matching device.
        deploymentsToDevices[deviceIdStr].instructions.add(modulee.name, func, instruction);
    }

    let sequenceAsIds = Array.from(sequence)
        .map(x => ({
            device: x.device._id,
            module: x.module._id,
            func: x.func
        }));

    return {
        fullManifest: deploymentsToDevices,
        sequence: sequenceAsIds
    };
}

MountStage = {
    DEPLOYMENT: "deployment",
    EXECUTION: "execution",
    OUTPUT: "output",
};

/**
 * Save the list of mounts for each module in advance. This makes them
 * ready for actually "mounting" (i.e. creating files in correct
 * directory) at execution time.
 *
 * NOTE: Using the "endpoints" as the source for modules and function
 * names, as the WebAssembly modules are not instantiated at this point
 * and might contain functions not intended for explicitly running (e.g.
 * custom 'alloc()' or WASI-functions).
 */
function mountsFor(modulee, func, endpoint) {
    // Grouped by the mount stage, get the sets of files to be mounted for the
    // module's function and whether they are mandatory or not.

    // TODO: When the component model is to be integrated, map arguments in
    // request to the interface described in .wit.

    request = endpoint.request;
    response = endpoint.response;
    let request_body_paths = [];
    if (request.request_body && request.request_body.media_type === 'multipart/form-data') {
        request_body_paths = MountPathFile.listFromMultipart(request.request_body);
        // Add the stage accordingly.
        for (let request_body_path of request_body_paths) {
            request_body_path.stage = modulee.mounts[func][request_body_path.path].stage
        }
    }

    // Check that all the expected media types are supported.
    let found_unsupported_medias = request_body_paths.filter(x => !constants.FILE_TYPES.includes(x.media_type));
    if (found_unsupported_medias.length > 0) {
        throw new Error(`Input file types not supported: "${found_unsupported_medias}"`);
    }

    // Get a list of expected file parameters. The 'name' is actually
    // interpreted as a path relative to module root.
    let param_files = request.parameters
        .filter(parameter => parameter.in === 'requestBody' && parameter.name !== '')
        .map(parameter =>
            new MountPathFile(parameter.name, 'application/octet-stream', MountStage.EXECUTION)
        );

    // Lastly if the _response_ contains files, the matching filepaths need
    // to be made available for the module to write as well.
    let response_files = [];
    if (response.media_type === 'multipart/form-data') {
        response_files = MountPathFile.listFromMultipart(response.response_body);
    } else if (constants.FILE_TYPES.includes(response.media_type)) {
        let outputMount = Object.entries(
                modulee.mounts[func]
            ).find(([_, mount]) => mount.stage === MountStage.OUTPUT);
        if (!outputMount) {
            throw `output mount of '${response.media_type}' expected but is missing`;
        }
        let path = outputMount[0];
        response_files = [new MountPathFile(path, response.media_type, MountStage.OUTPUT)]
    }
    // Add the output stage and required'ness to all these.
    for (let response_file of response_files) {
        response_file.stage = MountStage.OUTPUT;
    }

    let mounts = [...param_files, ...request_body_paths, ...response_files];

    // TODO: Use groupby instead of this triple-set-threat.
    let execution_stage_mount_paths = mounts.filter(y => y.stage === MountStage.EXECUTION);
    let deployment_stage_mount_paths = mounts.filter(y => y.stage === MountStage.DEPLOYMENT);
    let output_stage_mount_paths = mounts.filter(y => y.stage === MountStage.OUTPUT);

    return {
        [MountStage.EXECUTION]: execution_stage_mount_paths,
        [MountStage.DEPLOYMENT]: deployment_stage_mount_paths,
        [MountStage.OUTPUT]: output_stage_mount_paths,
    };
}

/**
 * Based on deployment sequence, confirm the existence (funcs in modules) and
 * availability (devices) of needed resources and select most suitable ones if
 * so chosen.
 * @param {*} sequence List (TODO: Or a graph ?) of calls between devices and
 * functions in order.
 * @returns The same sequence but with intelligently selected combination of
 * resources [[device, module, func]...] as Objects. TODO: Throw errors if fails
 * @throws String error if validation of given sequence fails.
 */
function fetchAndFindResources(sequence, availableDevices) {
    let selectedModules = [];
    let selectedDevices = [];

    // Fetch the orchestrator device in advance if there are any core modules
    // to be used.
    let orchestratorDeviceIdx = availableDevices.findIndex(x => x.name === "orchestrator");
    let orchestratorDevice = availableDevices[orchestratorDeviceIdx];
    // At the same time, remove the orchestrator from the list of available
    // devices (i.e., Wasm-workloads shouldn't be possible to be deployed on
    // orchestrator).
    availableDevices.splice(orchestratorDeviceIdx, 1);

    // Iterate all the items in the request's sequence and fill in the given
    // modules and devices or choose most suitable ones.
    for (let [device, modulee, funcName] of sequence.map(Object.values)) {
        // If the module and device are orchestrator-based, return immediately.
        if (modulee.isCoreModule) {
            selectedModules.push(modulee);
            selectedDevices.push(orchestratorDevice);
            continue;
        }

        // Selecting the module automatically is useless, as they can
        // only do what their exports allow. So a well formed request should
        // always contain the module-id as well.
        // Still, do a validity-check that the requested module indeed
        // contains the func.
        if (modulee.exports.find(x => x.name === funcName) !== undefined) {
            selectedModules.push(modulee);
        } else {
            throw `Failed to find function '${funcName}' from requested module: ${modulee}`;
        }

        function deviceSatisfiesModule(d, m) {
            return m.requirements.every(
                r => d.description.supervisorInterfaces.find(
                    interfacee => interfacee === r.name // i.kind === r.kind && i.module === r.module
                )
            );
        }

        if (device) {
            // Check that the device actually can run module and function.
            if (!deviceSatisfiesModule(device, modulee)) {
                throw `device '${device.name}' does not satisfy module's requirements`;
            }
        } else {
            // Search for a device that could run the module.
            device = availableDevices.find(d => deviceSatisfiesModule(d, modulee));

            if (!device) {
                throw `no matching device satisfying all requirements: ${JSON.stringify(modulee.requirements, null, 2)}`;
            }
        }
        selectedDevices.push(device);
    }

    // Check that length of all the different lists matches (i.e., for every
    // item in deployment sequence found exactly one module and device).
    let length =
        sequence.length === selectedModules.length &&
        selectedModules.length === selectedDevices.length
        ? sequence.length
        : 0;
    // Assert.
    if (length === 0) {
        throw `Error on deployment: mismatch length between deployment (${sequence.length}), modules (${selectedModules.length}) and devices (${selectedDevices.length}) or is zero`;
    }

    // Now that the devices that will be used have been selected, prepare to
    // update the deployment sequence's devices in database with the ones
    // selected (handles possibly 'null' devices).
    let updatedSequence = Array.from(sequence);
    for (let i = 0; i < updatedSequence.length; i++) {
        updatedSequence[i].device = selectedDevices[i];
        updatedSequence[i].module = selectedModules[i];
        updatedSequence[i].func   = sequence[i].func;
    }

    return updatedSequence;
}

/**
 * Extract needed module data that a device needs.
 * @param {*} modulee The module record in database to extract data from.
 * @param {*} packageBaseUrl The base of the package manager server address for
 * devices to pull modules from.
 * @returns Data needed and usable by a device.
 */
function moduleData(modulee, packageBaseUrl) {
    // Add data needed by the device for pulling and using a binary
    // (i.e., .wasm file) module.
    let binaryUrl;
    binaryUrl = new URL(packageBaseUrl);
    binaryUrl.pathname = `/file/module/${modulee._id}/wasm`;
    let descriptionUrl;
    descriptionUrl = new URL(packageBaseUrl);
    descriptionUrl.pathname = `/file/module/${modulee._id}/description`;

    // This is for any other files related to execution of module's
    // functions on device e.g., ML-models etc.
    let other = {};
    if (modulee.dataFiles) {
        for (let filename of Object.keys(modulee.dataFiles)) {
            other[filename] = (new URL(packageBaseUrl+`file/module/${modulee._id}/${filename}`)).toString();
        }
    }

    return {
        id: modulee._id,
        name: modulee.name,
        urls: {
            binary: binaryUrl.toString(),
            description: descriptionUrl.toString(),
            other: other,
        },
    };
}

const ORCHESTRATOR_ADVERTISEMENT = {
    name: "orchestrator",
    type: constants.DEVICE_TYPE,
    port: 3000,
};

const ORCHESTRATOR_WASMIOT_DEVICE_DESCRIPTION = {
    "platform": {
        "memory": {
            "bytes": null
        },
        "cpu": {
            "humanReadableName": null,
            "clockSpeed": {
                "Hz": null
            }
        }
    },
    "supervisorInterfaces": []
};


module.exports = {
    Orchestrator,
    ORCHESTRATOR_ADVERTISEMENT,
    ORCHESTRATOR_WASMIOT_DEVICE_DESCRIPTION
};
