# Deployement tests

## Test 1 (one device)

- Check the configuration variables at `.env.template1`
- Requires Docker, screen, Python, and Rust installed
- Run `./test1.sh` to run the test
- It deployes the following:
    - MongoDB in a Docker container
    - Mongo Express in a Docker container, available at port 8081
    - Orchestrator in a Docker container, available by default at port 80
    - 6 supervisors (3 Python and 3 Rust versions). For each version:
        - the first supervisor is deployed in a Docker container and started before the orchestrator
        - the second supervisor is deployed locally in a screen session and started after the orchestrator
        - the third supervisor is deployed in a Docker container and started after the orchestrator
- Testing of the deployments is left to the user. There is an initialized fibo module in the orchestrator that should be deployable to the supervisors.

- Note, that the First Python supervisor in a Docker container might not be immeadiately discovered by the orchestrator. But it will be discovered once the registration renewal timeout is reached (set to 5 minutes in the configuration).

## Test 2 (three devices)

- Assumes three devices (one running the orchestrator and compiling everything, and all running supervisors)
- Requires Docker, screen, Python, and Rust installed for the main device
- Requires screen and Python installed for the other two devices
- In the main device, check the configuration variables at `.env.template2-main`
- In the other two devices, check the configuration variables at `.env.template2-device1` and `.env.template2-device2`
- Run `./test2-main.sh` in the main device to compile and start the orchestrator
    - The orchestrator is deployed locally in a screen session
    - MongoDB and Mongo Express are deployed in Docker containers similarly to the test 1
    - One Python and one Rust supervisor are deployed locally in a screen session
- Run `./test2-device1.sh` and `./test2-device2.sh` in the other two devices to start the supervisors
    - One Python and one Rust supervisor are deployed locally in a screen session
- Testing of the deployments is left to the user.

- Note, the scripts assume similar folder the script paths in all devices. Change the configuration if that is not the case.
- Note, the orchestrator could be deployed in a Docker container as well, but 100% reliable device discovery might not be possible. The discovery requires setting properly configured Docker network and there is no easy way to configure everything automatically in varieng environments.
