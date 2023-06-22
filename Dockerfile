# This is the dockerfile for devcontainer. To only build orchestrator, see
# `fileserv/Dockerfile`.

FROM ghcr.io/liquidai-project/wasmiot-orchestrator AS app

LABEL org.opencontainers.image.source=https://github.com/LiquidAI-project/wasmiot-orchestrator/

FROM app AS devcontainer

WORKDIR /app

# Install docker-from-docker using devcontainer script
COPY .devcontainer/library-scripts/docker-from-docker.sh /tmp/library-scripts/
RUN bash /tmp/library-scripts/docker-from-docker.sh

# Install nodemon (https://nodemon.io/) for automatic reloads on code changes.
RUN npm install -g nodemon

# In MS provided node devcontainer, the user is `node`, not `vscode`.
USER node

COPY . .
COPY --from=app /app/fileserv/ /app/fileserv/

RUN mkdir -p /home/node/.vscode-server/extensions

CMD nodejs fileserv/server.js
