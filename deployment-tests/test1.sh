#!/bin/bash

set -e

# stop any running containers
docker compose -f docker-compose.test1.yml down

# remove Docker volumes
docker volume rm wasmiot-mongo-db-test || true
docker volume rm wasmiot-mongo-config-test || true

# stop screen sessions running local supervisors
# TODO: this might leave some processes running, needs to be handled better
screen -X -S supervisor kill || true
screen -X -S supervisor kill || true
screen -X -S supervisor kill || true

if [ "$1" == "stop" ]
then
    echo "All containers and local supervisors have been stopped."
    exit 0
fi

# pull the latest images
docker compose -f docker-compose.test1.yml pull mongo mongo-express mdns-reflector nginx-proxy

# build all images
docker compose -f docker-compose.test1.yml build

# compile local mdns server
current_dir=$(pwd)
cd mdns-server
cargo build --release
cd ${current_dir}

# compile local supervisors
cd ../wasmiot-supervisor
python3 -m pip install -r requirements.txt
cd ../supervisor-rust-port
cargo build --release
cd ${current_dir}

# start MongoDB and Mongo Express
docker compose -f docker-compose.test1.yml up --detach mongo mongo-express

# wait for 10 seconds to ensure MongoDB is up
sleep 10

# start the mDNS server with Docker
docker compose -f docker-compose.test1.yml up --detach mdns-server

# start the orchestrator and the Nginx proxy
docker compose -f docker-compose.test1.yml up --detach mdns-reflector orchestrator nginx-proxy

# wait for 10 seconds to ensure the orchestrator is up
sleep 10

# start the local mDNS server
screen -d -m -U -L -Logfile screen.log -S supervisor -t local-mdns ./start_local_mdns-server.sh

# start the local supervisors
screen -S supervisor -X screen -t local-python ./start_local_supervisor.sh python
screen -S supervisor -X screen -t local-rust ./start_local_supervisor.sh rust

# start the Docker Supervisors
docker compose -f docker-compose.test1.yml up --detach supervisor-python supervisor-rust
