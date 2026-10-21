# research-scope-mcp

[![CI](https://github.com/AxelVerneBooks/research-scope-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/AxelVerneBooks/research-scope-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/research-scope-mcp.svg)](https://www.npmjs.com/package/research-scope-mcp)
[![npm downloads](https://img.shields.io/npm/dm/research-scope-mcp.svg)](https://www.npmjs.com/package/research-scope-mcp)
[![Node.js](https://img.shields.io/node/v/research-scope-mcp.svg)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-server-6b4fbb.svg)](https://modelcontextprotocol.io)

**Turn a scattered source set into a decision-ready, traceable report.**

`research-scope-mcp` is a [Model Context Protocol](https://modelcontextprotocol.io)
server that runs a research-to-report workflow any MCP client (Claude Desktop,
Claude Code, Cursor, Cline, …) can drive end to end:

```
plan_research  →  fetch_and_score  →  build_report  →  check_report
   (scope)          (0–100 score)       (shell)          (gate)
```

1. **`plan_research(scope)`** — turns a research scope into a source-target plan with
   **kill criteria** ("fewer than 1 primary + 2 independent secondaries → stop and
   report *insufficient sources*, don't proceed on thin evidence").
2. **`fetch_and_score(source_url)`** — fetches one source and returns an **explainable**
   0–100 quality score: primary-source detection, publication freshness, paywall and
   conflict-of-interest flags — every dimension returned *with the evidence*.
3. **`build_report(topic, sources)`** — assembles a citation-registry report shell
   (claims section + numbered registry + scoring appendix) for the scored sources.
4. **`check_report(report)`** — verifies every substantive claim cites ≥1 source
   from the report's registry. Orphan claims and citations to unknown `[Sn]` ids
   come back as an **error list, not a pass**.

The problem it solves: agent-written reports that *sound* confident but can't show
where any sentence came from. This server makes scoring and citation coverage
mechanically enforced, so the report is auditable by a human in 90 seconds.

> Built by **[Axel Verne](https://axelverne.com)**, author of ***MCP for Business***.
> More servers, guides and the book at **[axelverne.com](https://axelverne.com)**.

---

## Contents

- [Install](#install)
- [Configure your client](#configure-your-client) — [Claude Desktop](#claude-desktop) · [Claude Code](#claude-code) · [Cursor](#cursor) · [Others](#other-clients)
- [Example session](#example-session)
- [Tools](#tools)
- [Scoring rubric](#scoring-rubric)
- [Running over HTTP / Docker](#running-over-http--docker)
- [Configuration reference](#configuration-reference)
- [Development](#development)

## Install

Requires **Node.js 20+**. No API keys, no accounts.

```bash
# run on demand (what the client configs below do)
npx -y research-scope-mcp

# or install globally
npm install -g research-scope-mcp
research-scope-mcp --help
```

From source:

```bash
git clone https://github.com/AxelVerneBooks/research-scope-mcp
cd research-scope-mcp
npm ci && npm run build
node dist/index.js --help
```

## Configure your client

Every client runs the server over **stdio**. Report shells are written to
`./data/reports/` relative to the server's working directory unless you set
[`RESEARCH_SCOPE_DATA_DIR`](#configuration-reference) — setting it to an absolute
path is recommended so you always know where reports land.

### Claude Desktop

Open **Settings → Developer → Edit Config**, or edit the file directly:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "research-scope": {
      "command": "npx",
      "args": ["-y", "research-scope-mcp"],
      "env": {
        "RESEARCH_SCOPE_DATA_DIR": "/Users/you/research-scope"
      }
    }
  }
}
```

Restart Claude Desktop; the four tools appear under the tools (hammer) menu.

### Claude Code

```bash
claude mcp add research-scope -- npx -y research-scope-mcp

# share it with your team via a checked-in .mcp.json
claude mcp add research-scope --scope project -- npx -y research-scope-mcp

# with an explicit data directory
claude mcp add research-scope -e RESEARCH_SCOPE_DATA_DIR="$HOME/research-scope" -- npx -y research-scope-mcp
```

Check it with `claude mcp list` or `/mcp` inside a session.

### Cursor

Add to `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (per project):

```json
{
  "mcpServers": {
    "research-scope": {
      "command": "npx",
      "args": ["-y", "research-scope-mcp"]
    }
  }
}
```

Then enable it under **Cursor Settings → MCP**.

### Other clients

Any MCP client that can launch a stdio server works with `npx -y research-scope-mcp`.
See [`clients/`](clients/) for the Claude Code and Cursor snippets and a Cline-friendly
[`llms-install.md`](clients/llms-install.md). Remote clients can use the
[Streamable HTTP transport](#running-over-http--docker).

## Example session

Ask your assistant something like:

> *"Vendor X says the 2026 certification exam moved to an adaptive format. Use
> research-scope to verify it and write me a cited summary."*

The assistant drives the tools in order:

```text
> plan_research(scope: "verify vendor claim that the 2026 exam moved to adaptive format")
  → primary targets (the vendor's own announcement, the certifying body's page),
    corroborating targets, anti-targets, and kill criteria such as
    "Every scored source below 45/100 -> stop"

> fetch_and_score(source_url: "https://www.federalregister.gov/documents/2026/09/30/example-rule")
```

```json
{
  "url": "https://www.federalregister.gov/documents/2026/09/30/example-rule",
  "score": 90,
  "grade": "A",
  "isPrimarySource": true,
  "publishedAt": "2026-09-30",
  "freshnessDays": 21,
  "flags": [],
  "breakdown": [
    { "dimension": "availability & substance", "points": 16, "max": 20, "notes": "5030 chars extractable text" },
    { "dimension": "primary-source", "points": 26, "max": 32, "notes": "primary host: www.federalregister.gov" },
    { "dimension": "freshness", "points": 24, "max": 24, "notes": "published 2026-09-30 (21d ago)" },
    { "dimension": "access", "points": 12, "max": 12, "notes": "open access" },
    { "dimension": "independence", "points": 12, "max": 12, "notes": "no COI markers detected" }
  ]
}
```

```text
> build_report(topic: "Adaptive exam claim", sources: ["https://www.federalregister.gov/…", "https://vendor.example.com/press/…"])
  → "Report shell 3f9c2a1b saved to /Users/you/research-scope/reports/report-3f9c2a1b.md"
    with a numbered registry: [S1] federalregister.gov … (90/100, A), [S2] vendor press page …

  (the assistant writes findings under "## Claims", each citing [S1]/[S2])

> check_report(report_id: "3f9c2a1b")
```

```json
{
  "report": "3f9c2a1b",
  "pass": false,
  "claimsFound": 3,
  "claimsCited": 2,
  "orphanClaims": [{ "claim": "Most candidates report preferring the new adaptive format over the old one.", "claimId": "C9", "sourceUrls": [] }],
  "unknownCitations": "none",
  "verdict": "FAIL — orphan claims cite no scored source, or cite an [Sn] missing from the citation registry; fill or remove them"
}
```

The assistant must cite or delete the orphan sentence and re-run `check_report`
until it passes. Worked runs with full inputs and outputs live in
[docs/runs/](docs/runs/); [docs/notes/](docs/notes/) covers the common failure
modes (stale registries, timeouts).

## Tools

| Tool | Input | Output |
|---|---|---|
| `plan_research` | `scope`, optional `domain_hints[]` | source-target plan with kill criteria |
| `fetch_and_score` | `source_url` (http/https) | 0–100 score + flags (primary, freshness, paywall, COI), registered for reporting |
| `build_report` | `topic`, `sources[]` (must already be scored) | report shell saved under `<data dir>/reports/`, `[Sn]` citation numbering |
| `check_report` | `report_id` or `report_path` | pass/fail + orphan-claim and unknown-citation lists |

Behavior worth knowing:

- Scores live **in memory** for the life of the server process: restart the
  server and you must re-run `fetch_and_score` before `build_report`.
- `check_report` always reads the report **file on disk**, so your edits are what
  get checked, and report ids keep working after a restart.
- A claim is any non-heading line of 40+ characters above `## Citation registry`
  (bullets, numbered items, quotes and paragraphs; code blocks, `<!-- -->` comments
  and the italic template preamble are ignored).
- `fetch_and_score` times out after 15 s, follows redirects (the score is registered
  under both the requested and the final URL) and reads at most 5 MB of a page.

## Scoring rubric

| Dimension | Max | Notes |
|---|---|---|
| Availability & substance | 20 | extractable text length |
| Primary-source status | 32 | host class (gov/edu/mil, arXiv, DOI, filings) or self-published primary (press/announcement paths); secondary sources earn points for outbound citations |
| Freshness | 24 | ≤30d full marks, decays to 2 at >5y, 0 if undetectable |
| Access | 12 | paywall/registration walls lose marks |
| Independence | 12 | sponsored/affiliate/partnership markers |

`score ≥ 80` → A, `≥ 65` → B, `≥ 45` → C, else D. The current heuristics award at
most 16 and 26 points in the first two dimensions, so the practical ceiling is 90.
Every breakdown entry reports the points actually awarded, so the dimensions always
sum to the score.

The publication date comes from the page's own declaration (`article:published_time`,
`datePublished`, `<time datetime>`), then the `Last-Modified` header, then the first
date in the text. The rubric lives in [src/scoring/score.ts](src/scoring/score.ts) and
returns its evidence, so a score is auditable, not a vibe.

## Running over HTTP / Docker

```bash
npx research-scope-mcp --http --port 3001
# MCP endpoint: http://127.0.0.1:3001/mcp   health check: http://127.0.0.1:3001/healthz
```

The HTTP transport is **stateless** Streamable HTTP and binds to `127.0.0.1` by
default. Pass `--host 0.0.0.0` to expose it on your network. It has **no built-in
authentication** — put it behind a reverse proxy that authenticates before exposing
it beyond your machine. Over HTTP, `check_report` only reads files inside the data
directory.

```bash
docker build -t research-scope-mcp -f docker/Dockerfile .
docker run --rm -p 3001:3001 -v "$PWD/data:/app/data" research-scope-mcp
```

The image listens on `0.0.0.0:3001` inside the container, stores reports in the
`/app/data` volume and ships a `HEALTHCHECK` against `/healthz`.

## Configuration reference

| Flag / variable | Default | Meaning |
|---|---|---|
| `--http` | off (stdio) | serve Streamable HTTP at `/mcp` instead of stdio |
| `--port <n>` / `PORT` | `3001` | HTTP port |
| `--host <addr>` / `RESEARCH_SCOPE_HOST` | `127.0.0.1` | HTTP bind address |
| `RESEARCH_SCOPE_DATA_DIR` | `./data` | where report shells are written |
| `--version`, `--help` | | print version / usage |

## Development

```bash
npm ci
npm run lint          # ESLint (typescript-eslint)
npm run typecheck     # tsc --noEmit
npm test              # build + unit, tool-level and end-to-end tests (offline)
npm run test:network  # also runs the live-internet fetch test
```

The suite runs offline: a local fixture web server stands in for the internet,
tools are exercised in-process through the MCP SDK client, and the built CLI is
driven over real stdio and HTTP. CI runs lint, typecheck and tests on Node 20, 22
and 24, plus a Docker build and health check.

### Demo capture

`npm run demo:capture` (or `node tools/demo-capture.mjs`) replays the scripted
60-second demo flow against the shipped server — spawn `dist/index.js` over
stdio with a fresh temp data dir, `plan_research` → `fetch_and_score` a .gov page
(real fetch) → `build_report`, inject one cited claim plus one deliberately
orphan claim, and confirm `check_report` refuses to bless it — writing each frame
out as a `{t, dir, msg}` JSONL transcript. By default it targets
[docs/marketing/demo-60s/run-capture.jsonl](docs/marketing/demo-60s/run-capture.jsonl)
(the transcript the product-page demo player's footer sha256 is anchored to); it
refuses to overwrite that file without `--force`. Requires network access for the
one real fetch; repo `data/` is never touched.

## Paid kit

This server is the free, tested core of the **Research-to-Report MCP Kit** (field
guide, worked example packs, setup support). Available at the kit store — link in
[CHANGELOG.md](CHANGELOG.md) updates.

## Author

Created and maintained by **Axel Verne**, author of ***MCP for Business*** — a
practical guide to putting Model Context Protocol servers to work.
Books, guides and more MCP servers: **[axelverne.com](https://axelverne.com)**.

Sibling project: [`marketing-scope-mcp`](https://github.com/AxelVerneBooks/marketing-scope-mcp)
applies the same plan → score → build → check discipline to marketing campaigns.

## License

MIT — see [LICENSE](LICENSE). See [SECURITY.md](SECURITY.md) for reporting security issues.
