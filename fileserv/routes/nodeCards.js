const express = require("express");

let collection = null;

async function setDatabase(db) {
    collection = db.collection("nodecards");
}

/**
 * Endpoint for receiving metadata cards for nodes/devices and saving them to database.
 */
const createNodeCard = async (req, res) => {
    try {
        console.log("Received node card data: ", req.body);
        let nodecard = req.body;
        // Add timestamp to the log data
        nodecard.dateReceived = new Date();
        await collection.insertOne(nodecard);
        res.status(200).send({ message: 'Node card received and saved' });
    } catch (e) {
        console.error(e);
        res.status(500).send({ message: 'Error creating Node card' });
        return;
    }
}

/**
 * Get node metadata cards from the database.
 * Example: /moduleCards?date=2021-01-01T00:00:00.000Z
 */
const getNodeCards = async (request, response) => {
    // Make sure we have the index on dateReceived field
    await collection.createIndex({ dateReceived: 1 });

    let filterRule = {};
    if (request.query.after) {
        console.log("Getting node cards after date: ", new Date(request.query.after));
        // Check if date is provided, if so, get logs after that date,
        filterRule = { dateReceived: { $gt: new Date(request.query.after) } };
    }
    const logs = await collection.find(filterRule).toArray();
    response.json(logs);
}


const router = express.Router();
router.post("/", createNodeCard);
router.get("/", getNodeCards);


module.exports = { setDatabase, router };
