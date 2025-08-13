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
    export INSTANCE_PATH=${INSTANCE_PATH_PYTHON}
    export WASMIOT_SUPERVISOR_NAME=${SUPERVISOR_PYTHON_LOCAL_NAME}
    export WASMIOT_SUPERVISOR_PORT=${SUPERVISOR_PYTHON_LOCAL_PORT}
    export EXTERNAL_LOGGING_ENABLED=true

    cd ../wasmiot-supervisor
    python3 -m host_app

else
    export INSTANCE_PATH=${INSTANCE_PATH_RUST}
    export WASMIOT_SUPERVISOR_NAME=${SUPERVISOR_RUST_LOCAL_NAME}
    export WASMIOT_SUPERVISOR_PORT=${SUPERVISOR_RUST_LOCAL_PORT}
    export EXTERNAL_LOGGING_ENABLED=true

    cd ../supervisor-rust-port
    ./target/release/supervisor
fi
