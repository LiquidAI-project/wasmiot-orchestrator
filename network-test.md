# Testing orchestrator and supervisor in separate networks

This is for local testing using a single device running both the orchestrator and the supervisor. But it should be possible to extend this to separate devices. The used Docker hub page for [flungo/avahi](https://hub.docker.com/r/flungo/avahi) image could give a starting point for that.

- Create external Docker networks:

    ```bash
    docker network create wasmiot-net1
    docker network create wasmiot-net2
    ```

- Start the orchestrator and MongoDB in network wasmiot-net1 with mdns-reflector that is connected to both networks:

    ```bash
    docker compose -f docker-compose.test1.yml up --build
    ```

- Start one supervisor in network wasmiot-net2:

    ```bash
    docker compose -f docker-compose.test2.yml up --build
    ```

The mDNS discovery in the orchestrator is working due to the added mdns-reflector container.
However, deployment does not work yet since the orchestrator tries to use IP address from the wasmiot-net2 network which is not accessible from the network orchestrator is deployed.
