/**
 * Tool-level tests: an in-process MCP client drives the real server over the
 * SDK's in-memory transport, and a local fixture web server stands in for the
 * internet so fetch_and_score is deterministic and offline.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createState } from "../dist/server.js";
import { MAX_BODY_BYTES } from "../dist/fetch.js";
import { connectInProcess, fixtureServer, json, text, tempDir, longText } from "./helpers.mjs";

const article = (body, head = "") => `<!doctype html><html><head><title>Fixture article</title>${head}</head><body><article>${body}</article></body></html>`;
const CLAIM = "- The fixture agency published its adaptive exam format notice this month [S1].";

let web;
let tmp;
let mcp;

before(async () => {
  web = await fixtureServer({
    "/article": { body: article(longText(3500), `<meta property="article:published_time" content="${new Date().toISOString()}">`) },
    "/second": { body: article(longText(900)) },
    "/old": { body: article(longText(900)), headers: { "last-modified": "Wed, 21 Oct 2015 07:28:00 GMT" } },
    "/redirect": (req, res) => res.writeHead(302, { location: "/article" }).end(),
    "/gone": { status: 410, body: "gone" },
    "/json": { headers: { "content-type": "application/json" }, body: JSON.stringify({ hello: "world" }) },
    "/huge": (req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      const chunk = "a".repeat(1024 * 1024);
      for (let i = 0; i < 8; i++) res.write(chunk);
      res.end();
    },
  });
  tmp = tempDir();
  mcp = await connectInProcess(createState({ dataDir: tmp.dir }));
});

after(async () => {
  await mcp.close();
  await web.close();
  tmp.cleanup();
});

test("tools/list exposes the four workflow tools with schemas and annotations", async () => {
  const { tools } = await mcp.client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["build_report", "check_report", "fetch_and_score", "plan_research"]);
  for (const t of tools) {
    assert.equal(t.inputSchema.type, "object");
    assert.ok(t.description.length > 20);
    assert.ok(t.annotations, `${t.name} has annotations`);
  }
  assert.equal(tools.find((t) => t.name === "plan_research").annotations.readOnlyHint, true);
});

test("server reports its name and version", async () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.deepEqual(mcp.client.getServerVersion(), { name: "research-scope-mcp", version: pkg.version });
});

describe("plan_research", () => {
  test("returns targets and kill criteria, honoring domain hints", async () => {
    const plan = json(await mcp.call("plan_research", { scope: "verify a vendor claim", domain_hints: ["sec.gov", "arxiv.org"] }));
    assert.equal(plan.scope, "verify a vendor claim");
    assert.ok(plan.primarySourceTargets.some((t) => t.what.includes("sec.gov, arxiv.org")));
    assert.ok(plan.killCriteria.length >= 3);
    assert.ok(plan.antiTargets.length >= 1);
  });
  test("rejects a too-short scope", async () => {
    const r = await mcp.call("plan_research", { scope: "x" });
    assert.equal(r.isError, true);
  });
});

describe("fetch_and_score", () => {
  test("scores a page and uses its meta publication date", async () => {
    const s = json(await mcp.call("fetch_and_score", { source_url: web.url("/article") }));
    assert.equal(s.url, web.url("/article"));
    assert.equal(s.freshnessDays, 0);
    assert.ok(!s.flags.includes("no-date"));
    assert.equal(s.breakdown.reduce((a, b) => a + b.points, 0), s.score);
  });
  test("an undated page is flagged no-date even though the server sends a Date header (regression)", async () => {
    const s = json(await mcp.call("fetch_and_score", { source_url: web.url("/second") }));
    assert.equal(s.publishedAt, null);
    assert.ok(s.flags.includes("no-date"));
  });
  test("Last-Modified drives freshness when the page declares no date", async () => {
    const s = json(await mcp.call("fetch_and_score", { source_url: web.url("/old") }));
    assert.equal(s.publishedAt, "2015-10-21");
    assert.ok(s.flags.includes("stale:>5y"));
  });
  test("follows redirects and registers under both requested and final URL", async () => {
    const s = json(await mcp.call("fetch_and_score", { source_url: web.url("/redirect") }));
    assert.equal(s.url, web.url("/article"));
    assert.ok(mcp.state.scores.has(web.url("/redirect")));
    assert.ok(mcp.state.scores.has(web.url("/article")));
  });
  test("HTTP errors score 0 with a dead-link flag", async () => {
    const s = json(await mcp.call("fetch_and_score", { source_url: web.url("/gone") }));
    assert.equal(s.score, 0);
    assert.ok(s.flags.includes("http-410"));
  });
  test("non-HTML bodies are scored as plain text", async () => {
    const s = json(await mcp.call("fetch_and_score", { source_url: web.url("/json") }));
    assert.ok(s.flags.includes("thin-content"));
  });
  test("oversized bodies are truncated rather than buffered whole", async () => {
    const s = json(await mcp.call("fetch_and_score", { source_url: web.url("/huge") }));
    assert.ok(MAX_BODY_BYTES < 8 * 1024 * 1024);
    assert.equal(s.breakdown[0].notes, "200000 chars extractable text");
  });
  test("unreachable hosts return a tool error, not a crash", async () => {
    const dead = web.base.replace(/:\d+$/, ":1");
    const r = await mcp.call("fetch_and_score", { source_url: `${dead}/x` });
    assert.equal(r.isError, true);
    assert.match(text(r), /Could not fetch/);
  });
  test("non-http(s) URLs are refused", async () => {
    for (const source_url of ["file:///etc/passwd", "ftp://example.com/x"]) {
      const r = await mcp.call("fetch_and_score", { source_url });
      assert.equal(r.isError, true, source_url);
      assert.match(text(r), /Only http\(s\) URLs/);
    }
  });
});

describe("build_report + check_report", () => {
  test("refuses unscored sources and names them", async () => {
    const r = await mcp.call("build_report", { topic: "Bad", sources: ["https://never-scored.example.com/"] });
    assert.equal(r.isError, true);
    assert.match(text(r), /never scored[\s\S]*never-scored\.example\.com/);
  });

  test("writes a shell under dataDir/reports, de-duplicating repeated sources", async () => {
    await mcp.call("fetch_and_score", { source_url: web.url("/redirect") });
    const built = text(await mcp.call("build_report", { topic: "Fixture report", sources: [web.url("/redirect"), web.url("/article"), web.url("/second")] }));
    const path = built.match(/saved to (\S+\.md)/)[1];
    assert.ok(path.startsWith(join(tmp.dir, "reports")));
    const md = readFileSync(path, "utf8");
    assert.match(md, /\[S1\] http:\/\/127\.0\.0\.1:\d+\/article/);
    assert.match(md, /\[S2\] http:\/\/127\.0\.0\.1:\d+\/second/);
    assert.doesNotMatch(md, /\[S3\]/);
  });

  test("check_report by id reads the edited file on disk, not the stale shell (regression)", async () => {
    const built = text(await mcp.call("build_report", { topic: "Edit me", sources: [web.url("/article")] }));
    const [, id, path] = built.match(/Report shell (\S+) saved to (\S+\.md)/);

    const fresh = json(await mcp.call("check_report", { report_id: id }));
    assert.equal(fresh.pass, false);

    writeFileSync(path, readFileSync(path, "utf8").replace("## Citation registry", `${CLAIM}\n\n## Citation registry`));
    const edited = json(await mcp.call("check_report", { report_id: id }));
    assert.equal(edited.pass, true, JSON.stringify(edited));
    assert.equal(edited.claimsCited, 1);

    const byPath = json(await mcp.call("check_report", { report_path: path }));
    assert.equal(byPath.pass, true);
    assert.equal(byPath.report, path);
  });

  test("check_report flags orphan and unknown citations", async () => {
    const built = text(await mcp.call("build_report", { topic: "Orphans", sources: [web.url("/article")] }));
    const path = built.match(/saved to (\S+\.md)/)[1];
    const extra = ["- An assertion with no citation attached to it whatsoever here.", "- An assertion citing a registry number that does not exist [S4]."];
    writeFileSync(path, readFileSync(path, "utf8").replace("## Citation registry", `${CLAIM}\n${extra.join("\n")}\n\n## Citation registry`));
    const r = json(await mcp.call("check_report", { report_path: path }));
    assert.equal(r.pass, false);
    assert.equal(r.orphanClaims.length, 1);
    assert.deepEqual(r.unknownCitations.map((c) => c.unknown), [["S4"]]);
  });

  test("check_report argument errors", async () => {
    const none = await mcp.call("check_report", {});
    assert.equal(none.isError, true);
    const unknown = await mcp.call("check_report", { report_id: "nope1234" });
    assert.equal(unknown.isError, true);
    assert.match(text(unknown), /Unknown report_id/);
    const traversal = await mcp.call("check_report", { report_id: "../../etc/passwd" });
    assert.equal(traversal.isError, true);
    const missing = await mcp.call("check_report", { report_path: join(tmp.dir, "missing.md") });
    assert.equal(missing.isError, true);
    assert.match(text(missing), /not found/);
  });

  test("ids survive a restart: a new state finds the saved report on disk", async () => {
    const built = text(await mcp.call("build_report", { topic: "Persist", sources: [web.url("/article")] }));
    const id = built.match(/Report shell (\S+) saved/)[1];
    const other = await connectInProcess(createState({ dataDir: tmp.dir }));
    try {
      const r = await other.call("check_report", { report_id: id });
      assert.notEqual(r.isError, true, text(r));
    } finally {
      await other.close();
    }
  });

  test("restricted state refuses report paths outside the data dir", async () => {
    const outside = tempDir();
    const restricted = await connectInProcess(createState({ dataDir: tmp.dir, restrictPathsToDataDir: true }));
    try {
      const file = join(outside.dir, "r.md");
      writeFileSync(file, "# x");
      const r = await restricted.call("check_report", { report_path: file });
      assert.equal(r.isError, true);
      assert.match(text(r), /inside the server data directory/);
      assert.ok(existsSync(file));
    } finally {
      await restricted.close();
      outside.cleanup();
    }
  });
});
