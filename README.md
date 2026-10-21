# research-scope-mcp

[![CI](https://github.com/AxelVerneBooks/research-scope-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/AxelVerneBooks/research-scope-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/research-scope-mcp.svg)](https://www.npmjs.com/package/research-scope-mcp)
[![npm downloads](https://img.shields.io/npm/dm/research-scope-mcp.svg)](https://www.npmjs.com/package/research-scope-mcp)
[![Node.js](https://img.shields.io/node/v/research-scope-mcp.svg)](package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-server-6E56CF.svg)](https://modelcontextprotocol.io)

**Turn a scattered source set into a decision-ready, traceable report.**

By **[Axel Verne](https://axelverne.com)**, author of the MCP book series.

`research-scope-mcp` is a [Model Context Protocol](https://modelcontextprotocol.io)
server that runs a research-to-report workflow. Any MCP client can drive it from
start to finish:

1. **`plan_research(scope)`** turns a research scope into a source-target plan with
   **kill criteria** ("fewer than 1 primary + 2 independent secondaries → stop and
   report *insufficient sources*, don't proceed on thin evidence").
2. **`fetch_and_score(source_url)`** fetches one source and returns an **explainable**
   0–100 quality score covering primary-source detection, publication freshness,
   paywall flags and conflict-of-interest flags. Every dimension comes back *with
   its evidence*.
3. **`build_report(topic, sources)`** assembles a citation-registry report shell
   (claims section, numbered `[Sn]` registry, scoring appendix) from scored sources.
4. **`check_report(report)`** verifies that every substantive claim cites at least one
   source from the registry. Orphan claims and dangling `[Sn]` ids come back as an
   **error list, not a pass**.

The problem it solves: agent-written reports that *sound* confident but can't show
where any sentence came from. This server enforces source scoring and citation
coverage mechanically, so a human can audit the report in 90 seconds.

## Contents

- [Install](#install)
- [Configure your client](#configure-your-client): [Claude Desktop](#claude-desktop) · [Claude Code](#claude-code) · [Cursor](#cursor) · [Other clients / HTTP](#other-clients-and-streamable-http)
- [Examples](#examples)
- [Tools](#tools)
- [Scoring rubric](#scoring-rubric)
- [Configuration reference](#configuration-reference)
- [Docker](#docker)
- [Development](#development)

## Install

Requires **Node.js 20 or newer**.

You don't need to install anything up front. Every client config below uses `npx`,
which downloads and runs the latest release:

```bash
npx -y research-scope-mcp --version
```

Or install it globally to get a `research-scope-mcp` command:

```bash
npm install -g research-scope-mcp
research-scope-mcp --help
```

From source:

```bash
git clone https://github.com/AxelVerneBooks/research-scope-mcp
cd research-scope-mcp
npm ci && npm run build
node dist/index.js --version
```

## Configure your client

The server talks MCP over **stdio** by default, which all of the clients below use.
Set `RESEARCH_SCOPE_DATA_DIR` to choose where report shells are saved. If you don't,
they go to `./data` relative to the directory the client launches the server from.

### Claude Desktop

Open **Settings → Developer → Edit Config**, or edit the file directly
(template: [clients/claude-desktop.json](clients/claude-desktop.json)):

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "research-scope": {
      "command": "npx",
      "args": ["-y", "research-scope-mcp"],
      "env": {
        "RESEARCH_SCOPE_DATA_DIR": "/Users/you/Documents/research-reports"
      }
    }
  }
}
```

Restart Claude Desktop. The four tools appear under the tools (🔨) menu. Claude
Desktop may launch servers from a directory you can't write to, so keep
`RESEARCH_SCOPE_DATA_DIR` set to an absolute path.

### Claude Code

One command:

```bash
claude mcp add research-scope -- npx -y research-scope-mcp
```

To share it with your team, scope it to the project. This writes `.mcp.json` at the
repo root:

```bash
claude mcp add --scope project research-scope \
  -e RESEARCH_SCOPE_DATA_DIR=./research \
  -- npx -y research-scope-mcp
```

Or write `.mcp.json` by hand (see [clients/claude-code.json](clients/claude-code.json)):

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

Check it with `claude mcp list`, or with `/mcp` inside a session.

### Cursor

Add this to `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project).
It's also in [clients/cursor.json](clients/cursor.json):

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

Then enable **research-scope** under **Settings → MCP**.

### Other clients and Streamable HTTP

Any stdio-capable client (Cline, Windsurf, Zed, Continue, …) takes the same
`command` + `args` pair. [clients/llms-install.md](clients/llms-install.md) has
step-by-step instructions written for agents that install servers themselves.

For remote or containerized setups, run the Streamable HTTP transport:

```bash
npx -y research-scope-mcp --http --port 3001
# research-scope-mcp 0.1.2 listening (Streamable HTTP) on http://127.0.0.1:3001/mcp
```

Then point the client at the endpoint:

```bash
claude mcp add --transport http research-scope http://127.0.0.1:3001/mcp
```

```json
{ "mcpServers": { "research-scope": { "url": "http://127.0.0.1:3001/mcp" } } }
```

> **Security:** the HTTP transport has **no authentication**. It binds to `127.0.0.1`
> by default. Only pass `--host 0.0.0.0` inside a container, or behind a reverse proxy
> that authenticates requests. See [SECURITY.md](SECURITY.md).

## Examples

### Prompts to try

Ask your agent things like:

> Use research-scope to check whether the claim "NHTSA now requires automatic
> emergency braking on all new cars" holds up. Plan the research, score at least
> three sources, build a report, and don't show me anything until `check_report` passes.

> Score these sources and tell me which ones are too weak to cite:
> https://www.nhtsa.gov/… https://some-blog.example/…

> I edited report `3f9c2a1b`. Run `check_report` on it again.

### What a run looks like

**1. `plan_research`**

```json
{ "scope": "verify vendor claim about 90-day data retention", "domain_hints": ["ftc.gov"] }
```

```json
{
  "scope": "verify vendor claim about 90-day data retention",
  "domainHints": ["ftc.gov"],
  "primarySourceTargets": [
    { "what": "The original claim-maker's own statement (press release, changelog, official filing)", "why": "…" },
    { "what": "Any regulator / standards body page covering the domain (ftc.gov)", "why": "…" }
  ],
  "corroboratingTargets": ["…"],
  "antiTargets": ["sponsored posts, affiliate round-ups, pages with 'in partnership with'", "undated aggregator rewrites"],
  "killCriteria": [
    "Fewer than 1 primary + 2 independent secondaries found after checking all target hosts -> stop, report 'insufficient sources' …",
    "Every scored source below 45/100 -> stop",
    "Primary source is paywalled AND no archived copy is retrievable -> mark claim unverifiable"
  ]
}
```

**2. `fetch_and_score`**: the score is the sum of the breakdown, so nothing is hidden

```json
{
  "url": "https://www.ftc.gov/news-events/news/press-releases/…",
  "score": 90,
  "grade": "A",
  "isPrimarySource": true,
  "publishedAt": "2026-10-09",
  "freshnessDays": 12,
  "flags": [],
  "breakdown": [
    { "dimension": "availability & substance", "points": 16, "max": 20, "notes": "5210 chars extractable text" },
    { "dimension": "primary-source", "points": 26, "max": 32, "verdict": "primary", "notes": "primary host: www.ftc.gov" },
    { "dimension": "freshness", "points": 24, "max": 24, "notes": "published 2026-10-09 (12d ago)" },
    { "dimension": "access", "points": 12, "max": 12, "notes": "open access" },
    { "dimension": "independence", "points": 12, "max": 12, "notes": "no COI markers detected" }
  ]
}
```

**3. `build_report`** saves `data/reports/report-<id>.md`:

```markdown
# Research report — Vendor data-retention claim

## Claims

<!-- Write findings here as bullets or short paragraphs, citing sources as [S1], [S2], ... -->

## Citation registry

[S1] https://www.ftc.gov/news-events/news/press-releases/… — score 90/100 (A, published 2026-10-09)
[S2] https://review-site.example/retention-comparison — score 52/100 (C, no date)

## Scoring appendix
…
```

**4. Write claims, then `check_report`**

```markdown
- The regulator's order sets a 90-day ceiling, not a floor [S1].
- Retention varies far more between plans than the vendor's marketing concedes.
- The comparison site measured six plans in September [S3].
```

```json
{
  "report": "3f9c2a1b",
  "pass": false,
  "claimsFound": 3,
  "claimsCited": 1,
  "registrySources": 2,
  "orphanClaims": [
    { "claim": "Retention varies far more between plans than the vendor's marketing concedes.", "claimId": "C12", "sourceUrls": [] },
    { "claim": "The comparison site measured six plans in September.", "claimId": "C13", "sourceUrls": ["S3"] }
  ],
  "unknownCitations": [{ "claimId": "C13", "citations": ["S3"] }],
  "verdict": "FAIL — 2 orphan claim(s) cite no scored source; 1 claim(s) cite ids missing from the citation registry; fill, fix or remove them"
}
```

`claimId` is `C<line number>`, so you can jump straight to the line. Fix the claims,
re-run `check_report`, and present the report only once it says `PASS`.

[docs/runs/](docs/runs/) has two complete worked runs.
[docs/notes/](docs/notes/) covers the most common failure (sources going stale
between scoring and publishing) and what to do about timeouts.

## Tools

| Tool | Input | Output |
|---|---|---|
| `plan_research` | `scope`, optional `domain_hints[]` | source-target plan with kill criteria |
| `fetch_and_score` | `source_url` (http/https) | 0–100 score + flags (primary, freshness, paywall, COI), registered for reporting |
| `build_report` | `topic`, `sources[]` (must already be scored) | report shell saved under `$RESEARCH_SCOPE_DATA_DIR/reports/`, `[Sn]` citation numbering |
| `check_report` | `report_id` or `report_path` | pass/fail + orphan-claim and unknown-citation lists |

Notes:

- `fetch_and_score` follows redirects and registers the score under both the
  requested URL and the final one. Non-2xx responses score `0/D` with `http-<status>`
  and `dead-link` flags. Network errors and timeouts (15 s) come back as tool errors,
  and nothing is registered. Bodies are capped at 5 MB, and a capped body gets a
  `truncated` flag.
- Scores live in memory for the life of the server process. Report shells are files,
  so `check_report` with a `report_id` reads the **saved file**, which includes your
  edits. It also works after a restart.
- `check_report` counts any non-heading line of 40 or more characters as a claim,
  outside the citation registry and scoring appendix. It skips HTML comments, code
  fences and the italic `_…_` preamble. Citations can be written `[S1]`, `[S1][S2]`
  or `[S1, S2]`.

## Scoring rubric

| Dimension | Points | How |
|---|---|---|
| Availability & substance | 4 / 8 / 12 / 16 of 20 | extractable text: <300 / ≥300 / ≥800 / ≥3000 chars |
| Primary-source status | 26 of 32 for primaries; 0–14 for secondaries | primary host (`.gov`, `.mil`, `.edu`, `.ac.uk`, `.gov.uk`, arxiv.org, doi.org, courtlistener.com, …) or a self-published release path (`/press/`, `/releases/`, `changelog`, …). Secondaries earn 4 / 8 / 14 for 1 / 2+ / 5+ outbound citations |
| Freshness | 24 of 24 | ≤30 d: 24, ≤180 d: 18, ≤2 y: 12, ≤5 y: 6, older: 2, undetectable: 0 |
| Access | 3 or 12 of 12 | paywall/registration phrases lose marks |
| Independence | 4 or 12 of 12 | sponsored, affiliate and partnership markers lose marks |

`score ≥ 80` → A, `≥ 65` → B, `≥ 45` → C, else D.

The publication date comes from, in order: page metadata (`article:published_time`,
`citation_publication_date`, JSON-LD `datePublished`, `<time datetime>`), a labelled
date in the text ("Published Oct 5, 2026"), the `Last-Modified` header, and finally
any date near the top of the page. The HTTP `Date` header is never used, because it
records when the response was sent, not when the page was published.

The rubric lives in [src/scoring/score.ts](src/scoring/score.ts) and returns its
evidence, so you can audit any score.

## Configuration reference

| Setting | Default | Purpose |
|---|---|---|
| `RESEARCH_SCOPE_DATA_DIR` | `./data` | where report shells are written (`<dir>/reports/report-<id>.md`) |
| `--http` | off (stdio) | serve Streamable HTTP at `/mcp` (plus `GET /healthz`) |
| `--port <n>` / `PORT` | `3001` | HTTP port (`0` picks a free port) |
| `--host <addr>` / `HOST` | `127.0.0.1` | HTTP bind address |
| `--help`, `--version` | | |

## Docker

```bash
docker build -t research-scope-mcp -f docker/Dockerfile .
docker run --rm -p 3001:3001 -v "$PWD/data:/app/data" research-scope-mcp
# → http://localhost:3001/mcp   (health: http://localhost:3001/healthz)
```

The image runs as the unprivileged `node` user, serves HTTP on `0.0.0.0:3001` inside
the container, and has a `HEALTHCHECK` on `/healthz`.

## Development

```bash
npm ci
npm run lint        # ESLint + tsc --noEmit
npm test            # builds, then runs the full suite (no network needed)
npm run test:live   # optional: one real fetch against a live .gov page
```

The suite runs on Node's built-in test runner. It covers the scorer, the HTML/fetch
layer, report parsing and checking, CLI parsing, every tool through a real MCP
client, and the built CLI over both stdio and Streamable HTTP. Sources are served by
a local fixture server, so the tests are deterministic and work offline.
[CI](.github/workflows/ci.yml) runs lint, the tests on Node 20/22/24 (plus macOS and
Windows), an `npm pack` install smoke test and a Docker build.

`npm run demo:capture` replays the scripted 60-second demo against the built server
and writes a JSONL transcript. It refuses to overwrite the published capture without
`--force`. See [tools/demo-capture.mjs](tools/demo-capture.mjs).

## About the author

Built by **Axel Verne**, author of the MCP book series. Books, guides and more MCP
servers are at **[axelverne.com](https://axelverne.com)**.

This server is the free, tested core of the **Research-to-Report MCP Kit** (field
guide, worked example packs, setup support), available from
[axelverne.com](https://axelverne.com).

## License

[MIT](LICENSE). To report a vulnerability, see [SECURITY.md](SECURITY.md).
