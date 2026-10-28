# Changelog

All notable changes to `research-scope-mcp`. Each version bump is one immutable
registry publish version (official MCP registry rule: versions are unique per publish;
metadata is immutable, so fix errors by publishing a *new* version).

## [Unreleased]

### Added
- Structured JSON-lines logging on stderr (`src/log.ts`), level set by
  `RESEARCH_SCOPE_LOG_LEVEL`. Logs server start (version, transport, data dir),
  every tool call's outcome and duration, each fetch, report build/check, and
  HTTP failures.
- `TROUBLESHOOTING.md`, covering issues found in a code and test review.
- GitHub bug-report issue form (`.github/ISSUE_TEMPLATE/bug_report.yml`).

### Changed
- Tool errors now say what failed and what to do, with a TROUBLESHOOTING.md link:
  - `fetch_and_score` returns a tool error naming the cause (DNS, connection,
    TLS, 15s timeout) instead of a bare `fetch failed` protocol error.
  - `build_report` suggests the scored URL when a source differs only by trailing
    slash or host case, and says when no sources are scored in this process.
  - `build_report` reports an unwritable data dir with a `RESEARCH_SCOPE_DATA_DIR` hint.
  - `check_report` distinguishes an unknown `report_id` from a missing argument,
    explains relative `report_path` resolution, gives a specific verdict when no
    claims are found, and adds a `note` when checking by `report_id` (the
    in-memory shell, not the edited file).
- HTTP transport: an invalid `--port`/`PORT` exits with an error instead of
  silently using 3001; `EADDRINUSE`/`EACCES` on listen are logged with a fix;
  internal errors use JSON-RPC code `-32603` (was `-32700`, parse error).
- README no longer claims the HTTP transport answers with 401 + `WWW-Authenticate`;
  it has no auth layer (as SECURITY.md already said).
- Fetch user-agent reports the real package version.

### Tests
- New: structured-log format, actionable fetch error, and an offline workflow
  against a local HTTP fixture (near-miss URL hint, unknown `report_id`,
  empty-shell verdict, passing edited report).
- The live-fetch test now fails with the network error instead of a JSON parse error.

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
