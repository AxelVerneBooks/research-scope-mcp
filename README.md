# research-scope-mcp

**Turn a scattered source set into a decision-ready, traceable report.**

By [Axel Verne](https://axelverne.com), author of the MCP book series.

## Quickstart

1. **Build it** (Node ≥ 20):
   ```bash
   git clone https://github.com/AxelVerneBooks/research-scope-mcp
   cd research-scope-mcp && npm ci && npm run build
   ```
2. **Add it to your client.** For Claude Code:
   ```bash
   claude mcp add --transport stdio research-scope -- node "$PWD/dist/index.js"
   ```
   For Claude Desktop and Cursor JSON configs, see
   [examples/README.md → Use it from your client](examples/README.md#use-it-from-your-client).
3. **Check it works.** `node examples/01-verify-install.mjs`, or ask your agent:
   *"Call plan_research with scope 'verify install' and show me the kill criteria."*
4. **Run a real research task.** Follow the end-to-end examples. Each one has the script,
   the prompt to give your agent, and the real output from an actual run:

   | Example | Shows | Real output |
   |---|---|---|
   | [01 verify install](examples/01-verify-install.mjs) | tool list + smoke test | [output](examples/output/01-verify-install.txt) |
   | [02 score sources](examples/02-score-sources.mjs) | scoring 5 URLs, triage, evidence | [output](examples/output/02-score-sources.txt) |
   | [03 end-to-end report](examples/03-end-to-end-report.mjs) | plan → score → build → cite → **PASS** | [output](examples/output/03-end-to-end-report.txt) |
   | [04 orphan claims fail](examples/04-orphan-claims-fail.mjs) | what the guardrails refuse, and the fix | [output](examples/output/04-orphan-claims-fail.txt) |
   | [05 HTTP transport](examples/05-http-transport.mjs) | Streamable HTTP for Docker/remote | [output](examples/output/05-http-transport.txt) |

   `npm run examples` re-runs all five and refreshes the outputs. Changes are in the
   [CHANGELOG](CHANGELOG.md).

> `npx -y research-scope-mcp` needs the `bin` fix in the next npm release. The published
> 0.1.2 can't be launched with `npx` (see [CHANGELOG](CHANGELOG.md)). Use the local build above
> until then.

## What it does

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

## Example walkthrough

For runnable scripts with real captured output, see [examples/](examples/). See
[docs/runs/](docs/runs/) for two anonymized narrative walkthroughs, and
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

## License

MIT. See [SECURITY.md](SECURITY.md) for reporting security issues.

## Paid kit

This server is the free, tested core of the **Research-to-Report MCP Kit** (field
guide, worked example packs, setup support). Available at the kit store — link in
[CHANGELOG.md](CHANGELOG.md) updates.
