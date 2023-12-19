import { Command } from "commander";

import { getClient } from "./utils";

const client = getClient();

const program = new Command();

program
    .command("show")
    .description("Return information related to devices")
    .action(async () => {
        const result = await client.default.getFileDevice();
        console.log(JSON.stringify(result, null, 4));
    });

program
    .command("scan")
    .description("Scan for device advertisements")
    .action(async () => {
        await client.default.postFileDeviceDiscoveryReset();
        console.log("Rescan started");
    });

program
    .command("rm")
    .description("Delete all devices")
    .action(async () => {
        const result = await client.default.deleteFileDevice();
        console.log(JSON.stringify(result, null, 4));
    });

program
    .showHelpAfterError()
    .parse();