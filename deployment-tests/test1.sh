#!/bin/bash

set -e

# Use the .env.template1 file as the environment variables
cp .env.template1 .env

# stop any running containers
docker compose -f docker-compose.test1.yml down

# remove Docker volumes
docker volume rm wasmiot-mongo-db-test || true
docker volume rm wasmiot-mongo-config-test || true

# stop screen sessions running local supervisors
screen -X -S supervisor kill || true
screen -X -S supervisor kill || true

if [ "$1" == "stop" ]
then
    echo "All containers and local supervisors have been stopped."
    exit 0
fi

echo "Pulling latest images..."
docker compose -f docker-compose.test1.yml pull mongo mongo-express

echo "Building images..."
docker compose -f docker-compose.test1.yml build

echo "Building local supervisors..."
current_dir=$(pwd)
cd ../wasmiot-supervisor
python3 -m pip install -r requirements.txt
cd ../supervisor-rust-port
cargo build --release
cd ${current_dir}

echo "Starting MongoDB and Mongo Express..."
docker compose -f docker-compose.test1.yml up --detach --remove-orphans mongo mongo-express

echo "Waiting for 10 seconds and starting the Docker supervisors..."
sleep 10
docker compose -f docker-compose.test1.yml up --detach supervisor-python supervisor-rust

echo "Waiting for 10 seconds and starting the orchestrator..."
sleep 10
docker compose -f docker-compose.test1.yml up --detach orchestrator

echo "Waiting for 10 seconds and starting the local supervisors..."
sleep 10
screen -d -m -U -L -Logfile screen.log -S supervisor -t local-python ./start_local_supervisor.sh python
screen -S supervisor -X screen -t local-rust ./start_local_supervisor.sh rust

echo "Waiting for 10 seconds and starting additional Docker supervisors..."
sleep 10
docker compose -f docker-compose.test1.yml up --detach supervisor-extra-python supervisor-extra-rust
