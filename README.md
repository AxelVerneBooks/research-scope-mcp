# research-scope-mcp

**Turn a scattered source set into a decision-ready, traceable report.**

`research-scope-mcp` is an MCP server that runs a research-to-report workflow any
MCP client can drive end to end:

1. **`plan_research(scope)`** — turns a research scope into a source-target plan with
   **kill criteria** ("fewer than 1 primary + 2 independent secondaries → stop and
   report *insufficient sources*, don't proceed on thin evidence").
2. **`fetch_and_score(source_url)`** — crawls one source and returns an **explainable**
   0–100 quality score: primary-source detection, publication freshness, paywall and
   conflict-of-interest flags — every dimension returned *with the evidence*.
3. **`build_report(topic, sources)`** — assembles a citation-registry report shell
   (claims section + numbered registry + scoring appendix) for the scored sources.
4. **`check_report(report)`** — verifies every substantive claim cites ≥1 scored
   source. Orphan claims come back as an **error list, not a pass**.

The problem it solves: agent-written reports that *sound* confident but can't show
where any sentence came from. This server makes scoring and citation coverage
mechanically enforced, so the report is auditable by a human in 90 seconds.

## Install

```bash
npm install -g research-scope-mcp   # once published; local: npm ci && npm run build
```

Run over stdio (most clients):

```bash
npx research-scope-mcp
```

Or over Streamable HTTP (remote deployments):

```bash
npx research-scope-mcp --http --port 3001
# unauthenticated requests get 401 + WWW-Authenticate discovery, never a bare 403
```

## Client config

Drop-in config snippets for [Claude Code](clients/claude-code.json),
[Cursor](clients/cursor.json), and a Cline-friendly
[`llms-install.md`](clients/llms-install.md).

## Docker

```bash
docker build -t research-scope-mcp -f docker/Dockerfile .
docker run --rm -i -p 3001:3001 research-scope-mcp --http --port 3001
```

## Tools

| Tool | Input | Output |
|---|---|---|
| `plan_research` | `scope`, optional `domain_hints` | source-target plan with kill criteria |
| `fetch_and_score` | `source_url` | 0–100 score + flags (primary, freshness, paywall, COI), registered for reporting |
| `build_report` | `topic`, `sources[]` (must already be scored) | report shell saved under `data/reports/`, `[Sn]` citation numbering |
| `check_report` | `report_id` or `report_path` | pass/fail + orphan-claim error list |

## Input Validation

Every tool's parameters are validated with [Zod](https://zod.dev) before the tool
runs. The schemas live in [src/validation.ts](src/validation.ts) and are the same
ones advertised to clients as JSON Schema in `tools/list`, so what a client sees is
what the server enforces.

A rejected call never reaches the handler and never throws a protocol error: it
comes back as a normal tool result with `isError: true` and text like

```text
Input validation error: Invalid arguments for tool build_report: each sources entry "www.nhtsa.gov" is not a valid absolute URL — include the scheme and host, e.g. "https://www.nhtsa.gov/" at sources.0
```

Each message names the field (with its array index, e.g. `sources.1`), says what
was wrong, and says what to send instead. All problems in a call are reported
together, one per line. String inputs are trimmed before checks.

| Tool | Parameter | Rule |
|---|---|---|
| `plan_research` | `scope` | required string, 3–500 chars |
| | `domain_hints` | optional array of ≤20 non-empty strings, each ≤100 chars |
| `fetch_and_score` | `source_url` | required absolute `http`/`https` URL, ≤2048 chars (`file:`, `javascript:`, relative URLs refused) |
| `build_report` | `topic` | required string, 3–200 chars |
| | `sources` | required array of 1–50 unique `http`/`https` URLs (each must also have been scored, checked at run time) |
| `check_report` | `report_id` | optional, the 8-char lowercase hex id printed by `build_report` |
| | `report_path` | optional path ending in `.md` / `.markdown` |
| | *(either)* | at least one of `report_id` / `report_path` is required |

Unknown extra properties are ignored rather than rejected, for compatibility with
clients that add metadata. The same checks are available outside the server via
`validateToolInput(toolName, args)`, which returns `{ ok: true, data }` or
`{ ok: false, message }` with identical message text. Unit tests covering valid and
invalid inputs for every tool are in
[test/validation.test.mjs](test/validation.test.mjs) (`npm run test:unit`, no
network needed).

## Example walkthrough

See [docs/runs/](docs/runs/) for two worked runs with inputs and outputs, and
[docs/notes/](docs/notes/) for what to do when something times out or 401s.

## Demo capture

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

## Scoring rubric

| Dimension | Max | Notes |
|---|---|---|
| Availability & substance | 20 | extractable text length |
| Primary-source status | 32 | host class (gov/edu/filings) or self-published primary (press/announcement paths) |
| Freshness | 24 | ≤30d full marks, decays to 2 at >5y, 0 if undetectable |
| Access | 12 | paywall/registration walls lose marks |
| Independence | 12 | sponsored/affiliate/partnership markers |

`score ≥ 80` → A, `≥ 65` → B, `≥ 45` → C, else D. The rubric is inside
[src/scoring/score.ts](src/scoring/score.ts) and returns its evidence, so a score is
auditable, not a vibe.

## Author

Built by Axel Verne, author of the MCP book series — [axelverne.com](https://axelverne.com).

## License

MIT. See [SECURITY.md](SECURITY.md) for reporting security issues.

## Paid kit

This server is the free, tested core of the **Research-to-Report MCP Kit** (field
guide, worked example packs, setup support). Available at the kit store — link in
[CHANGELOG.md](CHANGELOG.md) updates.
