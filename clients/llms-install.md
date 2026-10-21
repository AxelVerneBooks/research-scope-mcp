# llms-install — research-scope-mcp

Install and configure `research-scope-mcp` for any MCP client in 4 steps.

## 1. Verify prerequisites

- Node.js ≥ 20 on PATH (check: `node --version`).
- Network access for outbound HTTP (the server fetches research URLs).

## 2. Install the package

```bash
npm install -g research-scope-mcp
```

Or skip the global install: the `npx -y research-scope-mcp` config below fetches it
on demand. To build from source instead:

```bash
git clone https://github.com/AxelVerneBooks/research-scope-mcp
cd research-scope-mcp
npm ci && npm run build
```

## 3. Add to the MCP client

**stdio (recommended for Claude Desktop, Claude Code, Cursor, Cline):**

```json
{
  "mcpServers": {
    "research-scope": {
      "command": "npx",
      "args": ["-y", "research-scope-mcp"],
      "env": { "RESEARCH_SCOPE_DATA_DIR": "/absolute/path/for/reports" }
    }
  }
}
```

`RESEARCH_SCOPE_DATA_DIR` is optional; without it, report shells are written to
`./data` relative to the directory the client launches the server from.

**Streamable HTTP (remote / dockerized):**

```bash
docker build -t research-scope-mcp -f docker/Dockerfile .
docker run -d --name research-scope -p 3001:3001 research-scope-mcp
```

```json
{
  "mcpServers": {
    "research-scope": {
      "url": "http://127.0.0.1:3001/mcp"
    }
  }
}
```

Without Docker: `npx -y research-scope-mcp --http --port 3001` (binds to
127.0.0.1; `GET /healthz` returns `{"status":"ok"}`).

Note: the HTTP listener has no auth layer. Keep it on loopback or behind an
auth proxy.

## 4. Verify installation

Ask the agent to call `plan_research` with scope `"verify install"`. A successful
response is a JSON object containing `primarySourceTargets`, `corroboratingTargets`,
and `killCriteria`. If the tool list is empty, check the client's MCP log for
startup errors and confirm `npx -y research-scope-mcp --version` prints a version
number.
