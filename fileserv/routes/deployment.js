const express = require("express");
const { ObjectId } = require("mongodb");


const utils = require("../utils.js");

let deploymentCollection = null;

function setDatabase(db) {
    deploymentCollection = db.collection("deployment");
}

let orchestrator = null;

function setOrchestrator(orch) {
    orchestrator = orch;
}

/**
 * Validate manifest (this is static typing manually).
 */
const validateManifest = (mani) => {
    if (!(typeof mani.name === "string"))
        { throw "manifest must have a name"; }
    if (!(typeof mani.sequence === "object" && mani.sequence instanceof Array))
        { throw "manifest must have a sequence of operations"; }
    for (let node of mani.sequence) {
        if (!(typeof node.module === "string"))
            { throw "manifest node must have a module"; }
        if (!(typeof node.func === "string"))
            { throw "manifest node must have a function"; }
    }
}

/**
 * GET list of packages or the "deployment manifest"; used by IoT-devices.
 */
const getDeployment = async (request, response) => {
    // FIXME Crashes on bad _format_ of id (needs 12 byte or 24 hex).
    let doc = await deploymentCollection.findOne(
        { _id: ObjectId(request.params.deploymentId) }
    );

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
    let deployments = await (await deploymentCollection.find()).toArray();
    response.json(deployments);
}

/**
 * POST a deployment manifest to solve save and enact immediately. For now this
 * replaces an existing deployment with the same name (which isn't really
 * aligned with a ReStFuL PoSt...).
 */
const createDeployment = async (request, response) => {
    let manifest = request.body;
    try {
        validateManifest(manifest);
    } catch (err) {
        let errorMsg = "Failed validating manifest";
        console.error(errorMsg, err);
        response
            .status(400)
            .json(new utils.Error(errorMsg, err));
        return;
    }

    try {
        let deploymentId = await orchestrator.solve(manifest);

        // NOTE: Sending plain text, not e.g., JSON! (This removes the need to
        // parse the ID from some structural format.)
        response.set("Content-Type", "text/plain");
        response.status(201).send(deploymentId);
    } catch (err) {
        let errorMsg = "Failed constructing solution for manifest";

        console.error(errorMsg, err, err.stack);

        response
            .status(500)
            .json(new utils.Error(errorMsg, err));
    }
}

const tryDeploy = async (deploymentDoc, response) => {
    try {
        let responses = await orchestrator.deploy(deploymentDoc);

        console.log("Deploy-responses from devices: ", responses);

        // Update the deployment to "active" status.
        await deploymentCollection.updateOne(
            { _id: ObjectId(deploymentDoc._id) },
            { $set: { active: true } }
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
    let filter = {};
    try {
        filter._id = ObjectId(request.params.deploymentId);
    } catch (e) {
        console.error(`Passed in deployment-ID '${request.params.deploymentId}' not compatible as ObjectID. Using it as 'name' instead`);
        filter.name = request.params.deploymentId;
    }

    let deploymentDoc = await deploymentCollection.findOne(filter);
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
    let { deletedCount } = await deploymentCollection.deleteMany();
    response
        .status(200)
        .json({ deletedCount });
}

/**
 * Update a deployment from PUT request and perform needed migrations on already
 * deployed instructions.
 * @param {*} request Same as for `createDeployment`.
 * @param {*} response
 */
const updateDeployment = async (request, response) => {
    let oldDeployment = await deploymentCollection
        .findOne({ _id: ObjectId(request.params.deploymentId) });

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