#!/bin/bash

set -e

cp .env.template2-main .env

# stop any running containers
docker compose -f docker-compose.test2.yml down

# remove Docker volumes
docker volume rm wasmiot-mongo-db-test || true
docker volume rm wasmiot-mongo-config-test || true

# stop screen sessions running local supervisors and the orchestrator
screen -X -S supervisor kill || true
screen -X -S supervisor kill || true
screen -X -S orchestrator kill || true

if [ "$1" == "stop" ]
then
    echo "All containers and local supervisors have been stopped."
    exit 0
fi

echo "Pulling latest images..."
docker compose -f docker-compose.test2.yml pull mongo mongo-express

echo "Building images..."
docker compose -f docker-compose.test2.yml build

echo "Building local supervisors..."
current_dir=$(pwd)
target_arch=$(cat .env | grep ^DEVICE_ARCH | cut -d '=' -f 2)
cd ../wasmiot-supervisor
python3 -m pip install -r requirements.txt
cd ../supervisor-rust-port
cargo build --release
echo "Cross compiling the Rust supervisor..."
cross build --target=${target_arch} --release
cp target/${target_arch}/release/supervisor ${current_dir}/bin/${target_arch}-supervisor
cd ${current_dir}

echo "Starting MongoDB and Mongo Express..."
docker compose -f docker-compose.test2.yml up --detach --remove-orphans mongo mongo-express

echo "Waiting for 10 seconds and starting the orchestrator..."
sleep 10
screen -d -m -U -L -Logfile screen-orchestrator.log -S orchestrator -t orchestrator ./start_local_orchestrator.sh

echo "Waiting for 10 seconds and starting the supervisors..."
sleep 10
screen -d -m -U -L -Logfile screen-supervisor.log -S supervisor -t local-python ./start_device_supervisor.sh python
screen -S supervisor -X screen -t local-rust ./start_device_supervisor.sh rust
