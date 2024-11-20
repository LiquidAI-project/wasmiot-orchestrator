const express = require("express");

let collection = null;

async function setDatabase(db) {
    collection = db.collection("zones");
}

/**
 * Endpoint for receiving metadata cards for zones and risk levels, parsing them,
 * and saving the parsed results to the database.
 */
const parseZonesAndRiskLevels = async (req, res) => {
    try {
        console.log("Received zone and risk-level definitions: ", req.body);
        const odrlDocument = req.body;

        // Parse zones and risk levels
        const { zoneRiskMappings, riskLevels } = extractZoneAndRiskLevelMappings(odrlDocument);

        // Save zone mappings to the database
        for (const zone of zoneRiskMappings) {
            await collection.updateOne(
                { zone: zone.zone },
                { $set: { allowedRiskLevels: zone.allowedRiskLevels } },
                { upsert: true }
            );
        }

        // Save risk levels to the database (as a separate collection or metadata entry)
        await collection.updateOne(
            { type: "riskLevels" },
            { $set: { levels: riskLevels, lastUpdated: new Date() } },
            { upsert: true }
        );

        res.status(200).send({
            message: "Zone and risk-level definitions parsed and saved successfully",
            zones: zoneRiskMappings,
            riskLevels
        });
    } catch (e) {
        console.error("Error parsing zone and risk-level definitions: ", e);
        res.status(500).send({ message: "Error parsing zone and risk-level definitions" });
    }
};

/**
 * Extracts zone mappings and risk levels from an ODRL document.
 */
const extractZoneAndRiskLevelMappings = (odrlDocument) => {
    const zoneRiskMappings = [];
    const riskLevels = new Set();

    // Extract risk levels and their allowed zones
    odrlDocument.permission.forEach((permission) => {
        const riskLevel = permission.target;
        riskLevels.add(riskLevel); // Collect all risk levels

        permission.constraint.forEach((constraint) => {
            if (constraint.leftOperand === "zone") {
                const allowedZones = Array.isArray(constraint.rightOperand)
                    ? constraint.rightOperand
                    : [constraint.rightOperand];

                allowedZones.forEach((zone) => {
                    const existingZone = zoneRiskMappings.find((z) => z.zone === zone);
                    if (existingZone) {
                        existingZone.allowedRiskLevels.push(riskLevel);
                    } else {
                        zoneRiskMappings.push({
                            zone: zone,
                            allowedRiskLevels: [riskLevel]
                        });
                    }
                });
            }
        });
    });

    // Convert the set of risk levels into a sorted list
    const riskLevelsList = Array.from(riskLevels).sort();

    return { zoneRiskMappings, riskLevels: riskLevelsList };
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
router.post("/", parseZonesAndRiskLevels);
router.get("/", getDataSourceCard);


module.exports = { setDatabase, router };
