/**
 * Read in environment variables and define constants based on them.
 * Also contains some static values used in the system.
 */

const path = require("path");

require('dotenv').config({path: path.join(__dirname, "..", ".env"), override: true});

const mongo_host = process.env.MONGODB_HOST || "mongo";
const mongo_port = process.env.MONGODB_PORT || "27017";
const mongo_user = process.env.MONGO_ROOT_USERNAME;
const mongo_pass = process.env.MONGO_ROOT_PASSWORD;
const MONGO_URI = `mongodb://${mongo_user}:${mongo_pass}@${mongo_host}:${mongo_port}/`;

const SENTRY_DSN = process.env.SENTRY_DSN;

const public_host = process.env.PUBLIC_HOST || `http://${require("os").hostname()}`;
const PUBLIC_PORT = process.env.PUBLIC_PORT || "3000";
const PUBLIC_BASE_URI = `${public_host}:${PUBLIC_PORT}/`;

const MODULE_DIR = path.join(__dirname, "files", "wasm");
const EXECUTION_INPUT_DIR = path.join(__dirname, "files", "exec");
const FRONT_END_DIR = path.join(__dirname, "frontend");
const UTILS_PATH = path.join(__dirname, "./utils.js");

// NOTE: "webthing" is what the JS-library returns as type for Flask-host's
// "_webthing._tcp.local.", soooo search for those.
const DEVICE_TYPE = "webthing";
// TODO: Use dot after "local" or no?
const DEVICE_DESC_ROUTE = "/.well-known/wasmiot-device-description";
const DEVICE_WOT_ROUTE = "/.well-known/wot-thing-description";
const DEVICE_HEALTH_ROUTE = "/health";

const FILE_TYPES = [
    "image/png",
    "image/jpeg",
    "image/jpg",
    "application/octet-stream"
];

/**
 * Special name of an init function, that is expected to be called at deployment
 * time by the supervisor before any other of a module's functions. The
 * init-function allows the __module itself__ to do any initialization that is
 * needed instead of relying on what the supervisor performs (e.g., mounting).
 *
 * Files that the function creates as side-effects are then regarded as a
 * "deployment"-stage mount for all the needed functions to access. These files
 * could for example contain database-initialization IDs or other things that
 * are needed or convenient to compute at run-time.
 */
const WASMIOT_INIT_FUNCTION_NAME = "_wasmiot_init";

module.exports = {
    MONGO_URI,
    SENTRY_DSN,
    PUBLIC_PORT,
    PUBLIC_BASE_URI,
    MODULE_DIR,
    DEVICE_DESC_ROUTE,
    DEVICE_HEALTH_ROUTE,
    DEVICE_TYPE,
    FRONT_END_DIR,
    DEVICE_SCAN_DURATION_MS: 5*1000,
    DEVICE_SCAN_INTERVAL_MS: 120*1000,
    DEVICE_HEALTH_CHECK_INTERVAL_MS: 180*1000,
    EXECUTION_INPUT_DIR,
    UTILS_PATH,
    FILE_TYPES,
    WASMIOT_INIT_FUNCTION_NAME,
};
