#!/usr/bin/env node
/**
 * Example 5 — Streamable HTTP transport (remote / Docker deployments).
 *
 * Starts the server with `--http --port <free port>` (what docker/Dockerfile
 * runs), connects with the SDK's StreamableHTTPClientTransport — the same
 * transport a client uses for a `"url": "http://localhost:3001/mcp"` config
 * entry or `claude mcp add --transport http research-scope http://localhost:3001/mcp` —
 * and runs tools/list + plan_research. Two separate client connections are
 * made to show the stateless server handles independent requests (the 0.1.1
 * regression fix).
 *
 * No network needed beyond loopback. Run:  node examples/05-http-transport.mjs
 */

import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ROOT, step, show } from "./_client.mjs";

async function freePort() {
  const srv = createServer().listen(0, "127.0.0.1");
  await once(srv, "listening");
  const { port } = srv.address();
  srv.close();
  return port;
}

const port = await freePort();
const dataDir = await mkdtemp(path.join(tmpdir(), "rsm-example-http-"));
const child = spawn(process.execPath, [path.join(ROOT, "dist", "index.js"), "--http", "--port", String(port)], {
  env: { ...process.env, RESEARCH_SCOPE_DATA_DIR: dataDir },
  stdio: ["ignore", "ignore", "pipe"],
});
// the server logs its listen line on stderr; wait for it
await new Promise((resolve, reject) => {
  child.stderr.on("data", (d) => {
    const line = d.toString().trim();
    if (/listening/.test(line)) {
      console.log(`$ node dist/index.js --http --port <free port>\n${line.replace(String(port), "<port>")}`);
      resolve();
    }
  });
  child.on("exit", (code) => reject(new Error(`server exited early (${code})`)));
});

const url = new URL(`http://127.0.0.1:${port}/mcp`);
try {
  step("client A: connect over Streamable HTTP + tools/list");
  const a = new Client({ name: "example-05-http-a", version: "1.0.0" });
  await a.connect(new StreamableHTTPClientTransport(url));
  console.log(`connected: ${a.getServerVersion().name} ${a.getServerVersion().version} (streamable http)`);
  const { tools } = await a.listTools();
  console.log(tools.map((t) => `- ${t.name}`).join("\n"));
  await a.close();

  step("client B: separate connection, tools/call plan_research");
  const b = new Client({ name: "example-05-http-b", version: "1.0.0" });
  await b.connect(new StreamableHTTPClientTransport(url));
  const res = await b.callTool({ name: "plan_research", arguments: { scope: "verify install over http" } });
  const plan = JSON.parse(res.content[0].text);
  show({ scope: plan.scope, killCriteria: plan.killCriteria });
  await b.close();

  step("result");
  console.log(tools.length === 4 && plan.killCriteria.length > 0 ? "OK — two independent HTTP clients served" : "UNEXPECTED — see above");
} finally {
  child.kill();
  await once(child, "exit").catch(() => {});
  await rm(dataDir, { recursive: true, force: true });
}
