/**
 * Defines the Express app and its routes.
 */

const express = require("express");
const cors = require('cors');
const mime = require('mime-types');

const { FRONT_END_DIR, SENTRY_DSN, UTILS_PATH } = require("../constants.js");


mime.extensions["application/wasm"] = ["wasm"];


let app;

/**
 * Inject dependencies (e.g., database, device discovery ...) to routes and
 * initialize the app.
 * @param {*} appDependencies
 */
async function init(appDependencies) {
    app = express();

    // Sentry should be initialized before any other middleware.
    if (!appDependencies.testing) {
        checkSentry();
    }

    // Allow cross-origin requests
    // - could provide more fine-grained control in the future
    app.use(cors());

    await setRoutes(appDependencies);

    return app;
}

/**
 * Note: call-order matters!
 */
async function setRoutes(routeDependencies) {
    // Serve the frontend files for use.
    app.use(express.static(FRONT_END_DIR));

    app.use(requestMethodLogger);

    // All the routes should parse JSON found in the request body.
    app.use(express.json());

    app.use(urlencodedExtendedMw);

    // POST-body needs to be parsed before trying to log it.
    app.use(postLogger);

    // Feature specific handlers:
    // Import router here, because they need to have the database and device
    // discovery available which should be done before initializing this
    // app...
    const { init: initRoutes } = require("../routes");
    let routes = await initRoutes(routeDependencies);
    app.use("/file/device",   routes.device);
    app.use("/file/module",   routes.modules);
    app.use("/file/manifest", routes.deployment);
    app.use("/execute",       routes.execution);
    app.use("",               routes.coreServicesRouter);
    app.use("/device/logs",   routes.logs);
    app.use("/moduleCards",   routes.moduleCards);
    app.use("/nodeCards",     routes.nodeCards);
    app.use("/dataSourceCards",     routes.dataSourceCards);
    app.use("/zoneRiskLevels", routes.zoneRiskLevels);
    app.use("/deploymentCertificates", routes.deploymentCertificates);

    // NOTE: This is for testing if for example an image file needs to be available
    // after execution of some deployed work.
    app.get("/files/:myPath", (request, response) => {
        response.sendFile("./files/" + request.params.myPath, { root: "." });
    });

    // Server utils code for frontend.
    app.get("/utils.js", (_, response) => { response.sendFile(UTILS_PATH); });

    // Serve API documentation
    app.get("/docs", (request, response) => {
        const path = require("path");
        const fs = require("fs");
        const docsPath = path.join(__dirname, "../../docs/orchestrator/api-docs.html");
        
        // Check if the documentation file exists
        if (!fs.existsSync(docsPath)) {
            response.status(404).send(`
                <html>
                    <head><title>API Documentation Not Found</title></head>
                    <body>
                        <h1>API Documentation Not Found</h1>
                        <p>The API documentation HTML file has not been generated yet.</p>
                        <p>Please run the following command from the <code>fileserv</code> directory:</p>
                        <pre>npm run docs:generate</pre>
                        <p>This will generate the documentation HTML file from the OpenAPI specification.</p>
                    </body>
                </html>
            `);
            return;
        }
        
        response.sendFile(docsPath);
    });

    // Direct to error-page when bad URL used.
    app.use((_, res) => {
        res.status(404).send({ err: "Bad URL" });
    });
}

/**
 * If Sentry should be initialized, do it.
 */
function checkSentry() {
    // Sentry early initialization so that it can catch errors in the rest of
    // the initialization.
    if (SENTRY_DSN) {
        // Sentry error handler must be before any other error middleware and after all controllers
        // to get errors from routes.
        const Sentry = require("@sentry/node");
        app.use(Sentry.Handlers.errorHandler());

        initSentry();

        console.log("Activated Sentry error reporting.");
    } else {
        console.log("Sentry error reporting not activated.");
    }
}

/**
 * Initialize Sentry error reporting, and add it to the express app.
 */
function initSentry() {
    const Sentry = require("@sentry/node");
    Sentry.init({
        dsn: SENTRY_DSN,
        environment: process.env.NODE_ENV,
        integrations: [
            // HTTP call tracing
            new Sentry.Integrations.Http({ tracing: true }),
            new Sentry.Integrations.Express({ app }),
            // Automatically instrument Node.js libraries and frameworks
            ...Sentry.autoDiscoverNodePerformanceMonitoringIntegrations(),
        ]
    });

    // RequestHandler creates a separate execution context, so that all
    // transactions/spans/breadcrumbs are isolated across requests
    app.use(Sentry.Handlers.requestHandler());
    // TracingHandler creates a trace for every incoming request
    app.use(Sentry.Handlers.tracingHandler());

    app.get("/sentry.js", (req, res) => {
        res.setHeader("Content-Type", "this.application/javascript");
        res.send(`
            Sentry.onLoad(function() {
                Sentry.init({
                    dsn: ${JSON.stringify(SENTRY_DSN)},
                    environment: ${JSON.stringify(process.env.NODE_ENV)},
                    integrations: [
                        new Sentry.Integrations.BrowserTracing()
                    ],
                });
            });
        `);
    });

    // The error handler must be before any other error middleware and after all controllers
    //this.app.use(Sentry.Handlers.errorHandler());
}

/////////////
// MIDDLEWARE

/**
 * Middleware to log request methods.
 */
const requestMethodLogger = (request, response, next) => {
    console.log(`received ${request.method}: ${request.originalUrl}`);
    next();
}

/**
 * Middleware to log POST-requests.
 */
const postLogger = (request, response, next) => {
    if (request.method == "POST") {
        // If client is sending a POST request, log sent data.
        console.log("body: ", request.body);
    }
    next();
}

const urlencodedExtendedMw = express.urlencoded({ extended: true });


module.exports = { init };