/**
 * Inject dependencies into routes' global/module scope because Javascript
 * "classes" and the this-keyword are horrible.
 */

const device = require("./device");
const modules = require("./module");
const deployment = require("./deployment");
const execution = require("./execution");
const { init: initCoreServices } = require("./coreServices");
const supervisorLogs = require("./logs");
const moduleCards = require("./moduleCards");
const nodeCards = require("./nodeCards");
const dataSourceCards = require("./dataSourceCards");
const zoneRiskLevels = require("./zonesAndRiskLevels");
const deploymentCertificates = require("./deploymentCertificates");


/* Set common dependencies between the API routes. */
async function init(routeDependencies) {
    device.setDatabase(routeDependencies.database);
    device.setDeviceDiscovery(routeDependencies.deviceDiscovery);

    nodeCards.setDatabase(routeDependencies.database);
    dataSourceCards.setDatabase(routeDependencies.database);

    modules.setDatabase(routeDependencies.database);
    moduleCards.setDatabase(routeDependencies.database);

    zoneRiskLevels.setDatabase(routeDependencies.database);

    deployment.setDatabase(routeDependencies.database);
    deployment.setOrchestrator(routeDependencies.orchestrator);

    deploymentCertificates.setDatabase(routeDependencies.database);

    execution.setDatabase(routeDependencies.database);
    execution.setOrchestrator(routeDependencies.orchestrator);

    let coreServicesRouter = await initCoreServices(routeDependencies);
    supervisorLogs.setDatabase(routeDependencies.database);

    return {
        device: device.router,
        modules: modules.router,
        deployment: deployment.router,
        execution: execution.router,
        coreServicesRouter,
        logs: supervisorLogs.router,
        moduleCards: moduleCards.router,
        nodeCards: nodeCards.router,
        dataSourceCards: dataSourceCards.router,
        zoneRiskLevels: zoneRiskLevels.router,
        deploymentCertificates: deploymentCertificates.router
    };
}

module.exports = { init };