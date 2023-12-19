import { readFile, writeFile } from "node:fs/promises";

import { Command } from "commander";

import { getMounts, getClient } from "./utils";


const client = getClient();

const program = new Command();

program
    .command("create")
    .description("Create a new module")
    .argument("<module-name-string>", "Name to give to module")
    .argument("<input-file>", "Path to module's .wasm file")
    .action(async (name, wasmPath) => {
        const wasm = await readFile(wasmPath);
        const wasmBlob = new Blob([wasm], { type: "application/wasm" });
        const result = await client.default.postFileModule({
            name, wasm: wasmBlob
        });
        console.log(JSON.stringify(result, null, 4));
    });

program
    .command("desc")
    .description(`Describe an existing module
A description file tells how the functions of a module can be called and what files (mounts) are expected at which stage.
If a mount is expected at _deployment stage_, a matching file should be submitted e.g. if the mount is named 'model.pb' you should pass the options like so: '-m model.pb' -p ./path/to/model.dat`)
    .argument("<module-id-string>", "ID of the module")
    .argument("<description-file>", "Path to JSON file describing functions of the module")
    .option("-m --mount [mount-name...]", "Name of a mount in functions description")
    .option("-p --path [mount-path...]", "Path of a file to send (as mount)")
    .action(async (id, descPath, options, _) => {
        const descObj = JSON.parse(
            await readFile(descPath, "utf8")
        );

        const mounts = await getMounts(options.path, options.mount);
        console.log(mounts);

        const result = await client.default.postFileModuleUpload(
            id,
            { functions: descObj, ...mounts }
        );

        console.log(JSON.stringify(result, null, 4));
    });


program
    .command("show")
    .description("Return information related to modules")
    .option("-m --module <module-id-string>", "ID of a single module")
    .action(async (options, _) => {
        const result = 
            options.module
            ? await client.default.getFileModule1(options.module)
            : await client.default.getFileModule();

        console.log(JSON.stringify(result, null, 4));
    });

program
    .command("rm")
    .description("Remove all modules")
    .action(async () => {
        const result = await client.default.deleteFileModule();

        console.log(JSON.stringify(result, null, 4));
    })

program
    .command("file")
    .description("Fetch an associated file")
    .argument("<module-id-string>", "ID of the module")
    .argument("<file-name>", "Name of an associated file")
    .argument("<output-file>", "Path where to save the fetched file")
    .action(async (id, name, outputPath) => {
        const result = await client.default.getFileModule2(id, name);
        const bytes = await result.arrayBuffer();
        const buffer = Buffer.from(bytes);
        await writeFile(outputPath, buffer);

        console.log(`Wrote ${buffer.length} bytes`);
    })

program
    .showHelpAfterError()
    .parse();