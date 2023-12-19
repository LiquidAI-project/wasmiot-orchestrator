# vilin_projekti

## Description
This project (under development) is to contain package managing and
orchestrating logic for WebAssembly-based microservices.

### Features
- Package manager
- Deployment managing
- Device scanning
- RESTful API
- Web GUI

## Install Wasm-IoT orchestrator

### Prerequisites
- [Docker engine](https://docs.docker.com/engine/install/)
  - If you're on Ubuntu the version available with `apt` (at the time of writing `Docker version 24.0.5, build 24.0.5-0ubuntu1~22.04.1`)
    can be used.
- [`docker compose`](https://docs.docker.com/compose/)
  - Again the version available with `apt` (at the time of writing `docker-compose version 1.29.2`) can be used. 

### Installation
Clone the project and its submodules and use `docker compose` to build and start the server.

Using Windows 10 you could do the following:
```powershell
git clone git@github.com:LiquidAI-project/wasmiot-orchestrator.git
cd .\wasmiot-orchestrator\
<# Clone submodule separately in order to work around access issues on Windows. #>
git clone git@github.com:LiquidAI-project/wasmiot-supervisor.git
git submodule init
git submodule update
<#
  NOTE: Be sure to have your MongoDB credentials present in environment
  variables or .env before composing up! Otherwise your MongoDB database is
  created without a "superuser" and you have to re-create it to gain access.
  Here we copy defaults from .env.example.
#>
cp .env.example .env
<# Using the "main" compose file, run the orchestration system. #>
docker compose up --build
```

On Linux the process is similar, except for the explicit `clone` of `wasmiot-supervisor` submodule.

### Supervisor (git submodule)
The supervisor is a _git submodule_ so you should clone and work on it
by following the command's documentation:
https://git-scm.com/book/en/v2/Git-Tools-Submodules

As mentioned above in installation, __on Windows__ the submodule-related commands like `git submodule update` or
`git pull --recurse-submodule` might complain about unauthorized access. Some
workarounds to these issues are to:
- use `git` from WSL
- clone submodule separately (Based on a [similar situation on Stack
  Overflow](https://stackoverflow.com/questions/60850933/git-submodule-update-permission-denied))

## Usage

### Orchestrator
Orchestrator is a NodeJS server using a MongoDB database.

In order to get them running, first you need to setup a `.env` file for user
credentials. Copy the [`.env.example`](./.env.example) file into your own `.env`
file at the repository root and edit appropriate values to your liking.

__Note__ that if you intend to test the system with devices in the Docker
network, you should __unset__ the `PUBLIC_HOST` environment variable (e.g.
inside `.env` put "`PUBLIC_HOST=`") so that the hosts connecting to orchestrator
use the one automatically obtained from NodeJS.

Running the orchestrator containers can be done with the command:
```
docker compose up --build
```

The index page should then be up and accessible e.g. with a browser at `localhost:3000`

For more information on using the orchestrator, see the separate [Wasm-IoT Orchestator README](./fileserv/README.md).

### Devices
You can test how the orchestrator interacts with the
[supervisor](/wasmiot-supervisor)-controlled devices by running the
containers under profile `device` described in `docker-compose.example-devices.yml`.

All of these pretend-devices can be run at once with the command:
```
docker compose -f ./docker-compose.example-devices.yml --profile device up --build
```

#### Adding new devices to Docker compose
When adding a brand new device to your local Docker compose simulation, you have
to (in addition to entries into the compose file) add a directory for
config-files into this project's [`example`](/example). From here the
config-directories are to be mounted into the devices' containers.

---

### Devcontainer usage

As they both are set to the same Docker network, working simultaneously with
supervisor can be done by running __two__ VSCode instances: first one opened in
the orchestrator's and second one in the supervisor's devcontainer.

#### Debugging
For debugging, the devcontainer should work quite well and you can just use
VSCode like you would locally for debugging JavaScript (using the JavaScript Debug Terminal).

With both the devcontainer and database containers up, the server can be started
from "Run" > "Start Debugging" or pressing F5 on the keyboard.

### Running the orchestrator in a separate environment than the supervisor

This assumes that both the orchestrator and the supervisor are in the same local network and thus can send HTTP requests to each other.

- Create and configure environmental variable file:

    ```bash
    cp .env.example .env
    # edit appropriate values to .env
    ```

- Start the orchestrator:

    ```bash
    docker compose -f docker-compose.vm.yml up --build
    ```
  or
    ```bash
    docker compose -f docker-compose.lan.yml up --build
    ```

  If you encounter a weird issue where the container of the orchestrator does not have an open port, you can try the setup with a Nginx proxy in front of the orchestrator:

    ```bash
    docker compose -f docker-compose.nginx.yml up --build
    ```

- The discovery and deployment with a supervisor instance running in a separate device has only been tested when the supervisor has been started locally as a Python application. See the [Supervisor repository](https://github.com/LiquidAI-project/wasmiot-supervisor) for installation instructions.

## Help and known issues
- __Network `wasm-iot` missing__ :
    The docker network `wasmiot-net` should be automatically created when composing up, but can be created manually with the command:
    ```
    docker network create wasmiot-net
    ```
- __Project root under `/fileserv` in devcontainer__ :
    In the VSCode devcontainer, the __whole__ project should be visible (e.g., `.vscode` or the `.yml` compose files at the root),
    but sometimes the container opens up inside the subdirectory `/fileserv` with `*.js` etc. files at the root.

    Removing old containers and images has seemed to fix this in the past.
