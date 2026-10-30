#!/usr/bin/env node
/**
 * Install smoke test — drives a server launched exactly the way the README
 * documents it and runs the llms-install "verify installation" step:
 * initialize → tools/list (4 tools) → plan_research("verify install").
 * No network fetches beyond whatever the launch command itself needs.
 *
 * Usage:
 *   node tools/smoke.mjs                                  # stdio, `research-scope-mcp` on PATH
 *   node tools/smoke.mjs -- npx -y research-scope-mcp     # stdio, any launch command
 *   node tools/smoke.mjs --http -- npx -y research-scope-mcp
 *     (--http appends `--http --port <free port>` to the launch command)
 *   npm run smoke -- npx -y research-scope-mcp            # npm eats the `--`; also fine
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

// Leading smoke flags, then the launch command (optionally after `--`).
const argv = process.argv.slice(2);
let http = false;
while (argv[0] === "--http") {
  http = true;
  argv.shift();
}
if (argv[0] === "--") argv.shift();
let cmd = argv.length ? argv : ["research-scope-mcp"];
const TIMEOUT_MS = 120_000; // first npx run downloads the package

const dataDir = mkdtempSync(join(tmpdir(), "rsmcp-smoke-"));
const EXPECTED_TOOLS = ["build_report", "check_report", "fetch_and_score", "plan_research"];
const INIT = { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0" } };

function fail(msg) {
  console.error(`SMOKE FAIL: ${msg}`);
  process.exitCode = 1;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

// Launchers like npx run the server as a grandchild: start each launch in its own
// process group and kill the whole group, or the server outlives the smoke run.
const children = new Set();
function launch(stdio) {
  const child = spawn(cmd[0], cmd.slice(1), {
    env: { ...process.env, RESEARCH_SCOPE_DATA_DIR: dataDir },
    stdio,
    detached: true,
  });
  children.add(child);
  return child;
}

function stop(child) {
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill();
  }
}

function check(init, tools, planResult) {
  if (init?.serverInfo?.name !== "research-scope-mcp") throw new Error(`bad initialize: ${JSON.stringify(init)}`);
  const names = (tools?.tools ?? []).map((t) => t.name).sort();
  if (JSON.stringify(names) !== JSON.stringify(EXPECTED_TOOLS)) throw new Error(`bad tools/list: ${names.join(",")}`);
  const plan = JSON.parse(planResult.content[0].text);
  for (const key of ["primarySourceTargets", "corroboratingTargets", "killCriteria"]) {
    if (!Array.isArray(plan[key]) || plan[key].length === 0) throw new Error(`plan_research missing ${key}`);
  }
  console.log(`ok - ${init.serverInfo.name} ${init.serverInfo.version}: ${names.length} tools, plan_research returned kill criteria`);
}

async function runStdio() {
  const child = launch(["pipe", "pipe", "inherit"]);
  const pending = new Map();
  let buf = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        // anything non-JSON on stdout corrupts a real client's stream
        if (line) fail(`non-JSON on stdout: ${line}`);
        continue;
      }
      pending.get(msg.id)?.(msg);
      pending.delete(msg.id);
    }
  });
  const exited = new Promise((_, reject) => {
    child.on("error", (err) => reject(new Error(`could not launch ${cmd.join(" ")}: ${err.message}`)));
    child.on("exit", (code) => reject(new Error(`server exited early (code ${code}) — launch command: ${cmd.join(" ")}`)));
  });
  let nextId = 1;
  const request = (method, params) =>
    Promise.race([
      exited,
      new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${JSON.stringify(msg.error)}`)) : resolve(msg.result)));
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      }),
    ]);
  try {
    const init = await request("initialize", INIT);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");
    const tools = await request("tools/list", {});
    const plan = await request("tools/call", { name: "plan_research", arguments: { scope: "verify install" } });
    check(init, tools, plan);
  } finally {
    child.removeAllListeners("exit").removeAllListeners("error");
    child.on("error", () => {});
    stop(child);
  }
}

async function runHttp() {
  const port = await freePort();
  cmd = [...cmd, "--http", "--port", String(port)];
  const child = launch(["ignore", "inherit", "inherit"]);
  let exitCode;
  child.on("exit", (code) => (exitCode = code));
  child.on("error", (err) => (exitCode = err.message));
  const base = `http://127.0.0.1:${port}/mcp`;
  const post = async (id, method, params) => {
    const res = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    const text = await res.text();
    const data = text.split("\n").find((l) => l.startsWith("data:"));
    const msg = JSON.parse(data ? data.slice(5).trim() : text);
    if (msg.error) throw new Error(`${method}: ${JSON.stringify(msg.error)}`);
    return msg.result;
  };
  try {
    const deadline = Date.now() + TIMEOUT_MS;
    let init;
    while (!init) {
      if (exitCode !== undefined) throw new Error(`server exited early (code ${exitCode}) — launch command: ${cmd.join(" ")}`);
      if (Date.now() > deadline) throw new Error(`HTTP server never answered on ${base}`);
      try {
        init = await post(1, "initialize", INIT);
      } catch (err) {
        if (err.cause?.code !== "ECONNREFUSED") throw err;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    const tools = await post(2, "tools/list", {});
    const plan = await post(3, "tools/call", { name: "plan_research", arguments: { scope: "verify install" } });
    check(init, tools, plan);
  } finally {
    stop(child);
  }
}

const timer = setTimeout(() => {
  fail(`timed out after ${TIMEOUT_MS / 1000}s`);
  children.forEach(stop);
  process.exit(1);
}, TIMEOUT_MS);
try {
  await (http ? runHttp() : runStdio());
} catch (err) {
  fail(err.message);
} finally {
  clearTimeout(timer);
  rmSync(dataDir, { recursive: true, force: true });
}
process.exit(process.exitCode ?? 0);
