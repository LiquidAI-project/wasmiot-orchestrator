const constants = require("../constants.js");


class SolutionError extends Error {
    constructor(message, dId, dName) {
        super(message);
        this.name = "SolutionError";
        this.deployment = { _id: dId, name: dName };
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
        // Descriptions of endpoints that functions can be called from and
        // that are needed to set up on the device for this deployment.
        this.endpoints = {};
        // The instructions the device needs to follow the execution
        // sequence i.e., where to forward computation results initiated by
        // which arriving request.
        this.instructions = [];
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
        this.database = dependencies.database;
        this.packageManagerBaseUrl = options.packageManagerBaseUrl || constants.PUBLIC_BASE_URI;
    }

    async solve(deployment) {
        // Gather the devices and modules attached to deployment in "full"
        // (i.e., not just database IDs).
        let availableDevices = await this.database.read("device");
        // The original deployment should be saved to database as is with the
        // IDs TODO: Exactly why should it be saved?.
        let hydratedDeployment =  structuredClone(deployment);
        for (let step of hydratedDeployment.sequence) {
            step.device = availableDevices.find(x => x._id.toString() === step.device);
            step.module = (await this.database.read("module", { _id: step.module }))[0];
        }

        //TODO: Start searching for suitable packages using saved file.
        //startSearch();

        let updatedSequence = sequenceFromResources(hydratedDeployment.sequence, availableDevices);

        // Now that the deployment is deemed possible, an ID is needed to
        // construct the instructions on devices.
        let deploymentId = (await this.database.create("deployment", [deployment]))
            .insertedIds[0];
        
        let solution = createSolution(deploymentId, updatedSequence, this.packageManagerBaseUrl)

        // Update the deployment with the created solution.
        this.database.update(
            "deployment", 
            { _id: deployment._id },
            solution
        );

        return deploymentId;
    }
}

/**
 * Solve for M2M-call interfaces and create individual instructions
 * (deployments) to send to devices.
 * to the deployment manifest.
 * @param {*} deploymentId The deployment ID is used to identify received POSTs
 * on devices regarding this deployment.
 * @returns The created solution.
 * @throws An error if building the solution fails.
 */
function createSolution(deploymentId, updatedSequence, packageBaseUrl) {
    let deploymentsToDevices = {};
    for (let x of updatedSequence) {
        let deviceIdStr = x.device._id.toString();

        // __Prepare__ to make a mapping of devices and their instructions in order to
        // bulk-send the instructions to each device when deploying.
        if (!(deviceIdStr in deploymentsToDevices)) {
            deploymentsToDevices[deviceIdStr] = new DeploymentNode(deploymentId);
        }

        // Fill in the details about needed modules and endpoints on each device.
        let moduleDataForDevice = moduleData(x.module, packageBaseUrl);
        let [funcc, endpoint] = endpointDescription(deploymentId, x);
        deploymentsToDevices[deviceIdStr].modules.push(moduleDataForDevice);
        // TODO ... Merge together into a single OpenAPI doc for __all__
        // the modules' endpoints.
        deploymentsToDevices[deviceIdStr].endpoints[funcc] = endpoint;
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
    for (let i in updatedSequence) {
        let deviceId = updatedSequence[i].device._id;

        let forwardEndpoint;
        let forwardFunc = updatedSequence[i + 1]?.func;
        let forwardDeployment = deploymentsToDevices[updatedSequence[i + 1]?.device._id];

        if (forwardFunc === undefined || forwardDeployment === undefined) {
            forwardEndpoint = null;
        } else {
            // The order of endpoints attached to deployment is still the same
            // as it is based on the execution sequence and endpoints are
            // guaranteed to contain at least one item.
            forwardEndpoint = forwardDeployment.endpoints[forwardFunc];
        }

        let instruction = {
            // Set where in the execution sequence is this configuration expected to
            // be used at. Value of 0 signifies beginning of the sequence and caller
            // can be any party with an access. This __MIGHT__ be useful to prevent
            // recursion at supervisor when a function with same input and output is
            // chained to itself e.g. deployment fibo -> fibo would result in
            //     fiboLimit2_0(7) -> 13 -> fiboLimit2_1(13) -> 233 -> <end result 233>
            // versus
            //     fibo(7)         -> 13 -> fibo(13)         -> 233 -> fibo(233) -> <loop forever>
            // NOTE: Atm just the list indices would work the same, but maybe graphs
            // used in future?
            // TODO: How about this being a handle or other reference to the
            // matching installed endpoint on supervisor?
            // TODO: Will this sort of sequence-identification prevent
            // supporting events (which are inherently "autonomous")?
            sequence: i,
            to: forwardEndpoint,
        };

        // Attach the created details of deployment to matching device.
        deploymentsToDevices[deviceId].instructions.push(instruction);
    }

    let sequenceAsIds = Array.from(updatedSequence)
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
function sequenceFromResources(sequence, availableDevices) {
    let selectedModules = [];
    let selectedDevices = [];

    // Iterate all the items in the request's sequence and fill in the given
    // modules and devices or choose most suitable ones.
    for (let [device, modulee, funcName] of sequence.map(Object.values)) {
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

        if (device) {
            selectedDevices.push(device);
        } else {
            // Search for a device that could run the module.
            let match = availableDevices.find(
                d => modulee.requirements.every(
                    requirement => d.description.supervisorInterfaces.includes(requirement)
                )
            );

            if (!match) {
                throw `Failed to satisfy module '${JSON.stringify(modulee, null, 2)}': No matching device`;
            }

            selectedDevices.push(match);
        }
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
    for (let i in updatedSequence) {
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
    descriptionUrl.pathname = `/file/module/${modulee._id}`;

    // This is for any other files related to execution of module's
    // functions on device e.g., ML-models etc.
    let other = [];
    if (modulee.pb) {
        other.push((new URL(packageBaseUrl+`file/module/${modulee._id}/pb`)).toString());
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

/**
 * Based on description of a node and functions that it should execute, put
 * together and fill out information needed for describing the service(s).
 * TODO Somehow filter out the unnecessary paths for this deployment that could
 * be attached to the module.
 * @param {*} deploymentId Identification for the deployment the endpoints will
 * be associated to.
 * @param {*} node OUT PARAMETER: The node containing data for where and how
 * execution of functions on it should be requested.
 * Should contain connectivity information (address and port) and definition of
 * module containing functions so they can be called with correct inputs.
 * @returns Pair of the function (index 0) and a pre-filled OpenAPI-doc endpoint
 * (index 1) specially made for this node for configuring (ideally most
 * effortlessly) the endpoint that function is available to be called from.
 */
function endpointDescription(deploymentId, node) {
    // Prepare options for making needed HTTP-request to this path.
    // TODO: Check for device availability here?
    // FIXME hardcoded: selecting first address.
    let urlString = node.module.openapi.servers[0].url;
    // FIXME hardcoded: "url" field assumed to be template "http://{serverIp}:{port}".
    urlString = urlString
        .replace("{serverIp}", node.device.addresses[0])
        .replace("{port}", node.device.port);
    let url = new URL(urlString);

    // FIXME hardcoded: "paths" field assumed to contain template "/{deployment}/modules/{module}/<thisFuncName>".
    // FIXME: URL-encode the names.
    const funcPathKey = Object.keys(node.module.openapi.paths)[0];//`/{deployment}/modules/{module}/${node.func}`;
    // TODO: Iterate all the paths.
    let funcPath = node.module.openapi.paths[funcPathKey];
    let filledFuncPathKey = funcPathKey
        .replace("{deployment}", deploymentId)
        .replace("{module}", node.module.name);

    // Fill out the prepared parts of the templated OpenAPI-doc.
    let preFilledOpenapiDoc = node.module.openapi;
    // Where the device is located.
    // FIXME hardcoded: selecting first address.
    preFilledOpenapiDoc.servers[0].url = url.toString();
    // Where and how to call the func.
    preFilledOpenapiDoc.paths[filledFuncPathKey] = funcPath;

    // Remove unnecessary fields.
    delete preFilledOpenapiDoc.paths[filledFuncPathKey].parameters
    // FIXME hardcoded: selecting first address.
    delete preFilledOpenapiDoc.servers[0].variables;
    // TODO: See above about filtering out unnecessary paths (= based on funcs).
    for (let unnecessaryPath of Object.keys(preFilledOpenapiDoc.paths).filter(x => x.includes("{module}"))) {
        delete preFilledOpenapiDoc.paths[unnecessaryPath];
    }

    return [node.func, preFilledOpenapiDoc];
}


module.exports = Orchestrator;