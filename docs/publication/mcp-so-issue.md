# mcp.so submission issue — ready to paste (repo: `chatmcp/mcpso`)

Built 2026-10-15 with the submission path **verified live**: mcp.so's FAQ says servers
are submitted "by creating a new issue in our GitHub repository"; the footer's repo
link (`github.com/chatmcp/mcp-directory`) redirects to the renamed repo
**`chatmcp/mcpso`** — confirmed public with issues enabled via the GitHub API. There
is no form template on that repo (`.github` contents 404 on the old name; no
ISSUE_TEMPLATE on the current name), so this is a plain issue in their FAQ's format:
**name, description, features, connection information.**

**One-time prerequisite (same as everything else):** the repo
`AxelVerneBooks/research-scope-mcp` must be public and contain the logo — else edit
step: include the logo URL only after publish-day packet step 3 returns 200.

**Open:** https://github.com/chatmcp/mcpso/issues/new (plain issue, no template).

## Title

```
[Server Submission] research-scope-mcp — research-to-report workflow MCP server (plan / fetch-and-score / build / check)
```

## Body (paste everything between the rules)

```
# research-scope-mcp

**Repository:** https://github.com/AxelVerneBooks/research-scope-mcp
**License:** MIT · **Language:** TypeScript (Node ≥ 20) · **Registry manifest:** server.json, valid against the official MCP registry (2025-12-11 schema)
**Logo (400×400):** https://github.com/AxelVerneBooks/research-scope-mcp/raw/main/docs/logo/logo-400.png

## Description

research-scope-mcp is a research-to-report workflow server. It turns a scattered
source set into a decision-ready, traceable report: plan research with kill criteria,
fetch-and-score every source against an explainable 0-100 rubric (primary-source
detection, publication freshness, paywall and conflict-of-interest flags), build a
citation-registry report shell, and then CHECK the report — every substantive claim
must cite at least one scored source, and orphan claims come back as an error list,
not a pass. The goal: an agent-written report a human can audit in 90 seconds.

## Features (4 tools)

- `plan_research(scope, domain_hints?)` — source-target plan with kill criteria
  (stops thin-evidence research before it starts)
- `fetch_and_score(source_url)` — crawls one URL and returns the explainable score
  with per-dimension evidence; undated/paywalled/COI flags are IN the result file
- `build_report(topic, sources)` — citation-registry report shell; unscored sources
  are rejected with an error naming them
- `check_report(report_id | report_path)` — citation coverage enforcement; PASS is
  only possible when every claim cites a scored source

Integrated scoring rubric (v1): availability 20 / primary-source 32 / freshness 24 /
access 12 / independence 12; grades A ≥ 80, B ≥ 65, C ≥ 45, D < 45.

## Connection info

stdio (default, no ports, most clients):

    npx research-scope-mcp

Streamable HTTP (optional, loopback):

    npx research-scope-mcp --http --port 3001   →  http://localhost:3001/mcp

Client config (any stdio-capable client — Claude Code, Cursor, Cline):

    { "mcpServers": { "research-scope": { "command": "npx", "args": ["-y", "research-scope-mcp"] } } }

npm: `research-scope-mcp` (publication in flight — the repo-clone path
`npm ci && npm run build` is the installable pre-publication route).
Outbound network is needed only for `fetch_and_score`; no telemetry, no API keys,
reports written under `RESEARCH_SCOPE_DATA_DIR` (default ./data/reports).

## Notes

- The registry manifest (server.json) validates against the official MCP registry —
  listing there is scheduled with this same version.
- Verify the install in one ask: call `plan_research("verify install")` and expect
  JSON containing `primarySourceTargets` and `killCriteria`.
- Maintenance: issues at the repo; CHANGELOG.md is dated and version-pinned.
```

---

## Post-submission notes (do not paste)

- Filing the issue requires **any** GitHub account (it's a public repo's issue
  tracker) — it does NOT need the AxelVerneBooks session specifically, but the repo
  URL inside must already be live.
- If npm publication lands before their indexing pass, update the issue with one
  comment replacing the "publication in flight" line — directory listings that
  install-and-run on the first try get preserved.
- Order per the runbook: registry publish → Cline issue → Glama add → this mcp.so
  issue (independent, can fire the same day).
- Log the row in `trackC-mcp-kit.md` action #2 with the issue number.
