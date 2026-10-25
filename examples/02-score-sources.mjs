#!/usr/bin/env node
/**
 * Example 2 — score a set of candidate sources and read the evidence.
 *
 * fetch_and_score does a real HTTP fetch of each URL and returns a 0–100 score
 * with a per-dimension breakdown. This example scores four real pages of
 * different kinds plus one dead link, then prints a triage table and the full
 * evidence for one source, so you can see *why* each number is what it is.
 *
 *   - a vendor's own release announcement   (self-published primary)
 *   - a package-index project page          (secondary listing)
 *   - an official product docs page         (vendor docs)
 *   - a JSON registry API response          (machine-readable listing)
 *   - a URL that 404s                        (HTTP status gate → D, flag http-404)
 *
 * Agent prompt equivalent:
 *   "Score these sources with fetch_and_score and tell me which ones clear 45/100:
 *    <urls>. Show the breakdown for the lowest-scoring live one."
 *
 * Requires network access. Run:  node examples/02-score-sources.mjs
 */

import { connect, call, step, show, scoreLine } from "./_client.mjs";

const SOURCES = [
  "https://nodejs.org/en/blog/release/v22.11.0",
  "https://pypi.org/project/mcp/",
  "https://code.claude.com/docs/en/mcp",
  "https://registry.modelcontextprotocol.io/v0/servers?search=research-scope-mcp",
  "https://nodejs.org/en/blog/release/v0.0.0-this-release-does-not-exist",
];

const { client, close } = await connect("example-02-score-sources");
try {
  const scores = [];
  for (const url of SOURCES) {
    step(`fetch_and_score ${url}`);
    const r = await call(client, "fetch_and_score", { source_url: url });
    if (r.isError || !r.json) {
      // network failures come back as tool errors, not crashes — report and move on
      console.log(`tool error: ${r.text}`);
      continue;
    }
    console.log(scoreLine(r.json));
    console.log(`primary=${r.json.isPrimarySource} publishedAt=${r.json.publishedAt ?? "—"} freshnessDays=${r.json.freshnessDays ?? "—"}`);
    scores.push(r.json);
  }

  step("triage (kill criterion: every scored source below 45/100 → stop)");
  const usable = scores.filter((s) => s.score >= 45).sort((a, b) => b.score - a.score);
  const dropped = scores.filter((s) => s.score < 45);
  console.log("usable:");
  usable.forEach((s) => console.log(`  ${scoreLine(s)}`));
  console.log("dropped:");
  dropped.forEach((s) => console.log(`  ${scoreLine(s)}`));
  console.log(usable.length ? `→ proceed with ${usable.length} source(s)` : "→ STOP: insufficient sources");

  const lowestLive = [...usable].pop();
  if (lowestLive) {
    step(`full evidence for the lowest-scoring usable source: ${lowestLive.url}`);
    show(lowestLive.breakdown);
  }
} finally {
  await close();
}
