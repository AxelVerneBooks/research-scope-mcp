/**
 * End-to-end tests — launch the built CLI (dist/index.js) as a child process
 * and drive it over stdio and Streamable HTTP, exactly as an MCP client would.
 * Run: npm test   (set RUN_NETWORK_TESTS=1 to also run the live-internet test)
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { once } from "node:events";

import { fixtureServer, tempDir, longText } from "./helpers.mjs";

const ENTRY = join(process.cwd(), "dist", "index.js");
const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));

/** Minimal MCP stdio client for the test: JSON-RPC line responses per request id. */
class StdioMcpClient {
  #child;
  #buf = "";
  #pending = new Map();
  #nextId = 1;
  constructor(child) {
    this.#child = child;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      this.#buf += chunk;
      let idx;
      while ((idx = this.#buf.indexOf("\n")) >= 0) {
        const line = this.#buf.slice(0, idx).trim();
        this.#buf = this.#buf.slice(idx + 1);
        if (!line) continue;
        const msg = JSON.parse(line); // stdout must carry nothing but protocol messages
        if (msg.id !== undefined && this.#pending.has(msg.id)) {
          this.#pending.get(msg.id)(msg);
          this.#pending.delete(msg.id);
        }
      }
    });
  }
  static spawn(dataDir) {
    const child = spawn(process.execPath, [ENTRY], {
      env: { ...process.env, RESEARCH_SCOPE_DATA_DIR: dataDir },
      stdio: ["pipe", "pipe", "inherit"],
    });
    return new this(child);
  }
  request(method, params, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const id = this.#nextId++;
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, timeoutMs);
      this.#pending.set(id, (msg) => {
        clearTimeout(timer);
        if (msg.error) reject(new Error(`${method} error: ${JSON.stringify(msg.error)}`));
        else resolve(msg.result);
      });
      this.#child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  notify(method, params) {
    this.#child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }
  async initialize() {
    const init = await this.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test-client", version: "0.0.1" } });
    this.notify("notifications/initialized", {});
    return init;
  }
  call(name, args) {
    return this.request("tools/call", { name, arguments: args });
  }
  async close() {
    this.#child.stdin.end();
    this.#child.kill();
    await once(this.#child, "exit").catch(() => {});
  }
}

const textOf = (result) => {
  assert.ok(result?.content?.[0]?.text, `no text content in ${JSON.stringify(result)}`);
  return result.content[0].text;
};

/** Start the HTTP transport on a free port and wait for its listening line. */
async function startHttp(dataDir, extraArgs = []) {
  const child = spawn(process.execPath, [ENTRY, "--http", "--port", "0", ...extraArgs], {
    env: { ...process.env, RESEARCH_SCOPE_DATA_DIR: dataDir },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  const address = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`HTTP server never started: ${stderr}`)), 10000);
    child.stderr.on("data", (d) => {
      stderr += d;
      const m = stderr.match(/on (http:\/\/\S+)\/mcp/);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
    child.on("exit", (code) => reject(new Error(`exited ${code}: ${stderr}`)));
  });
  return {
    base: address,
    stop: async () => {
      child.kill();
      await once(child, "exit").catch(() => {});
    },
  };
}

const ACCEPT = { "content-type": "application/json", accept: "application/json, text/event-stream" };
async function rpc(base, payload) {
  const res = await fetch(`${base}/mcp`, { method: "POST", headers: ACCEPT, body: JSON.stringify(payload) });
  const t = await res.text();
  const dataLine = t.split("\n").find((l) => l.startsWith("data:"));
  return { status: res.status, body: JSON.parse(dataLine ? dataLine.slice(5).trim() : t) };
}

describe("CLI", () => {
  test("--version prints the package version", () => {
    const r = spawnSync(process.execPath, [ENTRY, "--version"], { encoding: "utf8" });
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), pkg.version);
  });
  test("--help prints usage", () => {
    const r = spawnSync(process.execPath, [ENTRY, "--help"], { encoding: "utf8" });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Usage:[\s\S]*--http[\s\S]*--host/);
  });
  test("an invalid --port exits with status 2", () => {
    const r = spawnSync(process.execPath, [ENTRY, "--http", "--port", "nope"], { encoding: "utf8", timeout: 5000 });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Invalid port/);
  });
  test("the bin entry exists and has a node shebang", () => {
    assert.equal(pkg.bin["research-scope-mcp"], "dist/index.js");
    assert.match(readFileSync(ENTRY, "utf8"), /^#!\/usr\/bin\/env node\n/);
  });
});

describe("stdio transport", () => {
  let web;
  let tmp;
  before(async () => {
    tmp = tempDir();
    web = await fixtureServer({ "/page": { body: `<title>Page</title><p>${longText(3500)}</p><time datetime="${new Date().toISOString()}"></time>` } });
  });
  after(async () => {
    await web.close();
    tmp.cleanup();
  });

  test("initialize + tools/list exposes the four workflow tools", async () => {
    const client = StdioMcpClient.spawn(tmp.dir);
    try {
      const init = await client.initialize();
      assert.equal(init.serverInfo.name, "research-scope-mcp");
      assert.equal(init.serverInfo.version, pkg.version);
      const tools = await client.request("tools/list", {});
      assert.deepEqual(tools.tools.map((t) => t.name).sort(), ["build_report", "check_report", "fetch_and_score", "plan_research"]);
    } finally {
      await client.close();
    }
  });

  test("full workflow: plan → fetch_and_score → build → edit → check", async () => {
    const client = StdioMcpClient.spawn(tmp.dir);
    try {
      await client.initialize();
      const plan = JSON.parse(textOf(await client.call("plan_research", { scope: "verify example vendor claim" })));
      assert.ok(plan.killCriteria.length >= 1);

      const scored = JSON.parse(textOf(await client.call("fetch_and_score", { source_url: web.url("/page") })));
      assert.ok(scored.score > 0);

      const built = textOf(await client.call("build_report", { topic: "E2E report", sources: [web.url("/page")] }));
      const path = built.match(/saved to (\S+\.md)/)[1];
      assert.ok(path.startsWith(tmp.dir));

      const fresh = JSON.parse(textOf(await client.call("check_report", { report_path: path })));
      assert.equal(fresh.pass, false);

      writeFileSync(path, readFileSync(path, "utf8").replace("## Citation registry", "- The page under test makes the claim this report relies on [S1].\n\n## Citation registry"));
      const checked = JSON.parse(textOf(await client.call("check_report", { report_path: path })));
      assert.equal(checked.pass, true, JSON.stringify(checked));
    } finally {
      await client.close();
    }
  });
});

describe("Streamable HTTP transport", () => {
  let tmp;
  let srv;
  before(async () => {
    tmp = tempDir();
    srv = await startHttp(tmp.dir);
  });
  after(async () => {
    await srv.stop();
    tmp.cleanup();
  });

  test("binds to loopback by default", () => {
    assert.match(srv.base, /^http:\/\/127\.0\.0\.1:\d+$/);
  });

  test("stateless: requests after initialize work with no session (regression: transport-per-request)", async () => {
    const init = await rpc(srv.base, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "http-test", version: "0" } } });
    assert.equal(init.body.result?.serverInfo?.name, "research-scope-mcp");
    const listed = await rpc(srv.base, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    assert.equal(listed.status, 200);
    assert.equal(listed.body.result?.tools?.length, 4, JSON.stringify(listed.body));
    const call = await rpc(srv.base, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "plan_research", arguments: { scope: "http regression probe" } } });
    const plan = JSON.parse(call.body.result.content[0].text);
    assert.ok(plan.killCriteria.length >= 1);
  });

  test("check_report cannot read files outside the data dir over HTTP", async () => {
    const call = await rpc(srv.base, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "check_report", arguments: { report_path: "/etc/passwd" } } });
    assert.equal(call.body.result.isError, true);
    assert.match(call.body.result.content[0].text, /inside the server data directory/);
  });

  test("/healthz reports status; unknown paths 404", async () => {
    const health = await fetch(`${srv.base}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok", name: "research-scope-mcp", version: pkg.version });
    assert.equal((await fetch(`${srv.base}/nope`)).status, 404);
  });

  test("--host overrides the bind address", async () => {
    const other = await startHttp(tmp.dir, ["--host", "0.0.0.0"]);
    try {
      assert.match(other.base, /^http:\/\/0\.0\.0\.0:\d+$/);
    } finally {
      await other.stop();
    }
  });
});

test("live fetch of a real .gov page", { skip: process.env.RUN_NETWORK_TESTS !== "1" && "set RUN_NETWORK_TESTS=1 to run" }, async () => {
  const tmp = tempDir();
  const client = StdioMcpClient.spawn(tmp.dir);
  try {
    await client.initialize();
    const result = await client.call("fetch_and_score", { source_url: "https://www.nhtsa.gov/" });
    assert.notEqual(result.isError, true, textOf(result));
    const scored = JSON.parse(textOf(result));
    assert.ok(scored.score > 0, JSON.stringify(scored));
    assert.equal(scored.isPrimarySource, true);
  } finally {
    await client.close();
    tmp.cleanup();
  }
});
