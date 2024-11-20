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

        // Extract the raw metadata
        const rawCard = req.body;

        // Extract node information from the first asset (if multiple, handle as needed)
        const asset = rawCard.asset && rawCard.asset[0];
        if (!asset) {
            throw new Error("Invalid metadata: Missing asset data");
        }

        // Extract zone information from relations
        const relation = asset.relation && asset.relation.find(rel => rel.type === "memberOf");
        const zone = relation ? relation.value : "unknown"; // Default to "unknown" if missing

        // Prepare the transformed document
        const nodeCard = {
            name: asset.title || "unknown", // Default to "unknown" if title is missing
            nodeid: asset.uid || "unknown", // Default to "unknown" if UID is missing
            zone: zone,
            dateReceived: new Date()
        };

        // Save to MongoDB
        await collection.insertOne(nodeCard);

        res.status(200).send({ message: 'Node card received and saved', nodeCard });
    } catch (e) {
        console.error("Error processing node card: ", e);
        res.status(500).send({ message: 'Error creating Node card' });
    }
};

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
