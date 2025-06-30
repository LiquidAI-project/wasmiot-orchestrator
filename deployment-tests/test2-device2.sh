#!/bin/bash

set -e

cp .env.template2-device2 .env

source .env

# stop screen sessions running local supervisors
screen -X -S supervisor kill || true
screen -X -S supervisor kill || true

if [ "$1" == "stop" ]
then
    echo "All local supervisors have been stopped."
    exit 0
fi

echo "Building dependencies for Python supervisor..."
current_dir=$(pwd)
target_arch=$(cat .env | grep ^DEVICE_ARCH | cut -d '=' -f 2)
cd ../wasmiot-supervisor
if [ "$device_arch" == "armv7-unknown-linux-gnueabihf" ]
then
    sed -i "s/# RPi.GPIO/RPi.GPIO/" requirements.txt
fi
python3 -m pip install -r requirements.txt
cd ${current_dir}

echo "Copying precompiled Supervisor binary for Rust supervisor..."
mkdir -p ../supervisor-rust-port/target/release
scp ${PRECOMPILED_BIN_PATH} ../supervisor-rust-port/target/release/supervisor

echo "Starting the local supervisors..."
sleep 10
screen -d -m -U -L -Logfile screen.log -S supervisor -t local-python ./start_device_supervisor.sh python
screen -S supervisor -X screen -t local-rust ./start_device_supervisor.sh rust
