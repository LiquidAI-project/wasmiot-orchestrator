const express = require("express");
const WebSocket = require("ws");

let collection = null;
let wss = null;
let lastChecked = new Date();

async function setDatabase(db) {
    collection = db.collection("supervisorLogs");
    // Start the polling mechanism
    pollForNewLogs();
}

function setWebSocketServer(webSocketServer) {
    wss = webSocketServer;
}

// Poll for new logs every 5 seconds
async function pollForNewLogs() {
    try {
        const newLogs = await collection.find({ dateReceived: { $gt: lastChecked } }).toArray();
        if (newLogs.length > 0) {
            // Update the lastChecked time
            lastChecked = new Date();
            // Broadcast new logs to all connected WebSocket clients
            wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    newLogs.forEach(log => client.send(JSON.stringify(log)));
                }
            });
        }
    } catch (error) {
        console.error('Error while polling for new logs:', error);
    } finally {
        // Schedule the next poll
        setTimeout(pollForNewLogs, 5000);
    }
}

// Define schema for the supervisor logs
// const schema = {
//     type: "object",
//     properties: {
//         dateReceived: { type: "string" },
//         ...
//     },
//     required: ["dateReceived", ...]
// };

/**
 * Endpoint for receiving logs from the supervisor and save them to database.
 */
const createSupervisorLogs = async (req, res) => {
    try {
        let logData = JSON.parse(req.body.logData);
        // Add timestamp to the log data
        logData.dateReceived = new Date();
        await collection.insertOne(logData);
        res.status(200).send({ message: 'Log received and saved' });
    } catch (e) {
        console.error(e);
        res.status(500).send({ message: 'Log not received nor saved' });
        return;
    }
}

/**
 * Get supervisor related logs from the database.
 * Example: /logs?date=2021-01-01T00:00:00.000Z
 */
const getSupervisorLogs = async (request, response) => {
    // Make sure we have the index on dateReceived field
    await collection.createIndex({ dateReceived: 1 });

    let filterRule = {};
    if (request.query.after) {
        console.log("Getting logs after date: ", new Date(request.query.after));
        // Check if date is provided, if so, get logs after that date,
        filterRule = { dateReceived: { $gt: new Date(request.query.after) } };
    }
    const logs = await collection.find(filterRule).toArray();
    response.json(logs);
}


const router = express.Router();
router.post("/", createSupervisorLogs);
router.get("/", getSupervisorLogs);


module.exports = { setDatabase, router, setWebSocketServer };
