#!/bin/bash

set -e

cp .env.template2-device1 .env

# stop screen sessions running local supervisors
screen -X -S supervisor kill || true
screen -X -S supervisor kill || true

if [ "$1" == "stop" ]
then
    echo "All local supervisors have been stopped."
    exit 0
fi

echo "Building local supervisors..."
current_dir=$(pwd)
cd ../wasmiot-supervisor
python3 -m pip install -r requirements.txt
cd ../supervisor-rust-port
cargo build --release
cd ${current_dir}

echo "Starting the local supervisors..."
sleep 10
screen -d -m -U -L -Logfile screen.log -S supervisor -t local-python ./start_device_supervisor.sh python
screen -S supervisor -X screen -t local-rust ./start_device_supervisor.sh rust
