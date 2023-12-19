// Hack to make this file work in both Node.js and browser without erroring.
let runningInBrowser = false;
let multer = undefined;
try {
    multer = require("multer");
} catch (e) {
    console.log("Importing with 'require' failed; assuming we're in a browser");
    runningInBrowser = true;
}


/**
 * Return the path that is used on supervisor for calling functions.
 * @param {*} moduleId
 * @param {*} funcName
 * @returns
 */
function supervisorExecutionPath(moduleName, funcName) {
    return `/{deployment}/modules/${moduleName}/${funcName}`;
}

/// Perform boilerplate tasks when responding with a file read from filesystem.
function respondWithFile(response, filePath, contentType) {
    response.status(200)
        .type(contentType)
        .sendFile(filePath);
}

function reducer(dependency, version) {
    if (!dependency[version]) {
        dependency.push(version);
    }
    else return null;

}

/**
 * Send a message to device with HTTP.
 * @param {*} device Device object describing communication (i.e. device address and port).
 * @param {*} path Path to send the message to.
 * @param {*} body Message content that will be serialized into JSON.
 * @param {*} method HTTP method to use.
 * @return {*} Promise of the HTTP response's status code and body parsed from JSON: `{ status, data }`.
 */
function messageDevice(device, path, body, method="POST") {
    let url = new URL(`http://${device.communication.addresses[0]}:${device.communication.port}/${path}`);
    let requestOptions = {
        method: method,
        headers: {
            "Content-type": "application/json",
            // TODO: This might not be needed: "Content-length": Buffer.byteLength(jsonStr),
        },
        body: JSON.stringify(body),
    };

    console.log(`Sending '${method}' request to device '${url}': `, body);

    return fetch(url, requestOptions)
        .then(response => response.json().then(data => ({ status: response.status, data })));
}

/**
 * Generic representation of an error response from the API.
 *
 * Fields:
 * - `errorText` Human friendly description of the error that client could
 * choose to display.
 * - `error` The concrete error object.
 */
class ApiError {
    constructor(errorText, error) {
        this.errorText = errorText;
        this.error = error || "error";
    }
}

/**
* Middleware to confirm existence of an incoming file from a user-submitted
* form (which apparently `multer` does not do itself...).
*/
function validateFileFormSubmission(request, response, next) {
    if (request.method !== "POST") { next(); return; }

    // Check that request contains files uploaded.
    if (!request.hasOwnProperty("files")) {
        response.status(400).send("file-submission missing");
        console.log("Bad request; needs a file-input for the module field");
        return;
    }
    next();
}

/**
 * Set where a file uploaded from a HTML-form will be saved to on the
 * filesystem.
 *
 * From: https://www.twilio.com/blog/handle-file-uploads-node-express
 * @param {*} destinationFilePath
 * @returns Middleware for saving incoming files named in by strings in `fields`.
 */
const fileUpload =
    (destinationFilePath) =>
        //(fields) =>
            multer({ dest: destinationFilePath })
                .any();
                //TODO: This'd be a tad nicer/secure: .fields(fields.map(field => ({ name: field, maxCount: 1 })));

/**
 * Return the main OpenAPI 3.1.0 operation of a deployment manifest starting
 * endpoint. This defines how a deployment's execution is started.
 *
 * @param {*} deployment Object with deployment fields
 * @returns { url, path, method, operationObj }
 */
function getStartEndpoint(deployment) {
    let startStep = deployment.sequence[0];
    let modId = startStep.module;
    let modName = deployment
        .fullManifest[startStep.device]
        .modules
        .find(x => x.id.toString() === modId.toString()).name;
    let startEndpoint = deployment
        .fullManifest[startStep.device]
        .endpoints[modName][startStep.func];

    // Change the string url to an object.
    startEndpoint.url = new URL(startEndpoint.url);

    return startEndpoint;
}

/**
 * Map function parameters to names and mounts to files ultimately creating an
 * OpenAPI description for the module.
 * @param {*} module The module to describe (from DB).
 * @param {*} functionDescriptions Mapping of function names to their
 * descriptions.
 * @returns {*} Description for endpoints of the module in OpenAPI v3.0
 * format.
 */
const moduleEndpointDescriptions = (modulee, functionDescriptions) => {
    function isPrimitive(type) {
        return ["integer", "float"].includes(type);
    }

    /**
     * Create description for a single function.
     * @param {string} funcName
     * @param {*} func
     * @returns [functionCallPath, functionDescription]
     */
    function funcPathDescription(funcName, func) {
        let sharedParams = [
            {
                "name": "deployment",
                "in": "path",
                "description": "Deployment ID",
                "required": true,
                "schema": {
                    "type": "string"
                }
            }
        ];
        let funcParams = func.parameters.map(x => ({
            name: x.name,
            in: "query", // TODO: Where dis?
            description: "Auto-generated description",
            required: true,
            schema: {
                type: x.type
            }
        }));

        let funcDescription = {
            summary: "Auto-generated description of function",
            parameters: sharedParams,
        };
        let successResponseContent =  {};
        if (isPrimitive(func.outputType)) {
            successResponseContent["application/json"] = {
                schema: {
                    type: func.outputType
                }
            };
        } else {
            // Assume the response is a file.
            successResponseContent[func.outputType] = {
                schema: {
                    type: "string",
                    format: "binary",
                }
            };
        }
        funcDescription[func.method] = {
            tags: [],
            summary: "Auto-generated description of function call method",
            parameters: funcParams,
            responses: {
                200: {
                    description: "Auto-generated description of response",
                    content: successResponseContent
                }
            }
        };
        // Inside the `requestBody`-field, describe mounts that are used as
        // "input" to functions.
        let mounts = Object.entries(func.mounts).filter(x => x[1].stage !== "output");
        if (mounts.length > 0) {
            let mountEntries = Object.fromEntries(
                    mounts.map(([path, _mount]) => [
                        path,
                        {
                            type: "string",
                            format: "binary",
                        }
                    ])
            );
            let mountEncodings = Object.fromEntries(
                mounts.map(([path, mount]) => [path, { contentType: mount.mediaType }])
            );
            let content = {
                "multipart/form-data": {
                    schema: {
                        type: "object",
                        properties: mountEntries
                    },
                    encoding: mountEncodings
                }
            };
            funcDescription[func.method].requestBody = {
                required: true,
                content,
            };
        }

        return [
            supervisorExecutionPath(modulee.name, funcName),
            funcDescription
        ];
    }

    // TODO: Check that the module (i.e. .wasm binary) and description info match.

    let funcPaths = Object.entries(functionDescriptions).map(x => funcPathDescription(x[0], x[1]));
    const description = {
        openapi: "3.0.3",
        info: {
            title: `${modulee.name}`,
            description: "Calling microservices defined as WebAssembly functions",
            version: "0.0.1"
        },
        tags: [
            {
            name: "WebAssembly",
            description: "Executing WebAssembly functions"
            }
        ],
        servers: [
            {
                url: "http://{serverIp}:{port}",
                variables: {
                    serverIp: {
                        default: "localhost",
                        description: "IP or name found with mDNS of the machine running supervisor"
                    },
                    port: {
                        enum: [
                            "5000",
                            "80"
                        ],
                        default: "5000"
                    }
                }
            }
        ],
        paths: {...Object.fromEntries(funcPaths)}
    };

    return description;
};


/**
 * Small wrapper for calling the orchestrator API.
 * @param {*} url
 * @param {*} method
 * @param {*} body
 * @param {*} headers
 * @returns
 */
async function apiCall(url, method, body, headers={"Content-Type": "application/json"}) {
    let options = {
        method: method,
        body: body
    };
    if (headers) {
        options.headers = headers;
    }
    const response = await fetch(url, options);

    if (response.status === 204) {
        return { success: "API call succeeded with no further response data" };
    }

    // Assume parsing JSON will fail.
    let result = {
        error: true,
        errorText: `Parsing API response to JSON failed (see console)`
    };
    try {
        const theJson = await response.json();
        // Replace with successfull result.
        result = { success: theJson };
    } catch(e) {
        console.error(e)
    }

    return result;
}

if (!runningInBrowser) {
    module.exports = {
        supervisorExecutionPath,
        respondWithFile,
        messageDevice,
        Error: ApiError,
        validateFileFormSubmission,
        fileUpload,
        getStartEndpoint,
        moduleEndpointDescriptions,
        apiCall,
    };
}