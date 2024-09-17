const express = require("express");

let collection = null;

async function setDatabase(db) {
    collection = db.collection("datasourcecards");
}

/**
 * Endpoint for receiving metadata cards for data sources and saving them to database.
 */
const createDataSourceCard = async (req, res) => {
    try {
        console.log("Received data source card data: ", req.body);
        let nodecard = req.body;
        // Add timestamp to the log data
        nodecard.dateReceived = new Date();
        await collection.insertOne(nodecard);
        res.status(200).send({ message: 'Data source card received and saved' });
    } catch (e) {
        console.error(e);
        res.status(500).send({ message: 'Error creating data source card' });
        return;
    }
}

/**
 * Get data source metadata cards from the database.
 * Example: /dataSourceCards?date=2021-01-01T00:00:00.000Z
 */
const getDataSourceCard = async (request, response) => {
    // Make sure we have the index on dateReceived field
    await collection.createIndex({ dateReceived: 1 });

    let filterRule = {};
    if (request.query.after) {
        console.log("Getting data source cards after date: ", new Date(request.query.after));
        // Check if date is provided, if so, get entries after that date,
        filterRule = { dateReceived: { $gt: new Date(request.query.after) } };
    }
    const logs = await collection.find(filterRule).toArray();
    response.json(logs);
}


const router = express.Router();
router.post("/", createDataSourceCard);
router.get("/", getDataSourceCard);


module.exports = { setDatabase, router };
