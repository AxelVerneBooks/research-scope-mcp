/**
 * Integration test — launches the built stdio server and drives the full workflow:
 * plan_research → fetch_and_score (real network fetch) → build_report → check_report.
 * Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";

const DATA_DIR = mkdtempSync(join(tmpdir(), "rsmcp-test-"));

/** Minimal MCP stdio client for the test: JSON-RPC line responses per request id. */
class StdioMcpClient {
  #child;
  #buf = "";
  #pending = new Map();
  /** Every stderr line the server wrote (structured JSON logs). */
  stderrLines = [];
  constructor(child) {
    this.#child = child;
    let errBuf = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      errBuf += chunk;
      const parts = errBuf.split("\n");
      errBuf = parts.pop();
      this.stderrLines.push(...parts.filter(Boolean));
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      this.#buf += chunk;
      let idx;
      while ((idx = this.#buf.indexOf("\n")) >= 0) {
        const line = this.#buf.slice(0, idx).trim();
        this.#buf = this.#buf.slice(idx + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue; // tolerate interleaved non-JSON lines (banner noise)
        }
        if (msg.id !== undefined && this.#pending.has(msg.id)) {
          this.#pending.get(msg.id)(msg);
          this.#pending.delete(msg.id);
        }
      }
    });
  }
  static spawn(env = {}) {
    const child = spawn(process.execPath, [join(process.cwd(), "dist", "index.js")], {
      cwd: process.cwd(),
      env: { ...process.env, RESEARCH_SCOPE_DATA_DIR: DATA_DIR, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    return new this(child);
  }
  request(method, params, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const id = Math.floor(Math.random() * 1e9);
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
  async close() {
    this.#child.stdin.end();
    this.#child.kill();
    await once(this.#child, "exit").catch(() => {});
  }
}

/** Pull the first JSON text payload out of an MCP tool result. */
function textPayload(result) {
  assert.ok(result?.content?.[0]?.text, `no text content in ${JSON.stringify(result)}`);
  return result.content[0].text;
}

test("initialize + tools/list exposes the four workflow tools", async () => {
  const client = StdioMcpClient.spawn();
  try {
    const init = await client.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test-client", version: "0.0.1" },
    });
    assert.equal(init.serverInfo.name, "research-scope-mcp");
    client.notify("notifications/initialized", {});
    const tools = await client.request("tools/list", {});
    const names = tools.tools.map((t) => t.name).sort();
    assert.deepEqual(names, ["build_report", "check_report", "fetch_and_score", "plan_research"]);
  } finally {
    await client.close();
  }
});

test("stateless HTTP transport: second request works with no session (regression: transport-per-request)", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "rsmcp-http-test-"));
  const port = 40000 + Math.floor(Math.random() * 20000);
  const child = spawn(
    process.execPath,
    [join(process.cwd(), "dist", "index.js"), "--http", "--port", String(port)],
    { cwd: process.cwd(), env: { ...process.env, RESEARCH_SCOPE_DATA_DIR: dataDir }, stdio: ["ignore", "ignore", "inherit"] }
  );
  try {
    // Shake hands with port-open polling (server prints "listening" to stderr, inherits here).
    const base = `http://127.0.0.1:${port}/mcp`;
    let up = false;
    for (let i = 0; i < 40 && !up; i++) {
      try {
        await fetch(base, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "ping", params: {} }) });
        up = true;
      } catch {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    assert.ok(up, `HTTP server on ${port} never opened`);

    const post = async (payload) =>
      fetch(base, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify(payload),
      });
    const parse = async (res) => {
      const t = await res.text();
      const dataLine = t.split("\n").find((l) => l.startsWith("data:"));
      return JSON.parse(dataLine ? dataLine.slice(5).trim() : t);
    };
    // No mcp-session-id header is held between calls — this test is stateless on purpose.

    // 1. initialize opens the door
    const init = await parse(await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "http-test", version: "0" } } }));
    assert.equal(init.result?.serverInfo?.name, "research-scope-mcp");

    // 2/3. THE regression: further requests must NOT 500, even without any session
    const listed = await parse(await post({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }));
    assert.equal(listed.result?.tools?.length, 4, `tools/list broke: ${JSON.stringify(listed)}`);
    const call = await parse(await post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "plan_research", arguments: { scope: "http regression probe" } } }));
    const plan = JSON.parse(call.result.content[0].text);
    assert.ok(plan.killCriteria.length >= 1);
    assert.ok(plan.primarySourceTargets.length >= 1);
  } finally {
    child.kill();
    await once(child, "exit").catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("full workflow: plan → fetch_and_score → build → check (live fetch, network required)", async () => {
  const client = StdioMcpClient.spawn();
  try {
    await client.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test-client", version: "0.0.1" },
    });
    client.notify("notifications/initialized", {});

    // 1. plan
    const plan = JSON.parse(textPayload(await client.request("tools/call", { name: "plan_research", arguments: { scope: "verify example vendor claim about exam-format change" } })));
    assert.ok(plan.primarySourceTargets.length >= 1);
    assert.ok(plan.killCriteria.length >= 1);

    // 2. fetch_and_score — real (small, stable, primary-host) page; prefix-match union honors both URLs
    const fetchResult = await client.request("tools/call", { name: "fetch_and_score", arguments: { source_url: "https://www.nhtsa.gov/" } });
    assert.ok(!fetchResult.isError, `live fetch failed (network required — see TROUBLESHOOTING.md): ${textPayload(fetchResult)}`);
    const scored = JSON.parse(textPayload(fetchResult));
    assert.ok(typeof scored.score === "number" && scored.score > 0, `expected positive score, got ${JSON.stringify(scored)}`);
    assert.ok(Array.isArray(scored.flags));
    assert.ok(scored.breakdown.length >= 4);

    // 3. build_report with the scored URL (registry is dual-indexed)
    const built = textPayload(await client.request("tools/call", {
      name: "build_report",
      arguments: { topic: "Test report", sources: ["https://www.nhtsa.gov/"] },
    }));
    assert.match(built, /Citation registry/);
    assert.match(built, /report-.*\.md/);

    // unscored sources must be refused
    const refused = await client.request("tools/call", {
      name: "build_report",
      arguments: { topic: "Bad", sources: ["https://never-scored.example.com/"] },
    });
    assert.equal(refused.isError, true);
    assert.match(textPayload(refused), /never scored/);

    // 4. check_report — find the report file path from the built text and use report_path
    const m = built.match(/saved to (\S+\.md)/);
    assert.ok(m, "built output should name the report path");
    const check = JSON.parse(textPayload(await client.request("tools/call", { name: "check_report", arguments: { report_path: m[1] } })));
    // fresh shell has no substantive claims yet → FAIL with instructions (stub lines excluded)
    assert.equal(check.pass, false);
    assert.match(check.verdict, /FAIL|no claims/i);
  } finally {
    await client.close();
  }
  rmSync(DATA_DIR, { recursive: true, force: true });
});

/** Initialize a stdio client and return it ready for tools/call. */
async function initializedClient(env) {
  const client = StdioMcpClient.spawn(env);
  await client.request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test-client", version: "0.0.1" },
  });
  client.notify("notifications/initialized", {});
  return client;
}

const call = (client, name, args) => client.request("tools/call", { name, arguments: args });

test("logging: stderr carries only structured JSON lines, stdout only JSON-RPC", async () => {
  const client = await initializedClient({ RESEARCH_SCOPE_LOG_LEVEL: "debug" });
  try {
    await call(client, "plan_research", { scope: "logging probe" });
    // let the finish log flush
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(client.stderrLines.length >= 2, `expected log lines, got ${JSON.stringify(client.stderrLines)}`);
    for (const line of client.stderrLines) {
      const rec = JSON.parse(line);
      assert.ok(rec.ts && rec.level && rec.event, `log line missing ts/level/event: ${line}`);
    }
    const events = client.stderrLines.map((l) => JSON.parse(l).event);
    assert.ok(events.includes("server.start"));
    assert.ok(events.includes("tool.finish"));
  } finally {
    await client.close();
  }
});

test("fetch_and_score: network failure is an actionable tool error, not a bare 'fetch failed'", async () => {
  const client = await initializedClient();
  try {
    const res = await call(client, "fetch_and_score", { source_url: "https://does-not-exist.invalid/" });
    assert.equal(res.isError, true);
    const text = textPayload(res);
    assert.doesNotMatch(text, /^fetch failed$/);
    assert.match(text, /does-not-exist\.invalid/);
    assert.match(text, /TROUBLESHOOTING\.md#/);
  } finally {
    await client.close();
  }
});

test("offline workflow against a local page: near-miss URL hint, unknown report_id, empty-shell verdict", async () => {
  const page = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<title>Local fixture</title><p>${"Substantive fixture text. ".repeat(60)}</p>`);
  });
  page.listen(0, "127.0.0.1");
  await once(page, "listening");
  const url = `http://127.0.0.1:${page.address().port}/fixture/`;
  const dataDir = mkdtempSync(join(tmpdir(), "rsmcp-offline-"));
  const client = await initializedClient({ RESEARCH_SCOPE_DATA_DIR: dataDir });
  try {
    const scored = await call(client, "fetch_and_score", { source_url: url });
    assert.ok(!scored.isError, textPayload(scored));

    // trailing-slash mismatch → refused, with the scored URL suggested
    const nearMiss = await call(client, "build_report", { topic: "Offline", sources: [url.slice(0, -1)] });
    assert.equal(nearMiss.isError, true);
    assert.match(textPayload(nearMiss), new RegExp(`did you mean ${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));

    const built = textPayload(await call(client, "build_report", { topic: "Offline", sources: [url] }));
    const id = built.match(/Report shell (\w+) saved to (\S+\.md)/);
    assert.ok(id, built);

    const unknown = await call(client, "check_report", { report_id: "nope1234" });
    assert.equal(unknown.isError, true);
    assert.match(textPayload(unknown), /Unknown report_id/);

    const empty = JSON.parse(textPayload(await call(client, "check_report", { report_id: id[1] })));
    assert.equal(empty.pass, false);
    assert.match(empty.verdict, /no substantive claims/);
    assert.match(empty.note, /report_path/);

    // an authored, cited claim in the saved file passes via report_path
    const edited = built.split("\n---\n")[1].replace(
      "## Claims\n",
      "## Claims\n\n- The local fixture page repeats its substantive text sixty times over [S1].\n"
    );
    writeFileSync(id[2], edited, "utf8");
    const passed = JSON.parse(textPayload(await call(client, "check_report", { report_path: id[2] })));
    assert.equal(passed.pass, true, JSON.stringify(passed));
  } finally {
    await client.close();
    page.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
