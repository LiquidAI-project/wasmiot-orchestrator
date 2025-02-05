const express = require("express");

let collection = null;

async function setDatabase(db) {
    collection = db.collection("deploymentcertificates");
}

/**
 * Get deployment certificates from the database.
 * Example: /deploymentCertificates?date=2021-01-01T00:00:00.000Z
 */
const getDeploymentCertificates = async (request, response) => {
    // Make sure we have the index on dateReceived field
    await collection.createIndex({ dateReceived: 1 });

    let filterRule = {};
    if (request.query.after) {
        console.log("Getting deployment certificates after date: ", new Date(request.query.after));
        // Check if date is provided, if so, get entries after that date,
        filterRule = { dateReceived: { $gt: new Date(request.query.after) } };
    }
    const logs = await collection.find(filterRule).toArray();
    response.json(logs);
}


const router = express.Router();
router.get("/", getDeploymentCertificates);


module.exports = { setDatabase, router };
