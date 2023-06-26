FROM "mcr.microsoft.com/devcontainers/javascript-node:0-18" AS app

LABEL org.opencontainers.image.source="https://github.com/LiquidAI-project/wasmiot-orchestrator" 

WORKDIR /app/fileserv

# Install dependencies first in order to not rebuild every time code changes.
COPY package*.json .
# RUN npm install
RUN npm ci

COPY . .

CMD nodejs ./server.js
