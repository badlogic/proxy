# HTTP Proxy Server

A high-performance HTTP proxy server that can efficiently forward ANY HTTP request to remote servers. Built with Node.js, Express, and TypeScript.

## Proxy API Usage

The proxy server provides two endpoints for forwarding HTTP requests, with full support for streaming media, file uploads, and partial content delivery:

### 1. Path-based Proxy
```
/proxy/<target-url>
```

**Examples:**
```bash
# GET request
curl http://localhost:3000/proxy/https://api.github.com/users/torvalds

# POST request with JSON body
curl -X POST http://localhost:3000/proxy/https://httpbin.org/post \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}'

# For complex URLs with query parameters, use base64 encoding
URL="https://api.example.com/search?q=test&limit=10"
ENCODED=$(echo -n "$URL" | base64)
curl "http://localhost:3000/proxy/$ENCODED?encoded=true"

# Video streaming with range request (seeking)
curl -H "Range: bytes=1048576-2097151" http://localhost:3000/proxy/https://example.com/video.mp4

# File upload with multipart/form-data
curl -X POST http://localhost:3000/proxy/https://api.example.com/upload \
  -F "file=@/path/to/file.pdf" \
  -F "description=Important document"
```

### 2. Query Parameter Proxy
```
/api/proxy?target=<url>
```

**Examples:**
```bash
# GET request
curl "http://localhost:3000/api/proxy?target=https://api.github.com/repos/microsoft/vscode"

# POST request
curl -X POST "http://localhost:3000/api/proxy?target=https://httpbin.org/post" \
  -H "Content-Type: application/json" \
  -d '{"key": "value"}'

# PUT request
curl -X PUT "http://localhost:3000/api/proxy?target=https://httpbin.org/put" \
  -H "Content-Type: application/json" \
  -d '{"updated": true}'
```

### JavaScript/TypeScript Client Usage

```javascript
// Using fetch API
async function proxyRequest(targetUrl, options = {}) {
  const proxyUrl = `/api/proxy?target=${encodeURIComponent(targetUrl)}`;

  const response = await fetch(proxyUrl, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  });

  return response.json();
}

// Example: GET request
const data = await proxyRequest('https://api.github.com/users/github');

// Example: POST request
const result = await proxyRequest('https://httpbin.org/post', {
  method: 'POST',
  body: JSON.stringify({ test: 'data' })
});
```

### Features

- **All HTTP Methods**: GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS
- **Request Body Support**: JSON, form data, or raw body
- **Multipart/Form-Data**: Full support for file uploads (single & multiple)
- **Range Requests (HTTP 206)**: Video seeking, audio streaming, download resume
- **Server-Sent Events (SSE)**: Real-time streaming support
- **Header Preservation**: Original headers are forwarded
- **HTTPS Support**: Can proxy to HTTPS endpoints
- **WebSocket Support**: Can proxy WebSocket connections
- **CORS Handling**: Automatically adds CORS headers
- **Error Handling**: Returns appropriate HTTP status codes
- **Streaming**: Efficient memory usage for large payloads
- **Timeout**: 30-second timeout for requests

### Response Headers

The proxy adds these headers to responses:
- `x-proxy-target`: The target URL that was proxied
- `x-proxy-status`: The HTTP status code from the target
- `access-control-allow-origin`: CORS header (if not present)

### Error Responses

Failed proxy requests return JSON error responses:
```json
{
  "error": "Proxy error",
  "message": "Error details",
  "target": "https://target-url.com"
}
```

### Proxy Statistics

Get proxy server information:
```bash
curl http://localhost:3000/api/proxy-stats
```

Returns:
```json
{
  "status": "active",
  "timeout": 30000,
  "endpoints": [
    "/proxy/* - Direct proxy with URL in path",
    "/api/proxy?target=URL - Proxy with URL in query parameter"
  ]
}
```

## Development Workflow

### 1. Development

```bash
# Start dev environment (Docker + live reload)
./run.sh dev

# Your app is now running at http://localhost:8080
# Edit files in src/ and see changes instantly

# Run on a different port
PORT=8081 ./run.sh dev

# For parallel development, use git worktrees
git worktree add ../proxy-feature feature-branch
cd ../proxy-feature
PORT=8081 ./run.sh dev  # Runs independently with its own dist/
```

### 2. Production Deployment

```bash
# Deploy to your server (builds automatically)
./run.sh deploy
```

The deploy command:
1. Builds TypeScript and CSS locally
2. Syncs files to your server via rsync
3. Restarts services with Docker Compose
4. Caddy automatically handles SSL and routing

## Project Structure

```
proxy/
├── src/             # Source files
│   ├── index.html   # Main HTML
│   ├── index.ts     # TypeScript (includes live reload)
│   └── styles.css   # Tailwind CSS
├── dist/            # Build output (git ignored)
├── infra/           # Infrastructure
│   ├── build.js     # Build script
│   ├── Caddyfile    # Caddy web server configuration
│   ├── docker-compose.yml      # Base configuration
│   ├── docker-compose.dev.yml  # Development overrides
│   └── docker-compose.prod.yml # Production overrides
├── run.sh           # All-in-one CLI
└── package.json     # Dependencies
```

## Commands

```bash
./run.sh dev              # Start dev server at localhost:8080
PORT=8081 ./run.sh dev    # Start on custom port
./run.sh prod             # Run production locally
./run.sh deploy           # Deploy to proxy.mariozechner.at
./run.sh sync             # Sync files (dist/, infra/) to proxy.mariozechner.at
./run.sh stop             # Stop containers locally
./run.sh logs             # View container logs locally
```

Deploys to `/home/badlogic/proxy.mariozechner.at/` on `slayer.marioslab.io`. Caddy automatically routes `proxy.mariozechner.at` traffic to this container with SSL.

## Tech Stack

- **Node.js & Express** - Server framework
- **TypeScript** - Type-safe development
- **http-proxy-middleware** - Production-ready proxy handling
- **CORS** - Cross-origin resource sharing support
- **Docker** - Containerized deployment
- **Caddy** - Reverse proxy with automatic SSL

## Quick Start

```bash
# Install dependencies
npm install

# Start the proxy server
npm run dev

# Or run directly
npx tsx src/backend/server.ts

# Run tests
npm test
```

The server will start on port 3000 (or PORT environment variable).

## Architecture Notes

- **Streaming architecture** - Doesn't buffer entire payloads in memory
- **Non-blocking I/O** - Handles multiple concurrent requests efficiently
- **Error isolation** - Failed proxy requests don't affect the server
- **Automatic retries** - Follows redirects automatically
- **WebSocket support** - Can proxy WebSocket upgrade requests
- **CORS handling** - Automatically adds necessary headers for browser compatibility