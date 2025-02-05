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
        const odrlDocument = req.body;

        // Extract the asset object (assume one asset for simplicity)
        const asset = odrlDocument.asset?.[0];
        if (!asset) {
            res.status(400).send({ message: "Invalid ODRL document: Asset not found" });
            return;
        }

        // Parse fields from the asset
        const name = asset.title || "unknown";

        // Extract relations for type, risk-level, and nodeid
        const relations = asset.relation || [];
        const type = relations.find(r => r.type === "type")?.value || "unknown";
        const riskLevel = relations.find(r => r.type === "risk-level")?.value || "unknown";
        const nodeid = relations.find(r => r.type === "nodeid")?.value || "unknown";

        // Construct the parsed document
        const parsedDataSource = {
            name,
            type,
            "risk-level": riskLevel,
            nodeid,
            dateReceived: new Date()
        };

        // Save to MongoDB
        await collection.insertOne(parsedDataSource);

        res.status(200).send({ message: 'Data source card received and saved' });
    } catch (e) {
        console.error(e);
        res.status(500).send({ message: 'Error creating data source card' });
    }
};

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
