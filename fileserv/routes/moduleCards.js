const express = require("express");

let collection = null;

async function setDatabase(db) {
    collection = db.collection("modulecards");
}

/**
 * Endpoint for receiving metadata cards for modules and saving them to the database.
 */
const createModuleCard = async (req, res) => {
    try {
        console.log("Received module card data: ", req.body);
        const odrlDocument = req.body;

        // Extract the permission block
        if (!odrlDocument.permission || !Array.isArray(odrlDocument.permission)) {
            throw new Error("Invalid ODRL document: Missing or invalid 'permission' section.");
        }

        const permission = odrlDocument.permission[0];
        const moduleData = parseModulePermission(permission);

        // Add a timestamp and save to the database
        moduleData.dateReceived = new Date();
        await collection.insertOne(moduleData);

        res.status(200).send({ message: "Module card received and saved", moduleData });
    } catch (e) {
        console.error("Error processing module card: ", e);
        res.status(500).send({ message: "Error processing module card" });
    }
};

/**
 * Parses the permission block of an ODRL document to extract module data.
 */
const parseModulePermission = (permission) => {
    const { target, action, constraint } = permission;

    if (!target || !action || !constraint || !Array.isArray(constraint)) {
        throw new Error("Invalid permission structure in ODRL document.");
    }

    const moduleData = {
        moduleid: target,
        name: action, // Assuming the action corresponds to the module's name/type
    };

    // Map constraints to module properties
    constraint.forEach(({ leftOperand, rightOperand }) => {
        if (leftOperand === "risk-level") {
            moduleData["risk-level"] = rightOperand;
        } else if (leftOperand === "input-type") {
            moduleData["input-type"] = rightOperand;
        } else if (leftOperand === "output-risk") {
            moduleData["output-risk"] = rightOperand;
        }
    });

    return moduleData;
};

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
