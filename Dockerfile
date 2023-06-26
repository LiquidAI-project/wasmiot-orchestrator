# This is the dockerfile for devcontainer. To only build orchestrator, see
# `fileserv/Dockerfile`.

FROM ghcr.io/liquidai-project/wasmiot-orchestrator AS app

LABEL org.opencontainers.image.source=https://github.com/LiquidAI-project/wasmiot-orchestrator/

FROM app AS devcontainer

WORKDIR /app

# Install nodemon (https://nodemon.io/) for automatic reloads on code changes.
RUN npm install -g nodemon

# In MS provided node devcontainer, the user is `node`, not `vscode`.
USER node

COPY . .
COPY --from=app /app/fileserv/ /app/fileserv/

CMD nodejs fileserv/server.js
