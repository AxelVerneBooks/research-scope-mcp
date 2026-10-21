/**
 * Process-level tests: spawn the built CLI (dist/index.js) and drive it over
 * stdio and Streamable HTTP with the SDK's own client transports.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { version } from "../dist/version.js";
import { startFixtureServer, articleHtml } from "./helpers/fixtures.mjs";

const ENTRY = join(process.cwd(), "dist", "index.js");
const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));

let fx;
before(async () => {
  fx = await startFixtureServer({ "/article": { body: articleHtml({ title: "Transport fixture" }) } });
});
after(() => fx.close());

describe("CLI", () => {
  test("package.json exposes the bin, and the entry has a node shebang (npx needs both)", () => {
    assert.equal(pkg.bin?.["research-scope-mcp"], "dist/index.js");
    assert.ok(pkg.files.includes("dist"));
    assert.match(readFileSync(ENTRY, "utf8"), /^#!\/usr\/bin\/env node\r?\n/);
  });

  test("version is consistent across package.json, server.json and the code", () => {
    const serverJson = JSON.parse(readFileSync(join(process.cwd(), "server.json"), "utf8"));
    assert.equal(version, pkg.version);
    assert.equal(serverJson.version, pkg.version);
  });

  test("--version and --help print and exit 0", () => {
    assert.equal(execFileSync(process.execPath, [ENTRY, "--version"], { encoding: "utf8" }).trim(), version);
    assert.match(execFileSync(process.execPath, [ENTRY, "--help"], { encoding: "utf8" }), /Usage:/);
  });

  test("bad arguments exit 2 with usage on stderr", () => {
    try {
      execFileSync(process.execPath, [ENTRY, "--http", "--port", "nope"], { encoding: "utf8", stdio: "pipe" });
      assert.fail("expected a non-zero exit");
    } catch (err) {
      assert.equal(err.status, 2);
      assert.match(err.stderr, /Invalid port: nope/);
    }
  });
});

describe("stdio transport", () => {
  let dataDir;
  let client;

  before(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "rsmcp-stdio-test-"));
    client = new Client({ name: "stdio-test", version: "0.0.0" });
    await client.connect(
      new StdioClientTransport({ command: process.execPath, args: [ENTRY], env: { ...process.env, RESEARCH_SCOPE_DATA_DIR: dataDir }, stderr: "pipe" })
    );
  });

  after(async () => {
    await client.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("initialize + tools/list", async () => {
    assert.equal(client.getServerVersion().name, "research-scope-mcp");
    const { tools } = await client.listTools();
    assert.equal(tools.length, 4);
  });

  test("full workflow over stdio writes the report into RESEARCH_SCOPE_DATA_DIR", async () => {
    const url = fx.url("/article");
    const scored = JSON.parse((await client.callTool({ name: "fetch_and_score", arguments: { source_url: url } })).content[0].text);
    assert.ok(scored.score > 0);
    const built = (await client.callTool({ name: "build_report", arguments: { topic: "stdio flow", sources: [url] } })).content[0].text;
    const [, id, path] = built.match(/Report shell (\S+) saved to (\S+\.md)/);
    assert.ok(path.startsWith(join(dataDir, "reports")));
    const check = JSON.parse((await client.callTool({ name: "check_report", arguments: { report_id: id } })).content[0].text);
    assert.equal(check.pass, false);
    assert.equal(check.claimsFound, 0);
  });
});

describe("Streamable HTTP transport", () => {
  let child;
  let dataDir;
  let base;

  before(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "rsmcp-http-test-"));
    // --port 0 lets the OS pick a free port; read it back from the startup log.
    child = spawn(process.execPath, [ENTRY, "--http", "--port", "0"], {
      env: { ...process.env, RESEARCH_SCOPE_DATA_DIR: dataDir },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let log = "";
    child.stderr.setEncoding("utf8");
    base = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`server did not start: ${log}`)), 10_000);
      child.stderr.on("data", (chunk) => {
        log += chunk;
        const m = log.match(/listening \(Streamable HTTP\) on (http:\/\/\S+)\/mcp/);
        if (m) {
          clearTimeout(timer);
          resolve(m[1]);
        }
      });
      child.once("exit", (code) => reject(new Error(`server exited with ${code}: ${log}`)));
    });
  });

  after(async () => {
    child.kill("SIGTERM");
    await once(child, "exit");
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("binds to loopback by default", () => {
    assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
  });

  test("GET /healthz reports status and version", async () => {
    const res = await fetch(`${base}/healthz`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "ok", name: "research-scope-mcp", version });
  });

  test("unknown paths are 404", async () => {
    const res = await fetch(`${base}/nope`, { method: "POST", body: "{}" });
    assert.equal(res.status, 404);
  });

  test("SDK client: initialize, list, and run the workflow across stateless requests", async () => {
    const client = new Client({ name: "http-test", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    try {
      assert.equal(client.getServerVersion().name, "research-scope-mcp");
      assert.equal((await client.listTools()).tools.length, 4);
      const url = fx.url("/article");
      await client.callTool({ name: "fetch_and_score", arguments: { source_url: url } });
      // Scores persist across per-request server instances.
      const built = await client.callTool({ name: "build_report", arguments: { topic: "http flow", sources: [url] } });
      assert.ok(!built.isError, JSON.stringify(built));
      assert.match(built.content[0].text, /Report shell \S+ saved to/);
    } finally {
      await client.close();
    }
  });

  test("raw sessionless requests after initialize do not 500 (regression: transport-per-request)", async () => {
    const post = (payload) =>
      fetch(`${base}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify(payload),
      });
    const parse = async (res) => {
      assert.equal(res.status, 200);
      const t = await res.text();
      const dataLine = t.split("\n").find((l) => l.startsWith("data:"));
      return JSON.parse(dataLine ? dataLine.slice(5).trim() : t);
    };
    const init = await parse(await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "raw", version: "0" } } }));
    assert.equal(init.result.serverInfo.name, "research-scope-mcp");
    const listed = await parse(await post({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }));
    assert.equal(listed.result.tools.length, 4);
    const called = await parse(await post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "plan_research", arguments: { scope: "http regression probe" } } }));
    assert.ok(JSON.parse(called.result.content[0].text).killCriteria.length >= 1);
  });
});
