/**
 * Initialize server, database, mDNS and routes as needed.
 */

const { chdir } = require('process');

const { MongoClient, ObjectId } = require("mongodb");

const { MONGO_URI, PUBLIC_PORT, PUBLIC_BASE_URI, DEVICE_TYPE } = require("./constants.js");
const { init: initApp } = require("./src/app");
const discovery = require("./src/deviceDiscovery");
const { Orchestrator } = require("./src/orchestrator");
const utils = require("./utils.js");
const { initializeCoreServices } = require("./routes/coreServices");

/**
 * The Express app.
 */
let app;

/**
 * The underlying nodejs http-server that app.listen() returns.
 */
let server;

/**
 * For operations on the database connection and its collections.
 */
let database;

/**
 * Thing to use for searching and listing services found (by mDNS).
 */
let deviceDiscovery;

/**
 * The thing responsible of and containing logic on orchestrating deployments of
 * modules on devices.
 */
let orchestrator;

// Set working directory to this file's root in order to use relative paths
// (i.e. "./foo/bar"). TODO Find out if the problem is with incompatible Node
// versions (16 vs 18).
chdir(__dirname);


const testing = process.env.NODE_ENV === "test";
if (testing) {
    console.log("! RUNNING IN TEST MODE");
}

///////////
// RUN MAIN:

async function main() {
    console.log("Orchestrator starting...")

    // Must (successfully) wait for database before starting to listen for
    // web-clients or scanning devices.
    await initializeDatabase();

    try {
        deviceDiscovery = new discovery.DeviceDiscovery(type=DEVICE_TYPE, database);
    } catch(e) {
        console.log("Device discovery initialization failed: ", e);
        throw e;
    }

    orchestrator = new Orchestrator(
        { database, deviceDiscovery },
        {
            packageManagerBaseUrl: PUBLIC_BASE_URI,
            deviceMessagingFunction: utils.messageDevice
        }
    );

    app = await initApp({ database, deviceDiscovery, orchestrator, testing });

    initAndRunDeviceDiscovery();
    initServer();
}

main()
    .catch((e) => {
        console.error("Orchestrator failed to start: ", e);
        shutDown();
    });


//////////////////////////
// INITIALIZATION HELPERS:

/*
* Initialize and connect to the database.
*
* @throws If the connection fails (timeouts).
*/
async function initializeDatabase() {
    let client = new MongoClient(MONGO_URI);
    console.log("Connecting to database client: ", client);

    try {
        await client.connect();
        database = client.db();
        console.log("Database connection success!");
    } catch(e) {
        console.error("Database connection fail.");
        // Propagate to caller.
        throw e;
    }
}

/**
 * Create a new device discovery instance and run it.
 *
 * NOTE: Throws if fails.
 */
function initAndRunDeviceDiscovery() {
    try {
        deviceDiscovery = new discovery.DeviceDiscovery(type=DEVICE_TYPE, database);
    } catch(e) {
        console.log("Device discovery initialization failed: ", e);
        throw e;
    }
    deviceDiscovery.startDiscovery();
}

/**
 * Initialize the server exposing orchestrator API.
 */
function initServer() {
    server = app.listen(PUBLIC_PORT)

    server.on("listening", () => {
        console.log(
            "Orchestrator is available at: ",
            PUBLIC_BASE_URI
        );
        // Now that the server is up, initialize the core services.
        initializeCoreServices();
    });

    server.on("error", (e) => {
        if (e.code === 'EADDRINUSE') {
            console.error("Server failed to start", e);
            shutDown();
        }
    });
}


////////////
// SHUTDOWN:

process.on("SIGTERM", shutDown);
// Handle CTRL-C gracefully; from
// https://stackoverflow.com/questions/43003870/how-do-i-shut-down-my-express-server-gracefully-when-its-process-is-killed
process.on("SIGINT", shutDown);

/**
 * Shut the server and associated services down.
 */
async function shutDown() {
    console.log("Orchestrator shutting down...");

    if (server) {
        await server.close();
    }

    if (database) {
        await database.close();
        console.log("Closed database connection.");
    }

    if (deviceDiscovery) {
        deviceDiscovery.destroy();
        console.log("Destroyed the mDNS instance.");
    }

    console.log("Finished shutting down.");
    process.exit();
}


module.exports = app;