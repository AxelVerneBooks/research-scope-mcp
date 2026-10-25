# Examples

Five end-to-end scripts that drive `research-scope-mcp` the same way Claude Desktop,
Claude Code and Cursor do: spawn the server, speak MCP over stdio (or Streamable
HTTP), call the tools. Each script has its **real, unedited output** checked in
under [`output/`](output/), so you can see what a run returns before installing anything.

| # | Script | What it shows | Network | Output |
|---|---|---|---|---|
| 1 | [`01-verify-install.mjs`](01-verify-install.mjs) | `tools/list`, server instructions, `plan_research("verify install")` smoke test | no | [output](output/01-verify-install.txt) |
| 2 | [`02-score-sources.mjs`](02-score-sources.mjs) | `fetch_and_score` on 4 live pages + 1 dead link, triage against the kill criteria, full per-dimension evidence | yes | [output](output/02-score-sources.txt) |
| 3 | [`03-end-to-end-report.mjs`](03-end-to-end-report.mjs) | the full workflow, plan → score → build → write cited claims → `check_report` **PASS** | yes | [output](output/03-end-to-end-report.txt) |
| 4 | [`04-orphan-claims-fail.mjs`](04-orphan-claims-fail.mjs) | the guardrails: unscored source refused, empty shell FAILs, orphan claim caught, fixed report PASSes | yes | [output](output/04-orphan-claims-fail.txt) |
| 5 | [`05-http-transport.mjs`](05-http-transport.mjs) | Streamable HTTP (`--http`), the transport for Docker and remote configs, with two independent clients | loopback only | [output](output/05-http-transport.txt) |

`_client.mjs` is the shared helper (official `@modelcontextprotocol/sdk` client and a fresh
temp data dir per run, so the repo's `data/` is never touched). `run-all.mjs` runs every
example and rewrites `output/`.

## Run them

```bash
npm ci
npm run examples                         # build, run all five, refresh output/
node examples/03-end-to-end-report.mjs   # or run one directly (after npm run build)
```

`RSM_USE_NPX=1 node examples/01-verify-install.mjs` runs the published npm package
(`npx -y research-scope-mcp`) instead of this checkout. Note the `bin` issue below.

## Use it from your client

Each script's header has the **agent prompt equivalent**: the plain-English request
that makes Claude or Cursor make the same tool calls. Configure the server once, then
paste the prompt.

> **Until a release with the `bin` fix is on npm** (see [Known issues](#what-the-runs-surfaced-known-issues)),
> `npx -y research-scope-mcp` exits with `npm error could not determine executable to run`.
> Use the local-build form for now: `git clone`, then `npm ci && npm run build`, and point
> the client at `node /absolute/path/to/research-scope-mcp/dist/index.js`.

### Claude Desktop

Edit `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`,
Windows: `%APPDATA%\Claude\`), then restart Claude Desktop:

```json
{
  "mcpServers": {
    "research-scope": {
      "command": "node",
      "args": ["/absolute/path/to/research-scope-mcp/dist/index.js"],
      "env": { "RESEARCH_SCOPE_DATA_DIR": "/absolute/path/for/reports" }
    }
  }
}
```

After the fix ships, use `"command": "npx", "args": ["-y", "research-scope-mcp"]` instead.
Set `RESEARCH_SCOPE_DATA_DIR`, because Desktop launches servers from a working
directory you don't choose, and reports go to `<cwd>/data/reports/` by default.

### Claude Code

```bash
# local build (works today)
claude mcp add --transport stdio research-scope -- node /absolute/path/to/research-scope-mcp/dist/index.js
# published package (after the bin fix ships)
claude mcp add --transport stdio research-scope -- npx -y research-scope-mcp
# remote / Docker (example 5)
claude mcp add --transport http research-scope http://localhost:3001/mcp
```

Add `--scope project` to write it to `.mcp.json` for the whole repo. Then `/mcp` should
list `research-scope` with 4 tools. To make the guardrail stick, add a line to `CLAUDE.md`:
*"Never present research findings until research-scope `check_report` returns `pass: true`."*

### Cursor

`.cursor/mcp.json` in the project (or `~/.cursor/mcp.json` globally):

```json
{
  "mcpServers": {
    "research-scope": {
      "command": "node",
      "args": ["/absolute/path/to/research-scope-mcp/dist/index.js"]
    }
  }
}
```

Use agent mode. The same `check_report` rule works as a Cursor project rule.

## How the outputs were captured

- `npm run examples` on 2026-10-25, Node v22.22.0, research-scope-mcp 0.1.2 from this
  checkout. Each file's header records its own timestamp and exit code. Every run exited 0.
- The capture machine was a sandbox with an **egress allowlist**, so the scenarios use
  sources it could reach (nodejs.org, pypi.org, code.claude.com, registry.modelcontextprotocol.io).
  Node's `fetch` reached them through the sandbox proxy (`NODE_USE_ENV_PROXY=1`). On a normal
  machine you need no proxy settings, and you can substitute any URLs.
- Live pages change. Re-running will give different text lengths, dates and possibly scores.
  Temp paths (`/tmp/rsm-example-…`) and report ids differ on every run.
- The claims written in examples 3 and 4 were checked against the fetched pages before the
  run. Example 3 keeps each supporting quote next to its claim. The one unsupported claim
  (example 4, "fastest release line ever…") is deliberately unsupported, which is the point
  of that example.

## What the runs surfaced (known issues)

The outputs are unedited, so they also show where the server is rough today:

1. **`npx -y research-scope-mcp` fails on the published 0.1.2.** The package had no `bin`
   entry. Fixed on this branch (`bin` added, shebang in `src/index.ts`) and verified by
   running `npx` against a packed tarball. It needs a new npm release to reach users. See
   [CHANGELOG](../CHANGELOG.md).
2. **Freshness uses the HTTP `Date` header.** `detectPublishedAt` checks `last-modified`, then
   `date`, and only then the page text. Most servers send `date` (the response time), so the
   Node.js post dated 2024-10-29 shows up as `publishedAt: 2026-10-25, freshnessDays: 0`, and
   every live page gets the full 24/24 freshness points (example 2). Treat freshness scores
   as unreliable until this is fixed.
3. **Self-published release posts aren't detected as primary.** The nodejs.org release post
   is the Node project's own announcement, but `/blog/release/` isn't in the primary-path
   patterns, so it scores `primary=false` (78/B rather than an A).
4. **Empty-shell verdict wording.** `check_report` on a shell with no claims correctly
   returns `pass: false`, but its verdict says "orphan claims above…" while `orphanClaims`
   is `"none"` (example 4b).
5. **HTTP mode binds `0.0.0.0`** (example 5's listen line), not loopback. Keep it behind a
   firewall or auth proxy, as [`clients/llms-install.md`](../clients/llms-install.md) advises.
