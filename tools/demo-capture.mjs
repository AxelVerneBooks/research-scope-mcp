#!/usr/bin/env node
/**
 * demo-capture — reproducible capture of the 60-second demo run.
 *
 * Spawns the shipped server (dist/index.js) over stdio with a fresh temp data
 * dir, replays the scripted demo flow exactly as documented in
 * docs/marketing/demo-60s/demo-plan.md:
 *
 *   initialize → tools/list → plan_research → fetch_and_score (.gov, real fetch)
 *   → build_report → [human edit: one cited claim + one orphan claim]
 *   → check_report (must come back pass:false)
 *
 * and writes every message out as a {t, dir, msg} JSONL transcript shaped like
 * docs/marketing/demo-60s/run-capture.jsonl (the transcript the demo player's
 * footer sha256 is anchored to).
 *
 * Usage:
 *   node tools/demo-capture.mjs [--out PATH] [--force] [--step-ms N]
 *
 * Defaults: --out docs/marketing/demo-60s/run-capture.jsonl, --step-ms 1000.
 * The default path refuses to be overwritten without --force, because the
 * published demo player footer references that specific transcript's sha256.
 */

import { spawn } from "node:child_process";
import { statSync, mkdirSync } from "node:fs";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---- args -----------------------------------------------------------------
const args = process.argv.slice(2);
function argValue(name) {
  const idx = args.indexOf(name);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
}
const hasFlag = (name) => args.includes(name);
const OUT_PATH = argValue("--out") ?? path.join(ROOT, "docs/marketing/demo-60s/run-capture.jsonl");
const FORCE = hasFlag("--force");
const STEP_MS = Number(argValue("--step-ms")) || 1000;

if (!FORCE && exists(OUT_PATH)) {
  console.error(
    `refusing to overwrite ${path.relative(ROOT, OUT_PATH)} without --force.\n` +
      "The published demo player footer pins a sha256 of that transcript; " +
      "if you intend to re-cut the demo, verify with --force and refresh the footer sha."
  );
  process.exit(2);
}

function exists(p) {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

// ---- run ------------------------------------------------------------------
const dataDir = await mkdtemp(path.join(tmpdir(), "rsm-demo-data-"));
const capture = [];
const startedAt = Date.now();
const now = () => `${((Date.now() - startedAt) / 1000).toFixed(2)}s`;
const log = (dir, msg) => capture.push({ t: now(), dir, msg: typeof msg === "string" ? msg : JSON.stringify(msg) });

let child;
try {
  child = spawn(process.execPath, [path.join(ROOT, "dist", "index.js")], {
    env: { ...process.env, RESEARCH_SCOPE_DATA_DIR: dataDir },
    stdio: ["pipe", "pipe", "inherit"],
  });
  console.error(`# spawning ${path.relative(ROOT, "dist/index.js")} (stdio), data dir ${dataDir}`);

  const pending = new Map();
  let pendingId = 0;
  let buf = "";

  child.stdout.on("data", (chunk) => {
    buf += chunk.toString();
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // non-JSON noise is not part of the protocol transcript
      }
      log("recv", JSON.stringify(msg));
      const p = pending.get(msg.id);
      if (p) {
        pending.delete(msg.id);
        p(msg);
      }
    }
  });

  const request = async (method, params) => {
    const id = ++pendingId;
    const frame = { jsonrpc: "2.0", id, method, params: params ?? {} };
    log("send", JSON.stringify(frame));
    return new Promise((res) => {
      pending.set(id, res);
      child.stdin.write(JSON.stringify(frame) + "\n");
    });
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = async (method, params, label) => {
    if (capture.length) await sleep(STEP_MS); // pace like a human driving the client
    const resp = await request(method, params);
    if (resp.error) throw new Error(`${label}: server error ${JSON.stringify(resp.error)}`);
    return resp;
  };
  const resultText = (resp) => resp.result.content?.map((c) => (c.type === "text" ? c.text : "")).join("\n") ?? "";

  await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "demo-driver", version: "0.0.1" },
  });
  // notifications/initialized: sent but not logged (not part of the transcript shape)
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  await sleep(STEP_MS);

  await request("tools/list", {});
  await step("tools/call", {
    name: "plan_research",
    arguments: { scope: "verify vendor data-retention claim before it goes in a comparison article" },
  }, "plan_research");
  await step("tools/call", {
    name: "fetch_and_score",
    arguments: { source_url: "https://www.nhtsa.gov/" },
  }, "fetch_and_score");
  const built = await step("tools/call", {
    name: "build_report",
    arguments: {
      topic: "Vendor data-retention claim — comparison-article audit",
      sources: ["https://www.nhtsa.gov/"],
    },
  }, "build_report");

  const saveMatch = resultText(built).match(/saved to (\S+\.md)/);
  if (!saveMatch) throw new Error("build_report: could not locate saved report path in output");
  const reportPath = saveMatch[1];

  // Human edit step (logged as dir:"edit"): one cited claim, one deliberately
  // orphan claim — the honest-failure beat of the demo.
  const reportMd = await readFile(reportPath, "utf8");
  const claims = [
    "Vendor’s review page reports the 90-day default and claims the 90-day floor applies to every plan tier [S1].",
    "The platform-by-platform comparison shows retention varies far more between plans than the vendor’s marketing concedes.",
  ];
  const updatedMd = reportMd.replace(
    /\n## Citation registry\n/,
    `\n${claims.map((c) => `- ${c}`).join("\n")}\n\n## Citation registry\n`
  );
  if (updatedMd === reportMd) throw new Error("edit step: Could not find ## Citation registry section in report shell");
  await writeFile(reportPath, updatedMd, "utf8");
  log("edit", {
    report_path: reportPath,
    claimsWritten: 2,
    orphan: 1,
  });
  await sleep(STEP_MS);

  const checked = await step("tools/call", {
    name: "check_report",
    arguments: { report_path: reportPath },
  }, "check_report");
  const checkResult = JSON.parse(resultText(checked));
  if (checkResult.pass !== false) {
    throw new Error(`check_report: expected the honest FAIL (pass:false), got pass:${checkResult.pass}`);
  }

  child.stdin.end();
  const exitCode = await new Promise((res) => child.on("exit", res));
  if (exitCode !== 0) throw new Error(`server exited with code ${exitCode}`);

  const outRel = path.relative(ROOT, OUT_PATH);
  mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, capture.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
  const sha = createHash("sha256").update(capture.map((e) => JSON.stringify(e)).join("\n") + "\n").digest("hex");
  console.error(`# wrote ${capture.length} transcript events -> ${outRel}`);
  console.error(`# sha256(full) ${sha}`);
  console.error(
    `# footer sha: ${sha.slice(0, 16)}…${sha.slice(-6)}  (demo player footer format)`
  );
  console.error(`# check_report verdict: FAIL (pass:false, ${checkResult.orphanClaims.length} orphan claim(s)) — as scripted`);
  console.error(`# temp data dir left at ${dataDir}`);
} catch (err) {
  if (child) child.kill("SIGTERM");
  console.error(`# capture FAILED: ${err.message}`);
  try {
    await rm(dataDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
  process.exit(1);
}
