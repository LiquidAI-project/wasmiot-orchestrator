#!/bin/bash

set -e

# Load environment variables from .env file
source .env

if [ -z "$1" ]
then
    echo "Usage: $0 <python|rust>"
    exit 1
elif [ "$1" == "python" ]
then
    export INSTANCE_PATH="$(pwd)/test1/device-python-local"
    export FLASK_APP=${SUPERVISOR_PYTHON_LOCAL_NAME}
    export FLASK_PORT=${SUPERVISOR_PYTHON_LOCAL_PORT}
    export FLASK_ENV=production
    export FLASK_DEBUG=0
    # export WASMIOT_ORCHESTRATOR_URL=${WASMIOT_ORCHESTRATOR_URL}
    export WASMIOT_LOGGING_ENDPOINT=${WASMIOT_LOGGING_ENDPOINT}
    export EXTERNAL_LOGGING_ENABLED=true

    cd ../wasmiot-supervisor
    python3 -m host_app

else
    export INSTANCE_PATH="$(pwd)/test1/device-rust-local/instance"
    export SUPERVISOR_NAME=${SUPERVISOR_RUST_LOCAL_NAME}
    export WASMIOT_SUPERVISOR_PORT=${SUPERVISOR_RUST_LOCAL_PORT}
    # export WASMIOT_ORCHESTRATOR_URL=${WASMIOT_ORCHESTRATOR_URL}
    export WASMIOT_LOGGING_ENDPOINT=${WASMIOT_LOGGING_ENDPOINT}
    export EXTERNAL_LOGGING_ENABLED=true

    cd ../supervisor-rust-port
    ./target/release/supervisor
fi
