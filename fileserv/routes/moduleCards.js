const express = require("express");

let collection = null;

async function setDatabase(db) {
    collection = db.collection("modulecards");
}

/**
 * Endpoint for receiving metadata cards for modules and saving them to database.
 */
const createModuleCard = async (req, res) => {
    try {
        console.log("Received module card data: ", req.body);
        //let modulecard = JSON.parse(req.body);
        let modulecard = req.body;
        // Add timestamp to the log data
        modulecard.dateReceived = new Date();
        await collection.insertOne(modulecard);
        res.status(200).send({ message: 'Module card received and saved' });
    } catch (e) {
        console.error(e);
        res.status(500).send({ message: 'Error creating module card' });
        return;
    }
}

/**
 * Get module metadata cards from the database.
 * Example: /moduleCards?date=2021-01-01T00:00:00.000Z
 */
const getModuleCards = async (request, response) => {
    // Make sure we have the index on dateReceived field
    await collection.createIndex({ dateReceived: 1 });

    let filterRule = {};
    if (request.query.after) {
        console.log("Getting module cards after date: ", new Date(request.query.after));
        // Check if date is provided, if so, get logs after that date,
        filterRule = { dateReceived: { $gt: new Date(request.query.after) } };
    }
    const logs = await collection.find(filterRule).toArray();
    response.json(logs);
}


const router = express.Router();
router.post("/", createModuleCard);
router.get("/", getModuleCards);


module.exports = { setDatabase, router };
