# Supervisor discovery

## Discovery process description

You could say that the [supervisor](https://github.com/LiquidAI-project/wasmiot-supervisor) has similar jobs to [the node components in Kubernetes](https://kubernetes.io/docs/concepts/overview/components/#node-components).
An instance of it is run on each device or "node" and is responsible for setting up an isolated environment and HTTP-endpoints for running WebAssembly functions.

In the following text, some relevant parts of code are linked into. Using the debugger is also recommended!

Upon starting, the supervisor-device has to be found by orchestrator, which it does by [advertising itself as `webthing`](https://github.com/LiquidAI-project/wasmiot-supervisor/blob/main/host_app/flask_app/app.py#L289) via mDNS during the whole of its uptime.
When the device is new and device discovery on [orchestrator server notices this](https://github.com/LiquidAI-project/wasmiot-orchestrator/blob/main/fileserv/src/deviceDiscovery.js#L118) advertisement, it [queries the device's description](https://github.com/LiquidAI-project/wasmiot-orchestrator/blob/main/fileserv/src/deviceDiscovery.js#L174) and [health](https://github.com/LiquidAI-project/wasmiot-orchestrator/blob/main/fileserv/src/deviceDiscovery.js#L225) which are by default available at supervisor paths `/.well-known/wasmiot-device-description` and `/health` respectively.
Device discovery saves all of this information (i.e., mDNS record addresses and port, capability description and health) in the database.
Now the discovery process has ended and the found devices can be queried at orchestrator [API's path `/file/device`](https://github.com/LiquidAI-project/wasmiot-orchestrator/blob/main/fileserv/routes/device.js#L46).

The following sequence diagram depicts the process (NOTE: actual activation-times might differ from what is presented):
```mermaid
sequenceDiagram
    %% Definitions:
    participant T as Timer
    participant DB as Orchestrator's database
    participant D as Device discovery
    participant M as mDNS browser
    participant SM as Supervisor's mDNS advertiser
    participant S as Supervisor

    activate S
    activate SM
    activate D
    activate T
    loop
        T->>D: Start scanning for `webthing`s
        D->>+M: Start scanning for `webthing`s
        SM->>M: Hey I'm available and here's my IP address and port
        alt The `webthing` is new for mDNS browser
            M->>D: Hey you might be interested in this
            alt Found supervisor has not already been recorded
                D-)S: Let's see your skills
                S-)D: Here you go, in JSON and format as you expect
                D-)S: How well are you currently feeling?
                S-)D: I should be healthy enough. I mean at least I'm able to hold up this conversation
                D->>+DB: Alright store this for orchestrator to use later
            end
            deactivate DB
        end
        deactivate M
    end
    deactivate D
    deactivate T
    deactivate SM
    deactivate S
```

This scanning and [discovery process]((https://github.com/LiquidAI-project/wasmiot-orchestrator/blob/main/fileserv/src/deviceDiscovery.js#L69)) is running all the time in the background.
A [device is forgotten](https://github.com/LiquidAI-project/wasmiot-orchestrator/blob/main/fileserv/src/deviceDiscovery.js#L270) and wiped from database in a couple cases:
- Device fails to properly respond to description query at discovery
- Device emits a goodbye that mDNS browser recognizes
- Device fails to respond to health queries that run every minute or so
- `DELETE` is requested on orchestrator API's path `/file/device`, which wipes __all devices__

## Discovery process update notes

- The discovery process is now running constantly (as per pull request [https://github.com/LiquidAI-project/wasmiot-orchestrator/pull/83](https://github.com/LiquidAI-project/wasmiot-orchestrator/pull/83)). The previous discovery process was running only once at the start of the application and then in 1-minute intervals.
- For cases where the supervisor is not running on the same network as the orchestrator, the supervisor can be set with `WASMIOT_ORCHESTRATOR_URL` environment variable. If it is set, the supervisor will register itself directly to the orchestrator using a `POST` request to orchestrator's API path `/discovery/register`.
- Pull requests [https://github.com/LiquidAI-project/wasmiot-orchestrator/pull/83](https://github.com/LiquidAI-project/wasmiot-orchestrator/pull/83) and [https://github.com/LiquidAI-project/supervisor-rust-port/pull/9](https://github.com/LiquidAI-project/supervisor-rust-port/pull/9) contain information on additions aimed to provide more robustness to the discovery process. The implemented process is described in diagram format: [draw.io](../supervisor/device-discovery.drawio) or [PNG](../supervisor/device-discovery.png).
