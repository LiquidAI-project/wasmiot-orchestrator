# Orchestrator command line interface - Orcli

Instead of the web-GUI, operate on orchestrator and resources on the command line.

## How to
The client could be run in local environment with a sufficient Node.js
installation (e.g. `node:fs/promises` is required), but as the orchestrator is
inside a Docker-network already, running the CLI in Docker might prove most
suitable.

Build the client (NOTE: at __orchestrator root__) with:
```bash
# Change to the orchestrator root if not already.
cd wasmiot-orchestrator
# Build the client image.
docker build -t wasmiot-orcli -f client.Dockerfile .
```

Now you can run commands, pass in files and environment variables with `docker run`.

For example you can list current modules with:
```bash
docker run -e ORCHESTRATOR_ADDRESS=http://wasmiot-orchestrator:3000 --network=wasmiot-net wasmiot-orcli module show
```

---

For brevity, you might want to make yourself an `alias` off of this long line e.g.
```bash
alias dorcli="docker run -e ORCHESTRATOR_ADDRESS=http://wasmiot-orchestrator:3000 --network=wasmiot-net wasmiot-orcli"
```

Then using the command becomes a bit more ergonomic:
```bash
# Show modules.
dorcli module show
# Refresh a device scan.
dorcli device scan
# Create a deployment for storing stuff.
dorcli deployment create StoreStuff -d -m core:Datalist -f push
```

---

NOTE: Too bad that passing files requires access to host filesystem which makes
the `alias` above less flexible:
```bash
# Define a variable with your wasmiot-modules/modules path.
my_local_wasmiot_modules_path=</absolute/path/to/modules>

alias dorcli="docker run \
    --env ORCHESTRATOR_ADDRESS=http://wasmiot-orchestrator:3000 \
    --network=wasmiot-net \
    --volume=$my_local_wasmiot_modules_path:/app/modules \
    wasmiot-orcli"
```

Then for example creating a new module resource would happen like so:
```bash
# Define a variable for the mobilenet model needed as data file.
my_path_to_mobilenet_model_file=<relative/to/wasmiot-modules/modules/model>

dorcli module create mobilenet /app/modules/wasm-binaries/wasm32-wasi/wasi_mobilenet_inference_onnx.wasm
dorcli module desc \
    mobilenet \
    /app/modules/wasi_mobilenet_inference_onnx/description.json \
    -m model -p /app/modules/$my_path_to_mobilenet_model_file
```

See the provided [`/example/icwe23-demo.sh`](/example/icwe23-demo.sh) for a whole example of a workflow.

