const express = require("express");


let database = null;

function setDatabase(db) {
    database = db;
}

/**
 * Endpoint for receiving logs from the supervisor and save them to database.
 */
const createSupervisorLogs = async (req, res) => {
    try {
        const logData = JSON.parse(req.body.logData);
        await database.create("supervisorLogs", [logData]);
        res.status(200).send({ message: 'Log received and saved' });
    } catch (e) {
        console.error(e);
        res.status(500).send({ message: 'Log not received nor saved' });
        return;
    }
}

/**
 * Get all supervisor related logs from the database.
 */
const getSupervisorLogs= async (request, response) => {
    response.json(await database.read("supervisorLogs"));
}

const router = express.Router();
router.post("/", createSupervisorLogs);
router.get("/", getSupervisorLogs);


module.exports = { setDatabase, router };
