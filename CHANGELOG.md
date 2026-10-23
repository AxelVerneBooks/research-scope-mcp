# Changelog

All notable changes to `research-scope-mcp`. Each version bump is one immutable
registry publish version (official MCP registry rule: versions are unique per publish;
metadata is immutable, so fix errors by publishing a *new* version).

## [0.1.3] — 2026-10-23

### Fixed
- **`npx research-scope-mcp` now actually starts the server.** 0.1.2 shipped with
  no `bin` entry and no shebang, so npx/global installs had no executable.
  `package.json` now declares `bin`, and `dist/index.js` starts with
  `#!/usr/bin/env node`.

### Added
- `server.json`: `packages[]` npm entry (stdio, `npx`) so the official MCP Registry
  lists a one-command install; `package.json` gains the matching `mcpName`.
- `smithery.yaml` (container runtime, Streamable HTTP) for Smithery deployments.
- README "Publishing" section with the exact maintainer commands.

### Changed
- Dockerfile moved from `docker/Dockerfile` to the repo root (Smithery/Glama
  default), with a `.dockerignore`. The HTTP server now listens on `$PORT`
  (default 3001) instead of a hard-coded `--port 3001`, runs as the `node` user,
  carries the `io.modelcontextprotocol.server.name` label, and accepts `--stdio`.

### Pending
- npm 0.1.3, MCP Registry 0.1.3 and Smithery deploys will be published by the
  maintainer per README "Publishing"; none of them have been published yet.

## [0.1.2] — 2026-10-17

### Fixed
- **check_report no longer orphans the report shell's own template boilerplate.**
  The italic `_*_` instruction preamble and the `<!-- … -->` example comments were
  being counted as orphan claims in every fresh shell (surplus `orphanClaims` noise
  alongside real findings). `extractClaims` now skips both.

### Added
- `npm run demo:capture` (`tools/demo-capture.mjs`): reproducible stdio capture of
  the scripted 60-second demo run into
  `docs/marketing/demo-60s/run-capture.jsonl` (refuses to overwrite the
  published-capture transcript without `--force`); see README “Demo capture”.

### npm publication [confirmed 2026-10-17]
- npm: [`research-scope-mcp`](https://www.npmjs.com/package/research-scope-mcp)
  **v0.1.2 published and live** (`dist-tags.latest: 0.1.2`, verified against the
  registry API minutes after `npm publish` exited 0 — tarball sha512
  `LJv0PL9tMTyBF…`, 10 files / 18.0 kB). Install paths now:
  `npm install -g research-scope-mcp` or `npx -y research-scope-mcp`. The
  earlier ENEEDAUTH block is closed; the repo-clone route remains valid for
  source builds.

## [0.1.1] — 2026-10-15

### Fixed
- **Streamable HTTP: every request after `initialize` returned a silent 500**
  (empty body). Root cause: a single shared stateless transport (`sessionIdGenerator:
  undefined`) was created at startup and reused for all requests, but the SDK
  requires a fresh server + transport pair **per request** in stateless mode
  ("Stateless transport cannot be reused across requests"). `runHttp` now builds
  both per request and closes them on response end — the SDK's official stateless
  example pattern. Verified: sessionless `initialize` → `tools/call plan_research`
  returns 200 with a full plan.

### Added
- Regression test `stateless HTTP transport: second request works with no session`
  in `test/server.test.mjs` — sends sessionless `initialize`, then `tools/list`,
  then a real `tools/call` and asserts non-500 with full payloads.

## [0.1.0] — 2026-10-15

### Added
- `plan_research(scope)` — source-target plan with kill criteria.
- `fetch_and_score(source_url)` — explainable source-quality scoring
  (primary-source detection, freshness, paywall + COI flags; HTTP status gate).
- `build_report(topic, sources)` — citation-registry report shell saved under
  `data/reports/`; unscored sources are rejected with an error naming them.
- `check_report(report_id | report_path)` — every substantive claim must cite ≥1
  scored source; orphan claims return an error list, never a pass.
- Dual transport: stdio (default) + Streamable HTTP (`--http --port N`).
- Docker build ([docker/Dockerfile](docker/Dockerfile)) for Glamal/Docker-Catalog
  reproducible-build scans.
- Client configs: Claude Code, Cursor, Cline (`clients/llms-install.md`).

### Notes
- Scoring rubric v1 weights (availability 20 / primary 32 / freshness 24 / access 12 /
  independence 12) documented in README and returned with evidence per dimension.
