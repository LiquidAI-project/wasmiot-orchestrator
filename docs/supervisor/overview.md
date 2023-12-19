# Supervisor overview
The supervisor is responsible for setting up endpoints to execute deployed WebAssembly modules. Orchestrator works through the supervisor to manage applications.

## Responsibilities
The orchestrator __expects__ supervisor to:
1) Advertise itself and its capabilities (e.g. cameras, sensors, filesystem, levels of computing power)
2) Respond to health-checks (e.g. current CPU or memory usage)
3) Accept instructions for setting up endpoints to run "isolated" WebAssembly code
4) Accept calls to endpoints and respond immediately i.e. "non-blocking"

The supervisor __implements__ these responsibilities with:
1) [mDNS advertisements](https://github.com/LiquidAI-project/wasmiot-supervisor/blob/main/host_app/flask_app/app.py#L267) and [static description files](https://github.com/LiquidAI-project/wasmiot-orchestrator/blob/main/example/device1/configs/wasmiot-device-description.json)
2) A (currently hard-coded) [`/health` endpoint](https://github.com/LiquidAI-project/wasmiot-supervisor/blob/main/host_app/flask_app/app.py#L371)
3) An [endpoint parsing the instructions per deployment ID](https://github.com/LiquidAI-project/wasmiot-supervisor/blob/main/host_app/flask_app/app.py#L707) where:
    - Modules and attached data is [fetched](https://github.com/LiquidAI-project/wasmiot-supervisor/blob/main/host_app/flask_app/app.py#L779) and [runtimes instantiated __per module__](https://github.com/LiquidAI-project/wasmiot-supervisor/blob/main/host_app/flask_app/app.py#L736)
    - Each [__module__ gets its own filesystem directory](https://github.com/LiquidAI-project/wasmiot-supervisor/blob/main/host_app/wasm_utils/wasmtime.py#L38) for reading and writing
4) Queueing execution-calls (see the [execution diagram](/docs/orchestrator/deployment.md#executing) for a visual representation):
    - Responding with a link to [an endpoint, where execution result will become available](https://github.com/LiquidAI-project/wasmiot-supervisor/blob/main/host_app/flask_app/app.py#L390) 
    - [Dequeueing execution-calls](https://github.com/LiquidAI-project/wasmiot-supervisor/blob/main/host_app/flask_app/app.py#L206) in order in a separate thread
    - [Preparing arguments for the WebAssembly function](https://github.com/LiquidAI-project/wasmiot-supervisor/blob/main/host_app/utils/deployment.py#L246), running it and [interpreting the results](https://github.com/LiquidAI-project/wasmiot-supervisor/blob/main/host_app/utils/deployment.py#L316) according to module description
    - [Saving the result](https://github.com/LiquidAI-project/wasmiot-supervisor/blob/main/host_app/flask_app/app.py#L190) which is then available at the endpoint initially linked to
