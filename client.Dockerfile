# This Dockerfile is for building the Wasmiot Orchestrator CLI client tool from
# OpenAPI description and Typescript.
#
# The client can then be used by running the container passing arguments to the
# CLI client program.

FROM node:latest

WORKDIR /app
COPY package.json package.json
COPY package-lock.json package-lock.json

RUN npm install

# Add the OpenAPI docs first.
WORKDIR /app/docs
COPY docs/orchestrator/api.yml orchestrator/api.yml
COPY docs/orchestrator/schemas/ orchestrator/schemas/

WORKDIR /app/client
COPY ["client/cli/tsconfig.json", "client/cli/requestsBlobPatch.ts", "./cli/"]
COPY client/cli/src/ cli/src/

# Generate code from OpenAPI documents.
RUN npm run generate
# Compile the Typescript implementation into Javascript.
RUN npm run compile

ENTRYPOINT [ "npm", "run", "--", "client" ]
