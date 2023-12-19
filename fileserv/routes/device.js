const express = require("express");


let deviceDiscovery = null;

let deviceCollection = null;
function setDatabase(db) {
    deviceCollection = db.collection("device");
}

function setDeviceDiscovery(dd) {
    deviceDiscovery = dd;
}


/**
 * GET list of all available IoT-devices; used by Actors in constructing a
 * deployment.
 */
const getDevices = async (request, response) => {
    // TODO What should this ideally return? Only IDs and descriptions?
    let devices = await (await deviceCollection.find()).toArray();
    response.json(devices);
};

/**
 * NOTE TEMPORARY route to easily delete all devices from database (in case of
 * hostname-changes etc.)
 */
const deleteDevices = async (request, response) => {
    let { deletedCount } = await deviceCollection.deleteMany();
    response
        .status(200)
        .json({ deletedCount });
}

/**
 * Start a new device scan without waiting for a scanning timeout.
 */
const rescanDevices = (request, response) => {
    deviceDiscovery.startScan();

    response.status(204).send();
}

const router = express.Router();
router.get("/", getDevices);
router.delete("/", deleteDevices);
router.post("/discovery/reset", rescanDevices);


module.exports = { setDatabase, setDeviceDiscovery, router };
