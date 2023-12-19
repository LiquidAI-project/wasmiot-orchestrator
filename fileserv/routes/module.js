const { readFile } = require("node:fs/promises");
const express = require("express");

const { ObjectId } = require("mongodb");

const { MODULE_DIR, WASMIOT_INIT_FUNCTION_NAME } = require("../constants.js");
const utils = require("../utils.js");


let moduleCollection = null;
let deploymentCollection = null;
let deviceCollection = null;

function setDatabase(db) {
    moduleCollection = db.collection("module");
    deploymentCollection = db.collection("deployment");
    deviceCollection = db.collection("device");
}

class ModuleCreated {
    constructor(id) {
        this.id = id;
    }
}

class ModuleDescribed {
    constructor(description) {
        this.description = description;
    }
}

class WasmFileUpload {
    constructor(updateObj) {
        this.type = "wasm";
        this.updateObj = updateObj;
    }
}

class DataFileUpload {
    constructor(type, updateObj) {
        this.type = type;
        this.updateObj = updateObj;
    }
}

/**
 * Return a filter for querying a module based on a string value x.
 * @param {*} x string
 */
const moduleFilter = (x) => {
    let filter = {};
    try {
        filter._id = ObjectId(x);
    } catch (e) {
        console.error(`Passed in module-ID '${x}' not compatible as ObjectID. Using it as 'name' instead`);
        filter.name = x;
    }
    return filter;
};

/**
 * Implements the logic for creating a new module.
 * @returns Promise about interpreting the .wasm binary and attaching it to
 * created module resource. On success it results to the added module's ID.
 */
const createNewModule = async (metadata, files) => {
    // Create the database entry.
    let moduleId = (await moduleCollection.insertOne(metadata)).insertedId;

    // Attach the Wasm binary.
    return addModuleBinary({_id: moduleId}, files[0]).then(() => moduleId);
};

/**
 * Implements the logic for describing an existing module.
 * @param {*} moduleId
 * @param {*} descriptionManifest
 * @param {*} files
 * @returns Promise about generating a description for the module based on
 * received functions and files and updating it all to the database.
 */
const describeExistingModule = async (moduleId, descriptionManifest, files) => {
    // Prepare description for the module based on given info for functions
    // (params & outputs) and files (mounts).
    let functions = {};
        for (let [funcName, func] of Object.entries(descriptionManifest).filter(x => typeof x[1] === "object")) {
        // The function parameters might be in a list or be in the form of 'paramN'
        // where N is the order of the parameter.
        parameters = func.parameters || Object.entries(func)
                .filter(([k, _v]) => k.startsWith("param"))
                .map(([k, v]) => ({ name: k, type: v }));

        functions[funcName] = {
            method: func.method.toLowerCase(),
            parameters: parameters,
            mounts: "mounts" in func
                ? Object.fromEntries(
                    Object.values(func.mounts)
                        // Map files by their form fieldname to this function's mount.
                        .map(({ name, stage }) => ([ name, {
                            // If no file is given the media type cannot be
                            // determined and is set to default.
                            mediaType: (
                                files.find(x => x.fieldname === name)?.mimetype
                                || "application/octet-stream"
                            ),
                            stage: stage,
                        }]))
                ) : {},
            outputType:
                // An output file takes priority over any other output type.
                func.mounts?.find(({ stage }) => stage === "output")?.mediaType
                || func.output
        };
    }

    // Check that the described mounts were actually uploaded.
    let missingFiles = [];
    for (let [funcName, func] of Object.entries(functions)) {
        for (let [mountName, mount] of Object.entries(func.mounts)) {
            if (mount.stage == "deployment" && !(files.find(x => x.fieldname === mountName))) {
                missingFiles.push([funcName, mountName]);
            }
        }
    }

    // NOTE: This code looks horribly confusing, sorry.
    if (missingFiles.length > 0) {
        // Check if the module-wide init-function is present and if its output
        // mount(s) match to deployment-mounts of the functions reported to be
        // "missing files" (which then means the files are not actually missing).
        if (WASMIOT_INIT_FUNCTION_NAME in functions) {
            let actuallyMissingFiles = [];
            for (let [funcName, mountName] of missingFiles) {
                if (mountName in functions[WASMIOT_INIT_FUNCTION_NAME].mounts) {
                    console.log(`NOTE: Function '${funcName}' should receive mount '${mountName}' from init-function later.`);
                } else {
                    actuallyMissingFiles.push([funcName, mountName]);
                }
            }
            if (actuallyMissingFiles.length > 0) {
                throw ["mounts missing", missingFiles];
            }
        } else {
            throw ["mounts missing", missingFiles];
        }
    }
    // Save associated files ("mounts") adding their info to the database entry.
    await addModuleDataFiles(moduleId, files);

    // Get module from DB after file updates (FIXME which is a stupid back-and-forth).
    let [failCode, [modulee]] = await getModuleBy(moduleId);
    if (failCode) {
        throw "failed reading just updated module from database";
    }

    let description = utils.moduleEndpointDescriptions(modulee, functions);
    let mounts = Object.fromEntries(
        Object.entries(functions)
            .map(([funcName, func]) => [ funcName, func.mounts || {} ])
    );

    await updateModule(moduleId, { mounts, description });

    return description;
};

/**
 *
 * @param {*} moduleId ObjectID __or__ name.
 * @returns [failCode, module]
 */
const getModuleBy = async (moduleId) => {
    // Common database query in any case.
    let getAllModules = moduleId === undefined;

    let filter = {};
    if (!getAllModules) {
        filter = moduleFilter(moduleId);
    }

    let matches;
    try {
        matches = await (await moduleCollection.find(filter)).toArray();
    } catch (e) {
        let err = ["database query failed", e];
        return [500, err];
    }

    if (getAllModules) {
        // Return all modules.
        return [0, matches];
    } else {
        // Return the module identified by given ID.
        if (matches.length === 0) {
            let err = `no matches for ID ${moduleId}`;
            return [404, err];
        } else if (matches.length > 1) {
            let err = `too many matches for ID ${moduleId}`;
            return [500, err];
        } else {
            let doc = matches[0];
            return [0, [doc]];
        }
    }
};

/**
 * GET
 * - a single Wasm-module's whole metadata (moduleId)
 * - a single Wasm-module's whole OpenAPI description (moduleId/description)
 * - all available Wasm-modules' metadata (no moduleId)
 */
const getModule = (justDescription) => (async (request, response) => {
    let [failCode, modules] = await getModuleBy(request.params.moduleId);
    if (failCode) {
        console.error(...modules);
        response.status(failCode).json(new utils.Error(modules));
    } else {
        if (justDescription) {
            console.log("Sending description of module: ", modules[0].name);
            // Return the description specifically.
            response.json(modules[0].description)
        } else {
            console.log("Sending metadata of modules: ", modules.map(x => x.name));
            response.json(modules);
        }
    }
});

/**
 * Serve the a file relate to a module based on module ID and file extension.
 */
const getModuleFile = async (request, response) => {
    let doc = await moduleCollection.findOne(
        moduleFilter(request.params.moduleId)
    );
    let filename = request.params.filename;
    if (doc) {
        let fileObj;
        if (filename === "wasm") {
            fileObj = doc.wasm;
        } else {
            fileObj = doc.dataFiles[filename];
        }

        if (!fileObj) {
            response.status(400).json({
                err: `file '${filename}' missing from module '${doc.name}'`
            });
            return;
        }
        console.log(`Sending '${filename}' file from file-path: `, fileObj.path);
        // TODO: A 'datafile' might not be application/binary in every case.
        let options = { headers: { 'Content-Type': filename == "wasm" ? 'application/wasm' : 'application/octet-stream' } };
        response.sendFile(fileObj.path, options);
    } else {
        let errmsg = `Failed querying for module id: ${request.params.moduleId}`;
        console.log(errmsg);
        response.status(400).json({ err: errmsg });
    }
}

/**
 * Parse metadata from a Wasm-binary to database along with its name.
 */
const createModule = async (request, response) => {
    try {
        let result = await createNewModule(request.body, request.files);

        response
            .status(201)
            .json(new ModuleCreated(result));
    } catch (e) {
        if (e === "exists") {
            response.status(400).json(new utils.Error(undefined, e));
        } else if (e === "bad") {
            let err = ["Failed attaching a file to module", e];
            console.error(...err);
            // TODO Handle device not found on update.
            response
                .status(500)
                .json(new utils.Error(...err));
        } else {
            console.error("unknown error", e);
            response
                .status(500)
                .json(new utils.Error("unknown error"));
        }
    }
};

const getFileUpdate = async (file) => {
    let originalFilename = file.originalname;
    let fileExtension = originalFilename.split(".").pop();

    // Add additional fields initially from the file-upload and save to
    // database.
    let updateObj = {};
    let updateStruct = {
        originalFilename: originalFilename,
        fileName: file.filename,
        path: file.path,
    };

    let data = await readFile(file.path);

    // Perform actions specific for the filetype to update
    // non-filepath-related metadata fields.
    let result;
    if (file.mimetype === "application/wasm") {
        updateObj["wasm"] = updateStruct;

        try {
            await parseWasmModule(data, updateObj)
        } catch (e) {
            let err = ["failed compiling Wasm", e]
            console.error(...err);
            throw new utils.Error(...err);
        }
        result = new WasmFileUpload(updateObj);
    } else {
        // All other filetypes are to be "mounted".
        updateObj[file.fieldname] = updateStruct;
        result = new DataFileUpload(fileExtension, updateObj);
    }

    return result;
}

/**
 * Attach _binary_file (i.e., .wasm) to a module.
 *
 * Saves the file to the server filesystem and references to it into module's
 * database-entry matching a module-ID given in the body.
 */
const addModuleBinary = async (module, file) => {
    let result = await getFileUpdate(file);

    if (result.type !== "wasm") {
        throw new utils.Error("file given as module binary is not a .wasm file");
    }
    let updateObj = result.updateObj;

    // Now actually update the database-document, devices and respond to
    // caller.
    await updateModule(module._id, updateObj);

    console.log(`Updated module '${module._id}' with data:`, result.updateObj);

    // Tell devices to fetch updated files on modules.
    await notifyModuleFileUpdate(module._id);

    return result;
};


/**
 * Attach _data_files (i.e., not .wasm) to a module.
 *
 * Saves the files to the server filesystem and references to them into module's
 * database-entry matching a module-ID given in the body.
 */
const addModuleDataFiles = async (moduleId, files) => {
    let update = { dataFiles: {} };
    for (let file of files) {
        let result;
        try {
            result = await getFileUpdate(file);
        } catch (e) {
            let err = ["failed attaching file to module", e];
            console.error(...err);
            throw new utils.Error(...err);
        }

        if (result.type === "wasm") {
            throw "data cannot be wasm";
        }
        let [[key, obj]] = Object.entries(result.updateObj);
        update.dataFiles[key] = obj;
    }

    // Now actually update the database-document, devices and respond to
    // caller.
    await updateModule(moduleId, update);

    console.log(`Updated module '${moduleId}' with data:`, update);

    // Tell devices to fetch updated files on modules.
    await notifyModuleFileUpdate(moduleId);
};

const describeModule = async (request, response) => {
    try {
        let description = await describeExistingModule(
            request.params.moduleId,
            // If received stringified JSON (because of multipart/form-data -reasons), parse the object from it.
            request.body.functions
                ? JSON.parse(request.body.functions)
                : request.body,
            request.files
        );

        response.json(new ModuleDescribed(description));
    } catch (e) {
        let err;
        switch (e) {
            case "update failed":
                err = ["failed updating module with description", e];
                console.error(...err);
                response
                    .status(500)
                    .json(new utils.Error(...err));
                break;
            case "data cannot be wasm":
                err = ["failed attaching file to module", e];
                console.error(...err);
                response
                    .status(400)
                    .json(new utils.Error(...err));
                break
            default:
                if (typeof e === "object") {
                    if (e instanceof Array && e[0] === "mounts missing") {
                        let missingFiles = e[1];
                        response
                            .status(400)
                            .json(new utils.Error(`Functions missing mounts: ${JSON.stringify(missingFiles)}`));
                        break;
                    }
                }
                console.error("unknown error", e);
                response
                    .status(500)
                    .json(new utils.Error("unknown error"));
                break;
        }
    }
};

/**
 * DELETE a single or all available Wasm-modules.
 */
const deleteModule = async (request, response) => {
    let deleteAllModules = request.params.moduleId === undefined;
    let filter = deleteAllModules ? {} : moduleFilter(request.params.moduleId);
    let { deletedCount } = await moduleCollection.deleteMany(filter);
    if (deleteAllModules) {
        response.json({ deletedCount: deletedCount });
    } else {
        response.status(204).send();
    }
}


/**
 * Parse WebAssembly module from data and add info extracted from it into input object.
 * @param {*} data Data to parse WebAssembly from e.g. the result of a file-read.
 * @param {*} outFields Object to add new fields into based on parsed
 * WebAssembly (e.g. module exports etc.)
 */
async function parseWasmModule(data, outFields) {
    // Get the exports and imports directly from the Wasm-binary itself.
    let wasmModule = await WebAssembly.compile(data);

    let importData = WebAssembly.Module.imports(wasmModule)
        // Just get the functions for now.
        .filter(x => x.kind === "function");

    // Each import goes under its module name.
    let importObj = Object.fromEntries(importData.map(x => [x.module, {}]));
    for (let x of importData) {
        // Fake the imports for instantiation.
        importObj[x.module][x.name] = () => {};
    }
    // An instance is needed for more information about exported functions,
    // although not much can be (currently?) extracted (for example types would
    // probably require more specific parsing of the binary and they are just
    // the Wasm primitives anyway)...
    let instance = await WebAssembly.instantiate(wasmModule, importObj);
    let exportData =  WebAssembly.Module.exports(wasmModule)
        // Just get the names of functions for now; the
        // interface description attached to created modules is
        // trusted to match the uploaded WebAssembly binary.
        .filter(x => x.kind === "function")
        .map(x => new Func(x.name, instance.exports[x.name].length));

    outFields.requirements = importData;
    outFields.exports = exportData;
}

/**
* Notify devices that a module previously deployed has been updated.
* @param {*} moduleId ID of the module that has been updated.
*/
async function notifyModuleFileUpdate(moduleId) {
    // Find devices that have the module deployed and the matching deployment manifests.
    let deployments = await (await deploymentCollection.find()).toArray();
    let devicesToUpdatedManifests = {};
    for (let deployment of deployments.filter(x => x.fullManifest)) {
        // Unpack the mapping of device-id to manifest sent to it.
        let [deviceId, manifest] = Object.entries(deployment.fullManifest)[0];

        if (manifest.modules.some(x => x.id === moduleId.toString())) {
            if (devicesToUpdatedManifests[deviceId] === undefined) {
                devicesToUpdatedManifests[deviceId] = [];
            }
            devicesToUpdatedManifests[deviceId].push(manifest);
        }
    }

    // Deploy all the manifests again, which has the same effect as the first
    // time (following the idempotence of ReST).
    for (let [deviceId, manifests] of Object.entries(devicesToUpdatedManifests)) {
        let device = await deviceCollection.findOne({ _id: deviceId });

        if (!device) {
            throw new utils.Error(`No device found for '${deviceId}' in manifest#${i}'`);
        }

        for (let manifest of manifests) {
            await utils.messageDevice(device, "/deploy", manifest);
        }
    }
}

/**
* Update the modules matched by filter with the given fields.
* @param {*} filter To match the modules to update.
* @param {*} fields To add to the matched modules.
*/
async function updateModule(id, fields) {
    let { matchedCount } = await moduleCollection.updateMany(moduleFilter(id), { $set: fields }, { upsert: true });
    if (matchedCount === 0) {
        throw "no module matched the filter";
    }
}

class Func {
    constructor(name, parameterCount) {
        this.name = name;
        this.parameterCount = parameterCount;
    }
}

const fileUpload = utils.fileUpload(MODULE_DIR, "module");


const router = express.Router();
router.post(
    "/",
    fileUpload,
    // A .wasm binary is required.
    utils.validateFileFormSubmission,
    createModule,
);
router.post(
    "/:moduleId/upload",
    fileUpload,
    describeModule,
);
router.get("/:moduleId?", getModule(false));
router.get("/:moduleId/description", getModule(true));
router.get("/:moduleId/:filename", getModuleFile);
router.delete("/:moduleId?", /*authenticationMiddleware,*/ deleteModule);

module.exports = {
    setDatabase,
    router,
    createNewModule,
    describeExistingModule,
};
