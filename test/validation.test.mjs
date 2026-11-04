/**
 * Unit tests for tool input validation (src/validation.ts), plus a no-network
 * stdio check that the running server surfaces the same actionable messages.
 * Run: npm test   (or: npm run build && node --test test/validation.test.mjs)
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";

import { validateToolInput, LIMITS } from "../dist/validation.js";

function ok(tool, args) {
  const r = validateToolInput(tool, args);
  assert.equal(r.ok, true, `expected ${tool} to accept ${JSON.stringify(args)}, got: ${r.message}`);
  return r.data;
}

function fails(tool, args, pattern) {
  const r = validateToolInput(tool, args);
  assert.equal(r.ok, false, `expected ${tool} to reject ${JSON.stringify(args)}`);
  assert.match(r.message, pattern);
  return r.message;
}

describe("plan_research", () => {
  test("accepts a scope alone", () => {
    assert.deepEqual(ok("plan_research", { scope: "verify vendor claim" }), { scope: "verify vendor claim" });
  });
  test("accepts domain_hints and trims values", () => {
    const d = ok("plan_research", { scope: "  exam change  ", domain_hints: [" .gov ", "arxiv.org"] });
    assert.equal(d.scope, "exam change");
    assert.deepEqual(d.domain_hints, [".gov", "arxiv.org"]);
  });
  test("rejects missing scope with an example", () => {
    fails("plan_research", {}, /scope is required — e\.g\./);
  });
  test("rejects non-string scope", () => {
    fails("plan_research", { scope: 42 }, /scope must be a string/);
  });
  test("rejects whitespace-padded short scope", () => {
    fails("plan_research", { scope: "  ab  " }, /scope must be at least 3 characters after trimming/);
  });
  test("rejects overly long scope", () => {
    fails("plan_research", { scope: "x".repeat(LIMITS.scopeMax + 1) }, /scope must be at most 500 characters/);
  });
  test("rejects domain_hints that is not an array", () => {
    fails("plan_research", { scope: "valid scope", domain_hints: ".gov" }, /domain_hints must be an array of strings/);
  });
  test("rejects empty domain_hints entry and names its index", () => {
    fails("plan_research", { scope: "valid scope", domain_hints: [".gov", " "] }, /entries must not be empty.* at domain_hints\.1/);
  });
  test("rejects too many domain_hints", () => {
    const hints = Array.from({ length: LIMITS.domainHintsMax + 1 }, (_, i) => `h${i}.org`);
    fails("plan_research", { scope: "valid scope", domain_hints: hints }, /at most 20 entries/);
  });
});

describe("fetch_and_score", () => {
  test("accepts http and https URLs", () => {
    ok("fetch_and_score", { source_url: "https://www.nhtsa.gov/" });
    ok("fetch_and_score", { source_url: "http://example.org/path?q=1" });
  });
  test("rejects missing source_url", () => {
    fails("fetch_and_score", {}, /source_url is required/);
  });
  test("rejects a relative / scheme-less URL with a fix hint", () => {
    fails("fetch_and_score", { source_url: "www.nhtsa.gov" }, /not a valid absolute URL — include the scheme and host/);
  });
  test("rejects non-web schemes", () => {
    fails("fetch_and_score", { source_url: "file:///etc/passwd" }, /must use http or https \(got "file:"\)/);
    fails("fetch_and_score", { source_url: "javascript:alert(1)" }, /must use http or https/);
  });
  test("rejects empty and over-long URLs", () => {
    fails("fetch_and_score", { source_url: "" }, /must not be empty/);
    fails("fetch_and_score", { source_url: "https://a.org/" + "x".repeat(LIMITS.urlMax) }, /at most 2048 characters/);
  });
});

describe("build_report", () => {
  test("accepts topic + scored URLs", () => {
    const d = ok("build_report", { topic: "Exam change", sources: ["https://www.nhtsa.gov/", "https://example.org/a"] });
    assert.equal(d.sources.length, 2);
  });
  test("rejects missing sources with a next step", () => {
    fails("build_report", { topic: "Exam change" }, /sources is required — pass the URLs you already scored/);
  });
  test("rejects empty sources array", () => {
    fails("build_report", { topic: "Exam change", sources: [] }, /at least one URL — score a source with fetch_and_score first/);
  });
  test("rejects a bad URL and points at its index", () => {
    fails("build_report", { topic: "Exam change", sources: ["https://ok.org/", "not a url"] }, /not a valid absolute URL.* at sources\.1/);
  });
  test("rejects duplicate sources", () => {
    fails("build_report", { topic: "Exam change", sources: ["https://ok.org/", "https://ok.org/"] }, /duplicate source .* at sources\.1/);
  });
  test("rejects too many sources", () => {
    const sources = Array.from({ length: LIMITS.sourcesMax + 1 }, (_, i) => `https://s${i}.org/`);
    fails("build_report", { topic: "Exam change", sources }, /at most 50 URLs/);
  });
  test("reports every problem at once", () => {
    const msg = fails("build_report", { topic: "x", sources: "https://ok.org/" }, /topic must be at least 3/);
    assert.match(msg, /sources must be an array of URL strings/);
  });
});

describe("check_report", () => {
  test("accepts a report_id", () => {
    ok("check_report", { report_id: "1a2b3c4d" });
  });
  test("accepts a .md / .markdown report_path", () => {
    ok("check_report", { report_path: "data/reports/report-1a2b3c4d.md" });
    ok("check_report", { report_path: "/tmp/notes.MARKDOWN" });
  });
  test("rejects calls with neither field", () => {
    fails("check_report", {}, /provide report_id .* or report_path/);
  });
  test("rejects malformed report_id", () => {
    fails("check_report", { report_id: "report-1" }, /8-character lowercase hex id printed by build_report/);
  });
  test("rejects non-markdown report_path", () => {
    fails("check_report", { report_path: "data/reports/report.txt" }, /must point to a Markdown file ending in \.md/);
  });
  test("rejects wrong types", () => {
    fails("check_report", { report_path: 5 }, /report_path must be a string/);
  });
});

test("server returns validation errors as actionable isError tool results (stdio, no network)", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "rsmcp-val-"));
  const child = spawn(process.execPath, [join(process.cwd(), "dist", "index.js")], {
    env: { ...process.env, RESEARCH_SCOPE_DATA_DIR: dataDir },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const pending = new Map();
  let buf = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        pending.get(msg.id)?.(msg);
      } catch {}
    }
  });
  let nextId = 1;
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => reject(new Error(`timeout: ${method}`)), 10000);
      pending.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  const call = async (name, args) => (await request("tools/call", { name, arguments: args })).result;

  try {
    await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "val-test", version: "0" } });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

    // advertised JSON Schema still carries the fields + descriptions
    const list = (await request("tools/list", {})).result;
    const fetchTool = list.tools.find((t) => t.name === "fetch_and_score");
    assert.deepEqual(fetchTool.inputSchema.required, ["source_url"]);
    assert.match(fetchTool.inputSchema.properties.source_url.description, /http\/https/);

    const cases = [
      ["plan_research", { scope: "a" }, /Invalid arguments for tool plan_research: scope must be at least 3 characters/],
      ["fetch_and_score", { source_url: "file:///etc/passwd" }, /must use http or https/],
      ["build_report", { topic: "Topic", sources: [] }, /score a source with fetch_and_score first/],
      ["check_report", {}, /provide report_id .* or report_path/],
      ["check_report", { report_id: "deadbeef" }, /No report with id "deadbeef"/],
    ];
    for (const [name, args, pattern] of cases) {
      const result = await call(name, args);
      assert.equal(result.isError, true, `${name} ${JSON.stringify(args)} should be an error`);
      assert.match(result.content[0].text, pattern);
    }

    // valid input still works end to end
    const ok = await call("plan_research", { scope: "valid scope", domain_hints: [".gov"] });
    assert.notEqual(ok.isError, true);
    assert.ok(JSON.parse(ok.content[0].text).killCriteria.length >= 1);
  } finally {
    child.kill();
    await once(child, "exit").catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  }
});
