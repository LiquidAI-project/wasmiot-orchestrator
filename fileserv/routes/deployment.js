const express = require("express");

const utils = require("../utils.js");

let database = null;

function setDatabase(db) {
    database = db;
}

let orchestrator = null;

function setOrchestrator(orch) {
    orchestrator = orch;
}

/**
 * Validate manifest (this is static typing manually).
 */
const validateManifest = (mani) => {
    console.assert(typeof mani.name === "string", "manifest must have a name");
    console.assert(typeof mani.sequence === "object" && mani.sequence instanceof Array, "manifest must have a sequence of operations");
    for (let node of mani.sequence) {
        console.assert(typeof node.module === "string", "manifest node must have a module");
        console.assert(typeof node.func === "string", "manifest node must have a function");
    }
}

/**
 * GET list of packages or the "deployment manifest"; used by IoT-devices.
 */
const getDeployment = async (request, response) => {
    // FIXME Crashes on bad _format_ of id (needs 12 byte or 24 hex).
    let doc = (await database.read(
        "deployment",
        { _id: request.params.deploymentId }
    ))[0];

    if (doc) {
        response.json(doc);
    } else {
        let err = new utils.Error(`Failed querying for deployment id: ${request.params.deploymentId}`);
        console.log(err);
        response.status(400).send(err);
    }
}

/**
 * GET list of all deployments; used by Actors in inspecting their deployments.
 */
const getDeployments = async (request, response) => {
    // TODO What should this ideally return? Only IDs and descriptions?
    response.json(await database.read("deployment"));
}

/**
 * POST a deployment manifest to solve save and enact immediately. For now this
 * replaces an existing deployment with the same name (which isn't really
 * aligned with a ReStFuL PoSt...).
 */
const createDeployment = async (request, response) => {
    let manifest = request.body;
    validateManifest(manifest);

    try {
        let deploymentId = await orchestrator.solve(manifest);

        response.status(201).json({ id: deploymentId });
    } catch (err) {
        errorMsg = "Failed constructing solution for manifest" + err;

        console.error(errorMsg, err.stack);

        response
            .status(500)
            .json(new utils.Error(errorMsg));
    }
}

const tryDeploy = async (deploymentDoc, response) => {
    try {
        let responses = await orchestrator.deploy(deploymentDoc);

        console.log("Deploy-responses from devices: ", responses);

        // Update the deployment to "active" status.
        await database.update(
            "deployment",
            { _id: deploymentDoc._id },
            { active: true }
        );

        response.json({ deviceResponses: responses });
    } catch(err) {
        switch (err.name) {
            case "DeviceNotFound":
                console.error("device not found", err);
                response
                    .status(404)
                    .json(err);
                break;
            case "DeploymentFailed":
                console.error("try checking supervisor logs", err, err.stack);
                response
                    .status(500)
                    .json(err);
                break;
            default:
                let unknownErr = ["unknown error while deploying", err];
                response
                    .status(500)
                    .json(unknownErr);
                break;
        }
    }
};

/**
 *  Deploy applications and instructions to devices according to a pre-created
 *  deployment.
 */
const deploy = async (request, response) => {
    let deploymentDoc = (await database
        .read("deployment", { _id: request.params.deploymentId }))[0];

    if (!deploymentDoc) {
        response
            .status(404)
            .json(new utils.Error(`no deployment matches ID '${request.params.deploymentId}'`));
        return;
    }

    tryDeploy(deploymentDoc, response);
}

/**
 * Delete all the deployment manifests from database.
 */
const deleteDeployments = async (request, response) => {
    await database.delete("deployment");
    response.status(204).send();
}

/**
 * Update a deployment from PUT request and perform needed migrations on already
 * deployed instructions.
 * @param {*} request Same as for `createDeployment`.
 * @param {*} response
 */
const updateDeployment = async (request, response) => {
    let oldDeployment = (await database.read("deployment", { _id: request.params.deploymentId }))[0];

    if (!oldDeployment) {
        response
            .status(404)
            .json(new utils.Error(`no deployment matches ID '${request.params.deploymentId}'`));
        return;
    }

    let updatedDeployment;
    try {
        let newDeployment = request.body;
        newDeployment._id = oldDeployment._id;
        updatedDeployment = await orchestrator.solve(newDeployment, true);
    } catch (err) {
        errorMsg = "Failed updating manifest for deployment" + err;

        console.error(errorMsg, err.stack);

        response
            .status(500)
            .json(new utils.Error(errorMsg));
    }

    // If this has been deployed already, do needed migrations.
    if (oldDeployment.active) {
        tryDeploy(updatedDeployment, response);
    } else {
        response.status(204).send();
    }
};

const router = express.Router();
router.get("/:deploymentId", getDeployment);
router.get("/", getDeployments);
router.post("/", createDeployment);
router.post("/:deploymentId", deploy);
router.put("/:deploymentId", updateDeployment);
router.delete("/", deleteDeployments);


module.exports = { setDatabase, setOrchestrator, router };