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

One command, no clone (Node.js ≥ 20):

```bash
npx -y research-scope-mcp
```

That runs the server over stdio (most clients). A global install works too:
`npm install -g research-scope-mcp && research-scope-mcp`. From source:
`npm ci && npm run build && node dist/index.js`.

Or over Streamable HTTP (remote deployments):

```bash
npx -y research-scope-mcp --http --port 3001
# unauthenticated requests get 401 + WWW-Authenticate discovery, never a bare 403
```

## Client config

Drop-in config snippets for [Claude Code](clients/claude-code.json),
[Cursor](clients/cursor.json), and a Cline-friendly
[`llms-install.md`](clients/llms-install.md).

## Docker

```bash
docker build -t research-scope-mcp .
docker run --rm -p 3001:3001 research-scope-mcp          # Streamable HTTP on $PORT (default 3001)
docker run --rm -i research-scope-mcp --stdio            # stdio
```

Reports are written to `/app/data` (a volume) inside the container.

Also listed via [`server.json`](server.json) (official MCP Registry) and
[`smithery.yaml`](smithery.yaml) (Smithery, built from the root `Dockerfile`).

## Tools

| Tool | Input | Output |
|---|---|---|
| `plan_research` | `scope`, optional `domain_hints` | source-target plan with kill criteria |
| `fetch_and_score` | `source_url` | 0–100 score + flags (primary, freshness, paywall, COI), registered for reporting |
| `build_report` | `topic`, `sources[]` (must already be scored) | report shell saved under `data/reports/`, `[Sn]` citation numbering |
| `check_report` | `report_id` or `report_path` | pass/fail + orphan-claim error list |

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

## Publishing

Maintainer-only. Nothing in this repo publishes automatically. Every release needs
a **new** version (registry and npm versions are immutable), bumped together in
`package.json`, `src/version.ts`, and `server.json` (both the top-level `version`
and `packages[0].version`), with a `CHANGELOG.md` entry. Full runbook:
[PUBLISH.md](PUBLISH.md) and
[docs/publication/release-checklist-version-bump.md](docs/publication/release-checklist-version-bump.md).

**1. Verify locally**

```bash
npm ci
npm test                       # build + integration test (needs network)
npm pack --dry-run             # expect dist/, README.md, LICENSE, server.json, package.json
npx -y ./$(npm pack --silent)  # the packed tarball must start over stdio; Ctrl-C to quit
docker build -t research-scope-mcp .
```

**2. npm** (must come first: the registry checks that the npm package exists and
that its `mcpName` matches `server.json`'s `name`)

```bash
npm login                      # or: bash tools/npm-publish-from-token.sh /path/to/token-file
npm publish --access public    # prepublishOnly runs the build
npm view research-scope-mcp version bin mcpName
```

**3. Official MCP Registry**

```bash
# install the publisher CLI once (macOS/Linux)
curl -L "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz" | tar xz mcp-publisher
./mcp-publisher validate
./mcp-publisher login github   # must be the AxelVerneBooks account (namespace is case-sensitive)
./mcp-publisher publish
curl "https://registry.modelcontextprotocol.io/v0/servers?search=io.github.AxelVerneBooks/research-scope-mcp"
```

**4. Smithery**

Push the release commit to `main` on GitHub, then at
<https://smithery.ai/new> connect the `AxelVerneBooks/research-scope-mcp` repo (or,
if already connected, open the server's **Deployments** tab and click **Deploy**).
Smithery reads [`smithery.yaml`](smithery.yaml), builds the root `Dockerfile`, and
serves it over Streamable HTTP.

**5. Tag the release**

```bash
git tag v$(node -p "require('./package.json').version")
git push origin --tags
```

## License

MIT. See [SECURITY.md](SECURITY.md) for reporting security issues.

## Paid kit

This server is the free, tested core of the **Research-to-Report MCP Kit** (field
guide, worked example packs, setup support). Available at the kit store — link in
[CHANGELOG.md](CHANGELOG.md) updates.
