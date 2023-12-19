/**
 * This module contains the routes for "core services" that come with the
 * orchestrator and thus needn't be separately uploaded as modules.
 *
 * Each service is attached with a supervisor-compatible description like any
 * other WebAssembly module on the orchestrator, and is mixed into the module
 * database.
 */

const { writeFile } = require("node:fs/promises");

const express = require("express");

const utils = require("../utils.js");
const COLLECTION_NAME = "module";
const {
    FUNCTION_DESCRIPTIONS: DATALIST_FUNCTION_DESCRIPTIONS,
    MODULE_NAME: DATALIST_MODULE_NAME,
    setDatabase: setDatalistDatabase,
    MODULE_NAME
} = require("./datalist.js");
const { DEVICE_DESC_ROUTE, DEVICE_HEALTH_ROUTE, WASMIOT_INIT_FUNCTION_NAME } = require("../constants.js");
const { ORCHESTRATOR_WASMIOT_DEVICE_DESCRIPTION } = require("../src/orchestrator.js");
const { createNewModule, describeExistingModule } = require("../routes/module.js");
const { ObjectId } = require("mongodb");


let serviceIds = {};

let database = null;

/**
 * Give a core-service type name based on service name.
 */
const coreNameFor = (serviceName) => `core:${serviceName}`;


/**
 * Calling on the orchestrator API, create the core services as "modules".
 * This should be done right after the orchestrator server has fully
 * initialized.
 */
async function initializeCoreServices() {
    // Create a minimal "empty" .wasm module for sending to the module-creation
    // "pipeline".
    let emptyWasmBytes = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0 ,0]);
    await writeFile("./files/empty.wasm", emptyWasmBytes);

    // Delete and refresh all core services at initialization.
    let coreServiceNames = [coreNameFor(DATALIST_MODULE_NAME)];
    let { deletedCount } = await database
        .collection("module")
        // Delete also based on name to avoid clashes (or more likely, broken
        // state left in database from developer-testing).
        .deleteMany({ $or: [{ isCoreModule: true }, { name: { $in: coreServiceNames } }] });
    console.log(`DEBUG: Deleted existing (${deletedCount}) core services in order to create them anew...`);

    console.log("Initializing the core services...");

    // Initialize the datalist "module".
    let metadata = {
        name: coreNameFor(DATALIST_MODULE_NAME)
    };
    // Fake the object that multer would create off of uploaded files.
    let files = [
        {
            fieldname: "wasm",
            originalname: "datalist.wasm",
            filename: "empty.wasm",
            path: "./files/empty.wasm",
            mimetype: "application/wasm",
        }
    ];
    let id = await createNewModule(metadata, files);
    // Describe the datalist "module".
    try {
        await describeExistingModule(id, DATALIST_FUNCTION_DESCRIPTIONS, []);
    } catch (e) {
        console.error("The core services are probably not properly described: ", e);
        console.log("Exiting...");
        process.exit(1);
    }

    // Add a flag to the entry to mark it as core-module.
    await database.collection("module").updateOne({ _id: ObjectId(id) }, { $set: { isCoreModule: true } });

    serviceIds[metadata.name] = id;

    console.log("Created core services", Object.entries(serviceIds).map(([name, _]) => name));
}

/**
 * Return list of the core modules that orchestrator provides on its own.
 * @param {*} request
 * @param {*} response
 */
const getCoreServices = async (request, response) => {
    response.json(await database.read("coreServices"));
};

const router = express.Router();
router.get("/core", getCoreServices);
// Advertise and act like a supervisor.
router.get(DEVICE_DESC_ROUTE, (_, response) => {
    response.json(ORCHESTRATOR_WASMIOT_DEVICE_DESCRIPTION);
});
router.get(DEVICE_HEALTH_ROUTE, (_, response) => {
    response.json({ status: "ok" });
});
// Deploy always succeeds, because no setup is needed.
router.post("/deploy", async (request, response) => {
    let modules = request.body.instructions.modules;
    // On a real supervisor, the WebAssembly module would be fetched, and the
    // init-function ran from it for setting up the runtime. Here we only check
    // if any of the _core_modules installed on this "supervisor" contain the
    // init and run it.
    for (let modName of Object.keys(modules)) {
        if (modName in serviceIds) {
            console.log(`DEBUG: Running init function for '${modName}'.`);
            await DATALIST_FUNCTION_DESCRIPTIONS[WASMIOT_INIT_FUNCTION_NAME].init()
        }
    }
    response.status(200).json({ status: "ok" });
});


// Prepare similar routes as on supervisor.
let endpoints = Object.entries(DATALIST_FUNCTION_DESCRIPTIONS)
    // Filter out the init function, because it's not a real endpoint but
    // something that the supervisor should run at deployment-time.
    .filter(([functionName, _]) => functionName !== WASMIOT_INIT_FUNCTION_NAME)
    .map(
        ([functionName, x]) => ({
            path: utils
                .supervisorExecutionPath(coreNameFor(MODULE_NAME), functionName)
                .replace("{deployment}", ":deploymentId"),
            method: x.method,
            middlewares: x.middlewares
        })
    );
for (let { path, method, middlewares } of endpoints) {
    router[method.toLowerCase()](path, ...middlewares);
}

/**
 * Set common dependencies and state for providing core services from
 * orchestrator endpoints like they were any other Wasm-module endpoints.
 */
async function init(routeDependencies) {
    // Database is needed by some services, so they can access it from this
    // variable.
    database = routeDependencies.database;

    setDatalistDatabase(database);

    return router;
}


module.exports = { init, initializeCoreServices };
