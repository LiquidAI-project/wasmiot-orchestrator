#!/bin/bash

set -e

function get_env_from_file() {
    local var_name="$1"
    local value=$(cat .env | grep "${var_name}=" | cut -d '=' -f2)
    echo "$value"
}

if [ -z "$1" ]
then
    echo "Usage: $0 <python|rust>"
    exit 1
elif [ "$1" == "python" ]
then
    export INSTANCE_PATH="$(pwd)/test1/device-python-local"
    export FLASK_APP=$(get_env_from_file SUPERVISOR_PYTHON_LOCAL_NAME)
    export FLASK_PORT=$(get_env_from_file SUPERVISOR_PYTHON_LOCAL_PORT)
    export FLASK_ENV=production
    export FLASK_DEBUG=0
    # export WASMIOT_ORCHESTRATOR_URL: ${WASMIOT_ORCHESTRATOR_URL}
    # export WASMIOT_LOGGING_ENDPOINT: ${WASMIOT_LOGGING_ENDPOINT}
    export EXTERNAL_LOGGING_ENABLED=true

    cd ../wasmiot-supervisor
    python3 -m host_app

else
    export INSTANCE_PATH="$(pwd)/test1/device-rust-local/instance"
    export SUPERVISOR_NAME=$(get_env_from_file SUPERVISOR_RUST_LOCAL_NAME)
    export WASMIOT_SUPERVISOR_PORT=$(get_env_from_file SUPERVISOR_RUST_LOCAL_PORT)
    # export WASMIOT_ORCHESTRATOR_URL: ${WASMIOT_ORCHESTRATOR_URL}
    # export WASMIOT_LOGGING_ENDPOINT: ${WASMIOT_LOGGING_ENDPOINT}
    export EXTERNAL_LOGGING_ENABLED=true

    cd ../supervisor-rust-port
    ./target/release/supervisor
fi
