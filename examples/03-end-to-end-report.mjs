#!/usr/bin/env node
/**
 * Example 3 — the full research-to-report workflow, ending in a PASS.
 *
 * Research question: "Which Node.js release line should we target for a new
 * MCP server, and how do users register it with Claude Code?"
 *
 *   plan_research → fetch_and_score ×3 → build_report → (agent writes cited
 *   claims into the shell) → check_report → PASS
 *
 * The claims written in step 4 are what an agent would write after reading the
 * three pages; each one restates something the cited page actually says (see
 * the "grounding" quotes next to each claim — they were copied from the pages).
 *
 * Agent prompt equivalent (Claude Desktop / Claude Code / Cursor):
 *   "Research which Node.js release line a new MCP server should target and how
 *    users add it to Claude Code. Use research-scope: plan first, score
 *    nodejs.org/en/blog/release/v22.11.0, pypi.org/project/mcp/ and
 *    code.claude.com/docs/en/mcp, build a report, write cited claims, and don't
 *    show me anything until check_report passes."
 *
 * Requires network access. Run:  node examples/03-end-to-end-report.mjs
 */

import { readFile, writeFile } from "node:fs/promises";
import { connect, call, step, show, scoreLine } from "./_client.mjs";

const TOPIC = "Node.js target line and Claude Code registration for a new MCP server";
const SOURCES = [
  "https://nodejs.org/en/blog/release/v22.11.0", // [S1]
  "https://pypi.org/project/mcp/", // [S2]
  "https://code.claude.com/docs/en/mcp", // [S3]
];

// Each claim cites the registry number build_report assigns (sources keep input order).
const CLAIMS = [
  // grounding [S1]: "This release marks the transition of Node.js 22.x into Long Term Support (LTS) with the codename 'Jod'."
  "- Node.js 22.11.0, released 2024-10-29, moved the 22.x line into Long Term Support under the codename 'Jod' [S1].",
  // grounding [S1]: "will remain so until October 2025. After that time, it will move into \"Maintenance\" until end of life in April 2027."
  "- The 22.x line stayed in Active LTS until October 2025 and is in Maintenance until its end of life in April 2027, so a server started today should not plan on 22.x past that date [S1].",
  // grounding [S2]: page title "mcp" / summary "Model Context Protocol SDK"
  "- Teams that need a Python implementation instead can use the official SDK, published on PyPI as the `mcp` package and described there as the Model Context Protocol SDK [S2].",
  // grounding [S3]: "claude mcp add --transport stdio myserver -- npx server" and the Local / Project / User scope sections
  "- Claude Code users register a local stdio server with `claude mcp add --transport stdio <name> -- <command>`, and can install it at local, project, or user scope [S3].",
];

const { client, close } = await connect("example-03-end-to-end-report");
try {
  step("1. plan_research");
  const plan = await call(client, "plan_research", {
    scope: "which Node.js release line a new MCP server should target, and how users register it with Claude Code",
    domain_hints: ["nodejs.org", "code.claude.com", "pypi.org"],
  });
  show({ primarySourceTargets: plan.json.primarySourceTargets, killCriteria: plan.json.killCriteria });

  step("2. fetch_and_score each source");
  const scores = [];
  for (const url of SOURCES) {
    const r = await call(client, "fetch_and_score", { source_url: url });
    if (r.isError || !r.json) throw new Error(`could not score ${url}: ${r.text}`);
    console.log(scoreLine(r.json));
    scores.push(r.json);
  }
  const allBelow45 = scores.every((s) => s.score < 45);
  console.log(allBelow45 ? "kill criterion hit: every source < 45 → stop" : "kill criteria checked → proceed");
  if (allBelow45) process.exit(1);

  step("3. build_report");
  const built = await call(client, "build_report", { topic: TOPIC, sources: SOURCES });
  if (built.isError) throw new Error(built.text);
  show(built.text);
  const reportPath = built.text.match(/saved to (\S+\.md)/)[1];

  step("4. agent writes cited claims into the shell's ## Claims section");
  const shell = await readFile(reportPath, "utf8");
  const filled = shell.replace("## Claims\n", `## Claims\n\n${CLAIMS.join("\n")}\n`);
  await writeFile(reportPath, filled, "utf8");
  show(CLAIMS.join("\n"));

  step("5. check_report");
  const check = await call(client, "check_report", { report_path: reportPath });
  show(check.json);

  step("final report (what the user gets to see)");
  show(filled);
  if (!check.json.pass) process.exitCode = 1;
} finally {
  await close();
}
