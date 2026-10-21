/**
 * Tool-level tests: a real MCP client talks to an in-process server; sources
 * are served by a local fixture server, so no network access is needed.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createState } from "../dist/server.js";
import { version } from "../dist/version.js";
import { connectInMemory, text, json } from "./helpers/client.mjs";
import { startFixtureServer, articleHtml } from "./helpers/fixtures.mjs";

let fx;
let dataDir;
let state;
let conn;

before(async () => {
  fx = await startFixtureServer({
    "/article": { body: articleHtml({ title: "Agency announcement" }) },
    "/second": { body: articleHtml({ title: "Second source", body: "Sponsored by Acme Corp." }) },
    "/moved": (_req, res) => res.writeHead(301, { location: "/article" }).end(),
    "/gone": { status: 404, body: "<title>Not here</title>" },
    "/slow": (_req, res) => setTimeout(() => res.writeHead(200).end("late"), 2000),
  });
  dataDir = mkdtempSync(join(tmpdir(), "rsmcp-server-test-"));
  state = createState({ dataDir, fetchOptions: { timeoutMs: 500 } });
  conn = await connectInMemory(state);
});

after(async () => {
  await conn.close();
  await fx.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const call = (name, args) => conn.client.callTool({ name, arguments: args });

describe("server metadata", () => {
  test("advertises name, version and workflow instructions", () => {
    assert.deepEqual(conn.client.getServerVersion(), { name: "research-scope-mcp", version });
    assert.match(conn.client.getInstructions(), /plan_research first/);
  });

  test("lists the four workflow tools with input schemas", async () => {
    const { tools } = await conn.client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ["build_report", "check_report", "fetch_and_score", "plan_research"]);
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    assert.deepEqual(byName.plan_research.inputSchema.required, ["scope"]);
    assert.deepEqual(byName.fetch_and_score.inputSchema.required, ["source_url"]);
    assert.deepEqual(byName.build_report.inputSchema.required.sort(), ["sources", "topic"]);
    for (const t of tools) assert.ok(t.description.length > 20, `${t.name} needs a description`);
  });
});

describe("plan_research", () => {
  test("returns targets and kill criteria", async () => {
    const plan = json(await call("plan_research", { scope: "verify vendor claim about exam change" }));
    assert.equal(plan.scope, "verify vendor claim about exam change");
    assert.equal(plan.primarySourceTargets.length, 2);
    assert.equal(plan.corroboratingTargets.length, 2);
    assert.ok(plan.killCriteria.length >= 3);
    assert.deepEqual(plan.domainHints, [".gov", ".edu", "arxiv.org", "press"]);
  });

  test("uses all supplied domain hints", async () => {
    const plan = json(await call("plan_research", { scope: "battery recall", domain_hints: ["cpsc.gov", " nhtsa.gov ", ""] }));
    assert.deepEqual(plan.domainHints, ["cpsc.gov", "nhtsa.gov"]);
    assert.match(plan.primarySourceTargets[1].what, /cpsc\.gov, nhtsa\.gov/);
  });

  test("rejects a too-short scope", async () => {
    const res = await call("plan_research", { scope: "  x " });
    assert.equal(res.isError, true);
  });
});

describe("fetch_and_score", () => {
  test("scores a fixture page and returns the explainable breakdown", async () => {
    const s = json(await call("fetch_and_score", { source_url: fx.url("/article") }));
    assert.equal(s.url, fx.url("/article"));
    assert.equal(s.publishedAt, "2026-10-01");
    assert.equal(s.breakdown.length, 5);
    assert.equal(s.score, s.breakdown.reduce((n, b) => n + b.points, 0));
    assert.ok(state.scores.has(fx.url("/article")));
  });

  test("registers redirects under both the requested and the final URL", async () => {
    const s = json(await call("fetch_and_score", { source_url: fx.url("/moved") }));
    assert.equal(s.url, fx.url("/article"));
    assert.ok(state.scores.has(fx.url("/moved")));
  });

  test("dead links score 0 and are still registered", async () => {
    const s = json(await call("fetch_and_score", { source_url: fx.url("/gone") }));
    assert.equal(s.score, 0);
    assert.ok(s.flags.includes("http-404"));
    assert.ok(state.scores.has(fx.url("/gone")));
  });

  test("timeouts return a tool error and register nothing", async () => {
    const res = await call("fetch_and_score", { source_url: fx.url("/slow") });
    assert.equal(res.isError, true);
    assert.match(text(res), /Timed out after 500ms/);
    assert.ok(!state.scores.has(fx.url("/slow")));
  });

  test("rejects non-http(s) URLs", async () => {
    for (const source_url of ["file:///etc/passwd", "data:text/html,<title>x</title>", "not-a-url"]) {
      const res = await call("fetch_and_score", { source_url });
      assert.equal(res.isError, true, source_url);
    }
  });
});

describe("build_report + check_report", () => {
  let built;
  let reportId;
  let reportPath;

  before(async () => {
    await call("fetch_and_score", { source_url: fx.url("/article") });
    await call("fetch_and_score", { source_url: fx.url("/second") });
    built = text(await call("build_report", { topic: "Fixture topic", sources: [fx.url("/article"), fx.url("/second")] }));
    [, reportId, reportPath] = built.match(/Report shell (\S+) saved to (\S+\.md)/);
  });

  test("saves the shell under <dataDir>/reports and returns the registry", () => {
    assert.ok(reportPath.startsWith(join(dataDir, "reports")));
    assert.ok(existsSync(reportPath));
    const md = readFileSync(reportPath, "utf8");
    assert.match(md, /^# Research report — Fixture topic/);
    assert.match(built, new RegExp(`\\[S1\\] ${fx.url("/article")}`));
    assert.match(built, new RegExp(`\\[S2\\] ${fx.url("/second")}`));
    assert.match(built, new RegExp(`report_id "${reportId}"`));
  });

  test("refuses unscored sources and names them", async () => {
    const res = await call("build_report", { topic: "Bad", sources: [fx.url("/article"), "https://never-scored.example.com/"] });
    assert.equal(res.isError, true);
    assert.match(text(res), /never scored[\s\S]*never-scored\.example\.com/);
  });

  test("lists a URL and its redirect target once", async () => {
    await call("fetch_and_score", { source_url: fx.url("/moved") });
    const out = text(await call("build_report", { topic: "Dedup", sources: [fx.url("/moved"), fx.url("/article")] }));
    assert.match(out, /^\[S1\] /m);
    assert.doesNotMatch(out, /^\[S2\] /m);
  });

  test("keeps a multi-line topic on the title line", async () => {
    const out = text(await call("build_report", { topic: "Line one\n## Injected heading", sources: [fx.url("/article")] }));
    assert.match(out, /# Research report — Line one ## Injected heading\n/);
  });

  test("a fresh shell fails by report_id", async () => {
    const r = json(await call("check_report", { report_id: reportId }));
    assert.equal(r.report, reportId);
    assert.equal(r.pass, false);
    assert.equal(r.claimsFound, 0);
  });

  test("check_report by report_id sees edits made to the saved file (regression)", async () => {
    const md = readFileSync(reportPath, "utf8");
    writeFileSync(
      reportPath,
      md.replace("\n## Citation registry\n", "\n- The agency announced the rule change in its October notice [S1].\n- A sponsored summary repeats the claim without new evidence [S2].\n\n## Citation registry\n")
    );
    const r = json(await call("check_report", { report_id: reportId }));
    assert.equal(r.pass, true, r.verdict);
    assert.equal(r.claimsFound, 2);
  });

  test("check_report by report_path flags orphans and unknown citations", async () => {
    const md = readFileSync(reportPath, "utf8");
    const edited = join(dataDir, "edited.md");
    writeFileSync(edited, md.replace("\n## Citation registry\n", "\n- A claim with no citation that should be flagged as orphan.\n- A claim citing a source that was never registered here [S5].\n\n## Citation registry\n"));
    const r = json(await call("check_report", { report_path: edited }));
    assert.equal(r.pass, false);
    assert.equal(r.orphanClaims.length, 2);
    assert.deepEqual(r.unknownCitations.map((u) => u.citations), [["S5"]]);
  });

  test("check_report by report_id works after a restart (fresh state, same data dir)", async () => {
    const fresh = await connectInMemory(createState({ dataDir }));
    try {
      const r = json(await fresh.client.callTool({ name: "check_report", arguments: { report_id: reportId } }));
      assert.equal(r.pass, true, r.verdict);
    } finally {
      await fresh.close();
    }
  });

  test("check_report errors", async () => {
    const missingArgs = await call("check_report", {});
    assert.equal(missingArgs.isError, true);
    assert.match(text(missingArgs), /Provide either report_id/);

    const unknown = await call("check_report", { report_id: "deadbeef" });
    assert.equal(unknown.isError, true);
    assert.match(text(unknown), /Unknown report_id "deadbeef"/);

    const traversal = await call("check_report", { report_id: "../../etc/passwd" });
    assert.equal(traversal.isError, true);
    assert.match(text(traversal), /Invalid report_id/);

    const noFile = await call("check_report", { report_path: join(dataDir, "nope.md") });
    assert.equal(noFile.isError, true);
    assert.match(text(noFile), /Report file not found/);
  });
});
