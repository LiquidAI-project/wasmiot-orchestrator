const { ObjectId } = require("mongodb");
const express = require("express");

const { EXECUTION_INPUT_DIR } = require("../constants.js");
const utils = require("../utils.js");


let deploymentCollection = null

function setDatabase(db) {
    deploymentCollection = db.collection("deployment");
}

let orchestrator = null

function setOrchestrator(orch) {
    orchestrator = orch;
}

/**
 * Send data to the first device in the deployment-sequence in order to
 * kickstart the application execution.
 */
const execute = async (request, response) => {
    let filter = {};
    try {
        filter._id = ObjectId(request.params.deploymentId);
    } catch (e) {
        console.error(`Passed in deployment-ID '${request.params.deploymentId}' not compatible as ObjectID. Using it as 'name' instead`);
        filter.name = request.params.deploymentId;
    }
    let deployment = await deploymentCollection.findOne(filter);

    if (!deployment) {
        response.status(404).send();
        return;
    }

    try {
        let args = {};
        args.body = request.body;
        if (request.files) {
            args.files = request.files.map(file => ({ path: file.path, name: file.fieldname }));
        } else {
            args.files = [];
        }
        let execResponse = await orchestrator.schedule(deployment, args);
        if (!execResponse.ok) {
            throw JSON.stringify(await execResponse.json());
        }
        // Recursively seek the end of the execution chain in order respond with
        // the end result of all steps in the executed sequence.
        let tries = 0;
        let depth = 0;
        let statusCode = 500;
        let result = new utils.Error("undefined error");
        let redirectUrl;
        while (true) {
            let json;
            try {
                json = await execResponse.json();
            } catch (e) {
                result = new utils.Error("parsing result to JSON failed: " + e.errorText);
                break;
            }

            // TODO: This is just temporary way to check for result. Would be
            // better that supervisor responds with error code, not 200.
            if (json.result && json.status !== "error") {
                // Check if the result is a URL to follow...
                try {
                    redirectUrl = new URL(json.result);
                    depth += 1;
                } catch (e) {
                    // Assume this is the final result.
                    console.log("Result found!", JSON.stringify(json, null, 2));
                    result = json.result;
                    statusCode = 200;
                    break;
                }
            } else if (json.error) {
                result = new utils.Error(json.error);
                break;
            } else if (json.resultUrl) {
                try {
                    redirectUrl = new URL(json.resultUrl);
                } catch (e) {
                    console.log(`received a bad redirection-URL`, e);
                }
                depth += 1;
            }

            options = { method: "GET" };

            console.log(`(Try ${tries}, depth ${depth}) Fetching result from: ${redirectUrl}`);
            execResponse = await fetch(redirectUrl, options);

            if (!execResponse.ok) {
                // Wait for a while, if the URL is not yet available.
                if (execResponse.status == 404 && depth < 5 && tries < 5) {
                    await new Promise(resolve => setTimeout(resolve, 5000));
                } else {
                    result = new utils.Error("fetching result failed: " + execResponse.statusText);
                    break;
                }
            }

            tries += 1;
        }

        response
            .status(statusCode)
            .json(result);
    } catch (e) {
        console.error("failure in execution:", e);
        response
            .status(500)
            .json(new utils.Error("scheduling work failed", e));
    }
}

const fileUpload = utils.fileUpload(EXECUTION_INPUT_DIR);


const router = express.Router();
router.post("/:deploymentId", fileUpload, execute);


module.exports = { setDatabase, setOrchestrator, router };