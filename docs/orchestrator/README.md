# Orchestrator Documentation

This directory contains documentation for the Wasm-IoT Orchestrator API and system.

## API Documentation

The orchestrator API is documented using the OpenAPI 3.0.3 specification format. The main API specification file is located at [`api.yml`](./api.yml).

### Viewing the API Documentation

The API documentation is served directly by the orchestrator at the `/docs` endpoint when the server is running.

**To view the documentation:**
1. Start the orchestrator server
2. Navigate to `http://localhost:3000/docs` (or your configured port)

### Generating the Documentation HTML

Before the documentation can be served, you need to generate the HTML file from the OpenAPI specification.

**From the `fileserv` directory:**
```bash
npm run docs:generate
```

**Or manually:**
```bash
cd fileserv
npx redoc-cli bundle ../docs/orchestrator/api.yml -o ../docs/orchestrator/api-docs.html
```

This will create `api-docs.html` in the `docs/orchestrator/` directory, which is then served by the orchestrator at `/docs`.

**Note:** You should regenerate the HTML file whenever you update `api.yml` or any schema files.

### Updating the API Documentation

When adding new API endpoints or modifying existing ones, update the `api.yml` file accordingly:

1. **Adding a New Endpoint:**
   - Add the endpoint path under the `paths:` section
   - Define the HTTP method (get, post, put, delete, etc.)
   - Include:
     - `description`: What the endpoint does
     - `parameters`: Path, query, or header parameters
     - `requestBody`: Request body schema (if applicable)
     - `responses`: All possible response codes and their schemas
   - Add appropriate tags for grouping

2. **Updating Schemas:**
   - Schema definitions are in the `components/schemas:` section
   - Complex schemas are referenced from `schemas/` directory
   - Update or add schema files in `schemas/` as needed

3. **After Making Changes:**
   - Regenerate the HTML file: `npm run docs:generate` (from `fileserv` directory)
   - Restart the orchestrator server to see the changes

### API Endpoints Overview

The orchestrator provides the following main endpoint groups:

- **Devices** (`/file/device`): Device discovery, management, and blacklisting
- **Modules** (`/file/module`): WebAssembly module management
- **Deployments** (`/file/manifest`): Deployment creation, management, and execution
- **Execution** (`/execute`): Execute deployed workloads

### Schema Files

Schema definitions are stored in the [`schemas/`](./schemas/) directory:
- `Device.yml` - Device information structure
- `Module.yml` - Module information structure
- `Deployment.yml` - Deployment information structure
- `Manifest.yml` - Deployment manifest structure
- And more...

These schemas are referenced in the main `api.yml` file using `$ref` directives. See the [API Documentation Guide](./API_DOCUMENTATION_GUIDE.md) for more details on how schemas work.

### Related Documentation

- [Overview](./overview.md) - High-level system overview
- [Installation](./installation.md) - Installation instructions
- [Deployment](./deployment.md) - Deployment concepts and usage
- [Discovery](./discovery.md) - Device discovery mechanisms

