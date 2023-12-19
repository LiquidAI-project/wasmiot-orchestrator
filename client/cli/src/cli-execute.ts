import { Command } from "commander";

import { getMounts, getClient } from "./utils";


const client = getClient();

const program = new Command();

program
    .argument("<deployment-id-string>", "ID of the deployment")
    .argument("[args-object]", "JSON-based args body")
    .option("-m --mount [mount-name...]", "Name of a mount as input")
    .option("-p --path [mount-path...]", "Path of a file as input")
    .action(async (deployment, json, options, _) => {
        const args = json ? JSON.parse(json) : {};
        console.log("JSON args given:", args);

        const mounts = await getMounts(options.path, options.mount);

        const result = await client.default.postExecute(
            deployment, { ...args, ...mounts }
        );

        console.log(JSON.stringify(result, null, 4));
    });

program
    .showHelpAfterError()
    .parse();
