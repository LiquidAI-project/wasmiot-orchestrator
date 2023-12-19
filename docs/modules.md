# Modules

WebAssembly binaries or "modules" are submitted through the orchestrator API
in order for the orchestrator to generate descriptions off of them that can be
used in deployment actions.

The submission process currently has two parts but this could very well be changed into
just a single `POST` request. The two parts are 1. creating the module resource
and 2. describing how to interact with exports of the module.

## Creating a module
When creating a module, you submit its name for yourself to identify later and
along it a `.wasm` file. The `.wasm` file is parsed at the server and its
imports and exports are extracted, __dealing only__ with the simple WebAssembly
primitives.

Related implementation is in the [`createModule`](/fileserv/routes/module.js#L139)
handler function.

## Describing a module
The request format that the API expects in describing a module is of the
`multipart/form-data` media-type in order to upload multiple data-files along
with key-value type descriptions. Data-files are turned into "mounts", by
using their names as "paths", that are eventually used when supervisor sets up
the filesystem environment for deployment. Mounts have "stages" (deployment,
execution and output), for when they are expected to be available at the module
i.e., if you deploy without sending along a "deployment" data-file, the
deployment should fail then and there.

Related implementation is in the  [`describeModule`](/fileserv/routes/module.js#L444)
handler function.

## Module metadata
There are quite a bit of fields that the orchestrator needs for modules, as
they are at the center of the system. The specific schemas can be found TODO
[associated with the orchestrator's OpenAPI document](/docs/orchestrator/api/module.yml).

### Imports
A module's imports are things that (in the current setup) the supervisor
provides (e.g. see how [supervisor links to `wasmtime` in `link_remote_functions`](/wasmiot-supervisor/host_app/wasm_utils/wasmtime.py#L149))
to the module when it is needed to run. Names of these imports (which are
effectively just functions) match what supervisors advertise as their "skills"
(e.g. see example [`supervisorInterfaces` in `wasmiot-device-description.json`](/example/device1/configs/wasmiot-device-description.json))
during their [discovery](/docs/discovery.md). NOTE that currently nothing else
but the names are known or checked about the imports and orchestrator relies on
them working "as intended".

The imports is the API that a developer can use when creating their
microservices in the form of WebAssembly modules.

### Exports
Exports are again, functions, that the module exposes for the supervisor and
WebAssembly runtime to execute (e.g. see how [supervisor runs a requested function (in `wasmtime`)](/wasmiot-supervisor/host_app/wasm_utils/wasmtime.py#L241)).
These functions are mapped into HTTP-endpoints (NOTE the standard URL-path format
`/<deployment_id>/modules/<module_name>/<function_name>` that [is defined on supervisor `run_module_function`](/wasmiot-supervisor/host_app/flask_app/app.py#L403))
based on function names and some basic information. The latter "basic
information" are things like parameter and output types and which files or
"mounts" with what names the function expects when it runs. The orchestrator
server generates (see function [`moduleEndpointDescriptions`](/fileserv/routes/module.js#L303))
a "standard format" description, more precisely an OpenAPI v3.0 document about
the endpoints so that compatible tooling (e.g. client/server-generation,
documentation, tests?) could potentially be utilized when interacting with
and/or making sense of the system. You'll see the concept of "endpoint" being
thrown around the module-related implementation (e.g. [deployment solving in `createSolution`](/fileserv/src/orchestrator.js#L272)
or [class `Endpoint` at supervisor](/wasmiot-supervisor/host_app/utils/endpoint.py#L64)),
so remember that it basically just represents the way communication between
WebAssembly functions is translated over HTTP.


