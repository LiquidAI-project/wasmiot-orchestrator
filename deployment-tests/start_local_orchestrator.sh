#!/bin/bash

set -e

# Load environment variables from .env file
source .env

export MONGO_HOST=${MONGO_HOST}
export MONGO_PORT=${MONGO_PORT}
export MONGO_ROOT_USERNAME=${MONGO_ROOT_USERNAME}
export MONGO_ROOT_PASSWORD=${MONGO_ROOT_PASSWORD}
export PUBLIC_HOST=${ORCHESTRATOR_PUBLIC_HOST}
export PUBLIC_PORT=${ORCHESTRATOR_PUBLIC_PORT}
export WASMIOT_INIT_FOLDER=${WASMIOT_INIT_FOLDER}
export WASMIOT_CLEAR_LOGS=${WASMIOT_CLEAR_LOGS}
export WASMIOT_USE_WEB_SOCKETS=${WASMIOT_USE_WEB_SOCKETS}

cd ../fileserv
npm clean-install --omit=dev

node server.js
