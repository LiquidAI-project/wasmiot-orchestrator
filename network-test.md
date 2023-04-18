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

## Successful test with Raspberry Pi

Setup:

- Orchestrator running in a Docker container inside a virtual machine (Ubuntu 22.04 Server) created with VirtualBox under Windows.
- Supervisor running locally in a Raspberry Pi
- Both the virtual machine and Raspberry Pi setup to have access to the same network provided by a mobile phone.

Steps:

- Create the virtual machine and setup the network connections. TODO: add some details here
- Create an external Docker network that connects to the mobile network:

    ```bash
    docker network create \
        --driver macvlan \
        --subnet 192.168.43.0/24 \
        --gateway 192.168.43.1 \
        --opt parent=enp0s9 \
        mobile
    ```

    Here `192.168.43.0/24` is the ip address range for the mobile network, `192.168.43.1` is the router address, `enp0s9` is the network interface that connects the virtual machine to the mobile network, and `mobile` is the Docker network name.

- Add a mDNS reflector container that is in both orchestrator+Mongo network and mobile network (already done in the file `docker-compose.test1.yml`), and start the system (orchestrator+Mongo+reflector):

    ```bash
    docker compose -f docker-compose.test1.yml up --build
    ```

- To allow the deployment to work, apply a hack modification to the supervisor code that is going to be run on the Raspberry Pi:
    - Add the following to the file `host_app/flask_app/app.py` in the `get_deployment` function just before the line `fetch_modules(modules)`:

    ```python
    modules = [
        {
            **module,
            **{"url": (
                module["url"].split(":")[0] +
                f"://{request.environ['REMOTE_ADDR']}:" +
                ":".join(module["url"].split(":")[2:])
            )}
        }
        for module in modules
    ]
    ```

- Start the supervisor application on the raspberry Pi.
- The device should be discovered and the deployment should work.
