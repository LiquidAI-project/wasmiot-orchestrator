# Deployment tests

Tests have been made for Ubuntu operating system have been tested with Ubuntu 24.04.

## Test 1 (one device)

- Requires Docker, Git, screen, Python, and Rust installed
    - Docker: [https://docs.docker.com/engine/install/ubuntu/](https://docs.docker.com/engine/install/ubuntu/) and [https://docs.docker.com/engine/install/linux-postinstall/](https://docs.docker.com/engine/install/linux-postinstall/)
    - Git: `sudo apt update && sudo apt install git`
    - screen: `sudo apt update && sudo apt install screen`
    - Python: `sudo apt update && sudo apt install python3 python3-dev python3-venv`
    - Create and activate Python virtual environment: [https://docs.python.org/3/library/venv.html](https://docs.python.org/3/library/venv.html)
    - Rust: [https://www.rust-lang.org/tools/install](https://www.rust-lang.org/tools/install)
- Clone the project and its submodule, for example: `git clone --recursive git@github.com:LiquidAI-project/wasmiot-orchestrator.git`
- In this folder, check the configuration variables at `.env.template1`
    - Change at least `HOST_ADDRESS` to an appropriate value
- Run `./test1.sh` to run the test
- It deploys the following:
    - MongoDB in a Docker container
    - Mongo Express in a Docker container, available at port 8081
    - Orchestrator in a Docker container, available by default at port 80
    - 6 supervisors (3 Python and 3 Rust versions). For each version:
        - the first supervisor is deployed in a Docker container and started before the orchestrator
        - the second supervisor is deployed locally in a screen session and started after the orchestrator
            - the output from the local supervisor is redirected to a file: `screen.log`
        - the third supervisor is deployed in a Docker container and started after the orchestrator
- Testing of the deployments is left to the user. There is an initialized fibo module in the orchestrator that should be deployable to the supervisors.

- Note, that the first Python supervisor in a Docker container might not be immediately discovered by the orchestrator. But it will be discovered once the registration renewal timeout is reached (set to 5 minutes in the configuration instead of the default 15 minutes).

## Test 2 (three devices)

- Assumes three devices (one running the orchestrator and compiling everything, and all running supervisors). The two devices running only the supervisors are assumed to have the same architecture.
- Requires Git, Docker, screen, Python, and Rust installed for the main device
    - Docker: [https://docs.docker.com/engine/install/ubuntu/](https://docs.docker.com/engine/install/ubuntu/) and [https://docs.docker.com/engine/install/linux-postinstall/](https://docs.docker.com/engine/install/linux-postinstall/)
    - Git: `sudo apt update && sudo apt install git`
    - screen: `sudo apt update && sudo apt install screen`
    - Python: `sudo apt update && sudo apt install python3 python3-dev python3-venv`
    - Create and activate Python virtual environment: [https://docs.python.org/3/library/venv.html](https://docs.python.org/3/library/venv.html)
    - Rust: [https://www.rust-lang.org/tools/install](https://www.rust-lang.org/tools/install)
    - For Rust cross-compilation: `cargo install cross`
- Requires Git, screen, and Python installed for the other two devices
    - Git: `sudo apt update && sudo apt install git`
    - screen: `sudo apt update && sudo apt install screen`
    - Python: `sudo apt update && sudo apt install python3 python3-dev python3-venv`
    - Create and activate Python virtual environment: [https://docs.python.org/3/library/venv.html](https://docs.python.org/3/library/venv.html)
- Clone the project and its submodule, for example: `git clone --recursive git@github.com:LiquidAI-project/wasmiot-orchestrator.git`
- In the main device, check the configuration variables at `.env.template2-main`
    - Set `MAIN_IP` to an appropriate value
    - Set also `DEVICE_ARCH` to correspond to the architecture of the other two devices. The currently supported architectures for the Rust supervisor are listed at: [https://github.com/LiquidAI-project/supervisor-rust-port/blob/main/Cross.toml](https://github.com/LiquidAI-project/supervisor-rust-port/blob/main/Cross.toml)
- In the other two devices, check the configuration variables at `.env.template2-device1` and `.env.template2-device2`
    - Set `USER_MAIN` and `IP_MAIN` to correspond to the user account and IP address of the main device.
    - Set also `DEVICE_ARCH` to the device architecture, i.e., the same values as used in the main device.
    - Modify the `PRECOMPILED_BIN_PATH` to correspond to the path where the compiled binary is stored on the main device. Can be left as is if all the devices have the same folder structure.
- Run `./test2-main.sh` in the main device to compile and start the orchestrator instance
    - The orchestrator is deployed locally in a screen session
    - MongoDB and Mongo Express are deployed in Docker containers similarly to the test 1
    - One Python and one Rust supervisor are deployed locally in a screen session
- Run `./test2-device1.sh` and `./test2-device2.sh` in the other two devices to start the supervisors in those devices
    - One Python and one Rust supervisor are deployed locally in a screen session in each device
- Testing of the deployments is left to the user.

- Note, the scripts assume similar folder the script paths in all devices. Change the configuration if that is not the case.
- Note, the orchestrator could be deployed in a Docker container as well, but 100% reliable device discovery might not be possible. The discovery requires setting properly configured Docker network and there is no easy way to configure everything automatically in varying environments.

## Stopping the deployments

- To stop the deployments of test 1, run `./test1.sh stop`
- To stop the deployments of test 2:
    - run `./test2-main.sh stop` in the main device
    - run `./test2-device1.sh stop` and `./test2-device2.sh stop` in the other two devices
