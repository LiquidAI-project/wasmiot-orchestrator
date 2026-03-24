const { ObjectId } = require("mongodb");
const express = require("express");

const {
    EXECUTION_INPUT_DIR,
    EXECUTION_RESULT_FETCH_TIMEOUT_MS,
    deviceFetchAgent,
} = require("../constants.js");
const utils = require("../utils.js");

/**
 * Rewrite 127.0.0.1/localhost in a URL to the device's actual address.
 * Supervisors return resultUrl with their own localhost, which is unreachable
 * from the orchestrator when it runs on a different host.
 */
function rewriteResultUrl(url, deviceHost) {
    if (!url || !deviceHost) return url;
    try {
        const parsed = new URL(url);
        if (["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
            parsed.hostname = deviceHost;
            return parsed.toString();
        }
    } catch (e) {}
    return url;
}

/**
 * Supervisor sometimes returns result="Mount error: ..." while resultUrl points at request-history
 * that later shows success:true (stale error string). If history says success, prefer that.
 */
async function tryPreferRequestHistoryWhenResultLooksLikeMountError(json, deviceHost, isInFailover) {
    if (!json || !json.resultUrl) {
        return null;
    }
    const msg = typeof json.result === "string" ? json.result : "";
    if (!msg || (!msg.includes("Mount error") && !msg.includes("Unexpected input file"))) {
        return null;
    }
    let resultUrlStr = json.resultUrl;
    if (deviceHost) {
        resultUrlStr = rewriteResultUrl(resultUrlStr, deviceHost);
    }
    try {
        const options = { method: "GET" };
        if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) {
            options.signal = AbortSignal.timeout(EXECUTION_RESULT_FETCH_TIMEOUT_MS);
        }
        if (deviceFetchAgent) {
            options.dispatcher = deviceFetchAgent;
        }
        const r = await fetch(resultUrlStr, options);
        if (!r.ok) {
            return null;
        }
        const hist = await r.json();
        if (hist && hist.success === true) {
            let device;
            try {
                device = new URL(resultUrlStr).hostname;
            } catch (e) {}
            let resultUrlOut = resultUrlStr;
            if (deviceHost) {
                resultUrlOut = rewriteResultUrl(resultUrlStr, deviceHost);
            }
            const fetchedFrom =
                deviceHost ||
                (device && !["127.0.0.1", "localhost", "::1"].includes(device) ? device : null) ||
                device;
            return {
                result: hist.result !== undefined ? hist.result : null,
                fetched_from_device: fetchedFrom,
                resultUrl: resultUrlOut,
                isInFailover: isInFailover,
            };
        }
    } catch (e) {
        console.log("tryPreferRequestHistoryWhenResultLooksLikeMountError:", e.message);
    }
    return null;
}

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
        filter._id = new ObjectId(request.params.deploymentId);
    } catch (e) {
        console.error(`Passed in deployment-ID '${request.params.deploymentId}' not compatible as ObjectID. Using it as 'name' instead`);
        filter.name = request.params.deploymentId;
    }
    let deployment = await deploymentCollection.findOne(filter);
    const isInFailover = deployment.isInFailover === true;

    if (!deployment) {
        response.status(404).send();
        return;
    }

    try {
        let args = {};
        // Merge query params into body: Python client sends params as URL query string;
        // when body is undefined (e.g. POST with no body), schedule() would crash on
        // "param0 in undefined". Use query as fallback so param0, param1, etc. are available.
        args.body = Object.assign({}, request.query || {}, request.body || {});
        if (request.files) {
            args.files = request.files.map(file => ({ path: file.path, name: file.fieldname }));
        } else {
            args.files = [];
        }
        let execResponse = await orchestrator.schedule(deployment, args);
        if (!execResponse.ok) {
            throw JSON.stringify(await execResponse.json());
        }
        // Device host for rewriting 127.0.0.1 in resultUrl (supervisor returns its localhost)
        let deviceHost = null;
        try {
            const startEndpoint = utils.getStartEndpoint(deployment);
            if (startEndpoint && startEndpoint.url) {
                deviceHost = startEndpoint.url.hostname;
            }
        } catch (e) {
            console.log("Could not get start endpoint for resultUrl rewrite:", e.message);
        }
        // Recursively seek the end of the execution chain in order respond with
        // the end result of all steps in the executed sequence.
        let tries = 0;
        let depth = 0;
        let statusCode = 500;
        let result = new utils.Error("undefined error");
        let redirectUrl;
        let options;
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
                    let resultStr = typeof json.result === "string" ? json.result : String(json.result);
                    if (deviceHost) resultStr = rewriteResultUrl(resultStr, deviceHost);
                    redirectUrl = new URL(resultStr);
                    depth += 1;
                } catch (e) {
                    // Non-URL result string: often final output, but supervisor may send a stale
                    // mount error while request-history for resultUrl is success — prefer history.
                    const preferred = await tryPreferRequestHistoryWhenResultLooksLikeMountError(
                        json,
                        deviceHost,
                        isInFailover
                    );
                    if (preferred) {
                        result = preferred;
                        statusCode = 200;
                        break;
                    }
                    // Assume this is the final result.
                    console.log("Result found!", JSON.stringify(json, null, 2));
                    let device;
                    if (json.resultUrl) {
                        try {
                            device = new URL(json.resultUrl).hostname;
                        } catch (e) {}
                    }

                    let resultUrlOut = json.resultUrl;
                    if (deviceHost) resultUrlOut = rewriteResultUrl(resultUrlOut, deviceHost);
                    if (!device && resultUrlOut) {
                        try { device = new URL(resultUrlOut).hostname; } catch (e) {}
                    }
                    // Prefer deviceHost (actual device IP); avoid 127.0.0.1 from device URL
                    const fetchedFrom = deviceHost || (device && !["127.0.0.1", "localhost", "::1"].includes(device) ? device : null) || device;
                    result = {
                        result: json.result,
                        fetched_from_device: fetchedFrom,
                        resultUrl: resultUrlOut,
                        isInFailover: isInFailover // Pass the failover-state of the deployment to the client, so that it can be displayed in the UI.
                    };

                    statusCode = 200;
                    break;
                }
            } else if (json.error) {
                result = new utils.Error(json.error);
                break;
            } else if (json.resultUrl) {
                try {
                    let resultUrlStr = json.resultUrl;
                    if (deviceHost) resultUrlStr = rewriteResultUrl(resultUrlStr, deviceHost);
                    redirectUrl = new URL(resultUrlStr);
                } catch (e) {
                    console.log(`received a bad redirection-URL`, e);
                }
                depth += 1;
            }

            if (!redirectUrl) break;

            options = { method: "GET" };
            if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) {
                options.signal = AbortSignal.timeout(EXECUTION_RESULT_FETCH_TIMEOUT_MS);
            }
            if (deviceFetchAgent) {
                options.dispatcher = deviceFetchAgent;
            }

            console.log(`(Try ${tries}, depth ${depth}) Fetching result from: ${redirectUrl}`);
            execResponse = await fetch(redirectUrl, options);

            if (!execResponse.ok) {
                // Wait for a while, if the URL is not yet available.
                if (execResponse.status == 404 && depth < 5 && tries < 5) {
                    await new Promise(resolve => setTimeout(resolve, 5000));
                } else {
                    let bodyHint = "";
                    try {
                        const txt = await execResponse.text();
                        if (txt && txt.length < 200) bodyHint = ": " + txt;
                    } catch (_) {}
                    const host = redirectUrl ? (redirectUrl.hostname || String(redirectUrl)) : "?";
                    console.error(`Fetch result failed: ${redirectUrl} -> ${execResponse.status} ${execResponse.statusText}${bodyHint}`);
                    result = new utils.Error("fetching result failed: " + execResponse.status + " from " + host + bodyHint);
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