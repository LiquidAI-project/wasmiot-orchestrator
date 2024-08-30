/*
 * This file is used to clear the database and initialize it with data.
 */

const fs = require("fs");
const { ObjectId,  } = require("mongodb");
const { CLEAR_LOGS, INIT_FOLDER, INTERNAL_BASE_URI } = require("../constants.js");

const DEVICE = "device";
const MODULE = "module";
const DEPLOYMENT = "deployment";
const FILES = "files";
const SUPERVISOR_LOGS = "supervisorLogs";


class DataFile {
    constructor(originalPath, targetPath) {
        this.originalPath = originalPath;
        this.targetPath = targetPath;
    }
}


async function clearCollection(collection, filter = {}) {
    // Clear all items from the collection that match the filter.
    // If the filter is empty, all items are deleted.
    try {
        let { deletedCount } = await collection.deleteMany(filter);
        console.log(`Deleted ${deletedCount} items.`);
    }
    catch (error) {
        console.error(`Failed to clear collection ${collection.collectionName}: ${error}`);
    }
}

async function addDataToCollection(collection, data) {
    try {
        let { insertedCount } = await collection.insertMany(data);
        console.log(`Inserted ${insertedCount} items.`);
    }
    catch (error) {
        console.error(`Failed to add data to collection ${collection.collectionName}: ${error}`);
    }
}

function loadJsonData(folder) {
    function addObjectToList(itemList, item, filename) {
        if (item && item.constructor === Object) {
            if (item._id) {
                item._id = ObjectId(item._id);
            }
            itemList.push(item);
        }
        else {
            console.error(`Invalid JSON data in file: ${filename}`);
        }
    }

    function addDataToList(itemList, dataItem) {
        // only consider objects or arrays of objects
        if (dataItem && dataItem.constructor === Array) {
            for (let item of dataItem) {
                addObjectToList(itemList, item);
            }
        }
        else {
            addObjectToList(itemList, dataItem);
        }
    }

    let files = [];
    try {
        files = fs.readdirSync(folder);
    }
    catch (error) {
        console.error(`Failed to read the folder: ${folder}`);
        return [];
    }

    let data = [];
    for (let file of files) {
        if (!file.endsWith(".json")) {
            continue;  // ignore non-JSON files
        };

        try {
            let content = fs.readFileSync(`${folder}/${file}`);
            let parsed = JSON.parse(content);
            addDataToList(data, parsed);
        }
        catch (error) {
            console.error(`Failed to read ${file}.`);
        }
    }

    // NOTE: no validation for the data is done here.
    return data;
}

function getRequiredFiles(modules) {
    let files = [];
    for (let module of modules) {
        // NOTE: no validation for the file paths is done here
        if (module.wasm) {
            const originalPath = `${INIT_FOLDER}/${FILES}/${module.wasm.originalFilename}`;
            const targetPath = module.wasm.path;
            files.push(new DataFile(originalPath, targetPath));
        }
        if (module.dataFiles && module.dataFiles.constructor === Object) {
            for (const [, dataFile] of Object.entries(module.dataFiles)) {
                const originalPath = `${INIT_FOLDER}/${FILES}/${dataFile.originalFilename}`;
                const targetPath = dataFile.path;
                files.push(new DataFile(originalPath, targetPath));
            }
        }
    }
    return files;
}

function copyFiles(files) {
    let copyCount = 0;
    for (let file of files) {
        try {
            fs.copyFileSync(file.originalPath, file.targetPath);
            copyCount++;
        }
        catch (error) {
            console.error(`Failed to copy file: ${file.originalPath}`);
        }
    }
    console.log(`Copied ${copyCount} files.`);
}

function replacePublicBaseUri(url) {
    const URL_SPLITTER = "file/module";
    const urlParts = url.split(URL_SPLITTER);
    return `${INTERNAL_BASE_URI}${URL_SPLITTER}${urlParts.slice(1).join("")}`;
}

async function initDevices(database) {
    const deviceCollection = database.collection(DEVICE);
    const deviceData = loadJsonData(`${INIT_FOLDER}/${DEVICE}`)
        .filter(device => device.name !== "orchestrator");
    // set all device heath check time to the current time
    const timestamp = new Date();
    for (let device of deviceData) {
        if (device.health && device.health.timeOfQuery) {
            device.health.timeOfQuery = timestamp;
        }
    }

    if (deviceData.length > 0) {
        console.log("Clearing devices from the database.");
        await clearCollection(deviceCollection, {name: {$ne: "orchestrator"}});
        console.log(`Adding ${deviceData.length} devices to the database.`);
        await addDataToCollection(deviceCollection, deviceData);
    }
    else {
        console.log("No initial device data found. Leaving the database as is.");
    }
}

async function initModules(database) {
    const moduleCollection = database.collection(MODULE);
    let moduleData = loadJsonData(`${INIT_FOLDER}/${MODULE}`)
        .filter(module => module.isCoreModule !== true);

    const requiredFiles = getRequiredFiles(moduleData);

    if (moduleData.length > 0) {
        console.log("Clearing modules from the database.");
        await clearCollection(moduleCollection, {isCoreModule: {$exists: false, $ne: true}});
        console.log(`Adding ${moduleData.length} modules to the database.`);
        await addDataToCollection(moduleCollection, moduleData);
        console.log("Copying required files to the target paths.");
        copyFiles(requiredFiles);
    }
    else {
        console.log("No initial modules data found. Leaving the database as is.");
    }
}

async function initDeployments(database) {
    const deploymentCollection = database.collection(DEPLOYMENT);
    const deploymentData = loadJsonData(`${INIT_FOLDER}/${DEPLOYMENT}`);
    // modify relevant ids to ObjectIds, modify the URI to the current one, and remove active flag
    for (let deployment of deploymentData) {
        if (deployment.sequence && deployment.sequence.constructor === Array) {
            for (let sequenceItem of deployment.sequence) {
                if (sequenceItem.device) {
                    sequenceItem.device = ObjectId(sequenceItem.device);
                }
                if (sequenceItem.module) {
                    sequenceItem.module = ObjectId(sequenceItem.module);
                }
            }
        }
        if (deployment.fullManifest && deployment.fullManifest.constructor === Object) {
            for (const [, device] of Object.entries(deployment.fullManifest)) {
                if (device.deploymentId) {
                    device.deploymentId = ObjectId(device.deploymentId);
                }
                if (device.modules && device.modules.constructor === Array) {
                    for (let module of device.modules) {
                        if (module.constructor !== Object) {
                            continue;
                        }
                        if (module.id) {
                            module.id = ObjectId(module.id);
                        }
                        if (module.urls && module.urls.constructor === Object) {
                            if (module.urls.binary) {
                                module.urls.binary = replacePublicBaseUri(module.urls.binary);
                            }
                            if (module.urls.description) {
                                module.urls.description = replacePublicBaseUri(module.urls.description);
                            }
                            if (module.urls.other && module.urls.other.constructor === Object) {
                                for (const [key, url] of Object.entries(module.urls.other)) {
                                    module.urls.other[key] = replacePublicBaseUri(url);
                                }
                            }
                        }
                    }
                }
            }
        }
        if (deployment.active) {
            delete deployment.active;
        }
    }

    if (deploymentData.length > 0) {
        console.log("Clearing deployments from the database.");
        await clearCollection(deploymentCollection);
        console.log(`Adding ${deploymentData.length} deployments to the database.`);
        await addDataToCollection(deploymentCollection, deploymentData);
    }
    else {
        console.log("No initial deployment data found. Leaving the database as is.");
    }
}

async function removeSupervisorLogs(database) {
    const logCollection = database.collection(SUPERVISOR_LOGS);
    console.log("Clearing supervisor logs from the database.");
    await clearCollection(logCollection);
}

async function addInitialData(database) {
    await initDevices(database);
    await initModules(database);
    await initDeployments(database);
    if (CLEAR_LOGS) {
        await removeSupervisorLogs(database);
    }
}

module.exports = {
    addInitialData
};
