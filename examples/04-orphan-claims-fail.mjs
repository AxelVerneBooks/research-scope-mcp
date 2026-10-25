#!/usr/bin/env node
/**
 * Example 4 — the guardrails: what the server refuses to bless, and the fix.
 *
 * Three failure modes an agent hits in practice, each with real output:
 *
 *   a) build_report with a source that was never scored → isError, names the URL
 *   b) check_report on a fresh, empty shell              → FAIL (no claims is not a pass)
 *   c) check_report with one cited + one uncited claim  → FAIL, orphan claim listed
 *   d) cite the orphan (or delete it), re-check          → PASS
 *
 * This is the behavior to lean on in client instructions, e.g. a Claude Code
 * CLAUDE.md / Cursor rule line: "Never present research findings until
 * research-scope check_report returns pass: true."
 *
 * Requires network access (one real fetch). Run:  node examples/04-orphan-claims-fail.mjs
 */

import { readFile, writeFile } from "node:fs/promises";
import { connect, call, step, show, scoreLine } from "./_client.mjs";

const SCORED = "https://nodejs.org/en/blog/release/v22.11.0";
const NEVER_SCORED = "https://example.com/blog/node-22-is-lts";

const { client, close } = await connect("example-04-orphan-claims-fail");
try {
  step(`setup: fetch_and_score ${SCORED}`);
  const s = await call(client, "fetch_and_score", { source_url: SCORED });
  if (s.isError || !s.json) throw new Error(s.text);
  console.log(scoreLine(s.json));

  step("a) build_report with an unscored source");
  const refused = await call(client, "build_report", { topic: "Node 22 LTS status", sources: [SCORED, NEVER_SCORED] });
  console.log(`isError: ${refused.isError}`);
  show(refused.text);

  step("b) build_report with only the scored source, then check the empty shell");
  const built = await call(client, "build_report", { topic: "Node 22 LTS status", sources: [SCORED] });
  const reportPath = built.text.match(/saved to (\S+\.md)/)[1];
  const shell = await readFile(reportPath, "utf8");
  show((await call(client, "check_report", { report_path: reportPath })).json);

  step("c) one cited claim + one claim with no citation");
  const cited = "- Node.js 22.11.0 moved the 22.x release line into Long Term Support under the codename 'Jod' [S1].";
  const orphan = "- Node.js 22 is also the fastest Node.js release line ever shipped for MCP workloads.";
  await writeFile(reportPath, shell.replace("## Claims\n", `## Claims\n\n${cited}\n${orphan}\n`), "utf8");
  console.log(cited);
  console.log(orphan);
  const failed = (await call(client, "check_report", { report_path: reportPath })).json;
  show(failed);

  step("d) fix: the orphan claim has no source, so remove it (citing it to [S1] would be a lie) and re-check");
  await writeFile(reportPath, shell.replace("## Claims\n", `## Claims\n\n${cited}\n`), "utf8");
  const passed = (await call(client, "check_report", { report_path: reportPath })).json;
  show(passed);

  step("result");
  const ok = refused.isError && failed.pass === false && passed.pass === true;
  console.log(ok ? "OK — unscored source refused, orphan claim caught, clean report passes" : "UNEXPECTED — see above");
  if (!ok) process.exitCode = 1;
} finally {
  await close();
}
