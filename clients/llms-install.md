# llms-install — research-scope-mcp

Install and configure `research-scope-mcp` for any MCP client in 4 steps.

## 1. Verify prerequisites

- Node.js ≥ 20 on PATH (check: `node --version`).
- Network access for outbound HTTP (the server fetches research URLs).

## 2. Install the package

```bash
npm install -g research-scope-mcp
```

If the package is not yet published to npm, install from this repo instead:

```bash
git clone https://github.com/AxelVerneBooks/research-scope-mcp
cd research-scope-mcp
npm ci && npm run build
```

## 3. Add to the MCP client

**stdio (recommended for Claude Code, Cursor, Cline desktop):**

```json
{
  "mcpServers": {
    "research-scope": {
      "command": "npx",
      "args": ["-y", "research-scope-mcp"]
    }
  }
}
```

**Streamable HTTP (remote / dockerized):**

```bash
docker build -t research-scope-mcp -f docker/Dockerfile .
docker run -d --name research-scope -p 3001:3001 research-scope-mcp
```

```json
{
  "mcpServers": {
    "research-scope": {
      "url": "http://localhost:3001/mcp"
    }
  }
}
```

Note: the local HTTP listener has no auth layer — keep it on loopback or behind an
auth proxy.

## 4. Verify installation

Ask the agent to call `plan_research` with scope `"verify install"`. A successful
response is a JSON object containing `primarySourceTargets`, `corroboratingTargets`,
and `killCriteria`. If the tool list is empty, check the client's MCP log for
startup errors and confirm `npx research-scope-mcp` produces no stderr output when
launched directly.
