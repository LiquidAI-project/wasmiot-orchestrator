#!/bin/bash

set -e

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

# pull the latest images
docker compose -f docker-compose.test1.yml pull mongo mongo-express nginx-proxy

# build all images
docker compose -f docker-compose.test1.yml build


# compile local supervisors
current_dir=$(pwd)
cd ../wasmiot-supervisor
python3 -m pip install -r requirements.txt
cd ../supervisor-rust-port
cargo build --release
cd ${current_dir}

# start MongoDB, Mongo Express, and mDNS reflector
docker compose -f docker-compose.test1.yml up --detach --remove-orphans mongo mongo-express mdns-reflector

# wait for 10 seconds to ensure MongoDB is up
echo "Waiting for 10 seconds to ensure the MongoDB is up..."
sleep 10

# start the orchestrator and the Nginx proxy
docker compose -f docker-compose.test1.yml up --detach orchestrator nginx-proxy

# wait for 10 seconds to ensure the orchestrator is up
echo "Waiting for 10 seconds to ensure the orchestrator is up..."
sleep 10

# start the local supervisors
screen -d -m -U -L -Logfile screen.log -S supervisor -t local-python ./start_local_supervisor.sh python
screen -S supervisor -X screen -t local-rust ./start_local_supervisor.sh rust

# start the Docker supervisors
echo "Waiting for 10 seconds to ensure the local supervisors are up..."
sleep 10
docker compose -f docker-compose.test1.yml up --detach supervisor-python supervisor-rust

# start the extra Docker supervisors in a separate Docker network
echo "Waiting for 10 seconds to ensure the Docker supervisors are up..."
sleep 10
docker compose -f docker-compose.test1.yml up --detach supervisor-extra-python supervisor-extra-rust
