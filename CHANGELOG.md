# Changelog

All notable changes to `research-scope-mcp`. Each version bump is one immutable
registry publish version (official MCP registry rule: versions are unique per publish;
metadata is immutable, so fix errors by publishing a *new* version).

## [Unreleased]

### Fixed
- **`npx research-scope-mcp` now works**: `package.json` had no `bin` entry, so the
  documented `npx`/global-install commands could not start the server. Added `bin`
  and a node shebang.
- **Every page looked "published today"**: the freshness check read the HTTP `Date`
  response header (the time the response was generated). It is now ignored; the
  date comes from the page's own `article:published_time` / `datePublished` /
  `<time datetime>` declaration, then `Last-Modified`, then the text.
- **`check_report` passed claims citing nonexistent sources**: a claim citing `[S9]`
  in a three-source report counted as cited. Citations are now validated against the
  report's own citation registry and reported as `unknownCitations`.
- **`check_report(report_id)` checked the stale shell**: it read the in-memory
  markdown from `build_report`, ignoring every edit made to the file. It now reads
  the file on disk, and ids keep working after a server restart.
- **Score breakdown didn't add up**: for secondary sources the outbound-citation
  points were added to the score but reported as 0 in the breakdown. Breakdown
  points now always sum to the score.
- `isPrimaryHost` suffix matching was loose (e.g. `CourtListener` entry was never
  matched); rewritten with exact domain/suffix rules.
- `fetch_and_score` returns a clear tool error for unreachable hosts and timeouts,
  refuses non-http(s) URLs, and caps response bodies at 5 MB.
- HTML entities are decoded in a single pass (`&amp;lt;` used to double-decode to
  `<`), and numeric entities such as `&#8212;` are now decoded.
- `build_report` de-duplicates sources listed twice or reached via redirect.

### Security
- The HTTP transport now binds to `127.0.0.1` by default (`--host` /
  `RESEARCH_SCOPE_HOST` to change; the Docker image passes `--host 0.0.0.0`).
  Previously it listened on all interfaces with no authentication.
- Over HTTP, `check_report` only reads report files inside the data directory
  (previously any readable file path could be passed, echoing its lines back).
- Removed the README claim that unauthenticated HTTP requests receive a 401: no
  auth layer exists; deploy behind an authenticating reverse proxy.

### Added
- Automated test suite (61 tests): scorer and report unit tests, in-process tool
  tests against a local fixture web server, and end-to-end stdio/HTTP CLI tests.
  `npm run test:network` adds the live-internet fetch test.
- GitHub Actions CI: lint + typecheck, tests on Node 20/22/24, Docker build with a
  health check.
- ESLint (typescript-eslint) with `npm run lint`; `npm run typecheck`.
- `--help`, `--version`, `--host`; `GET /healthz`; non-`/mcp` paths return 404.
- Tool annotations (`readOnlyHint`, `openWorldHint`, …) on all four tools.
- README: client setup for Claude Desktop, Claude Code and Cursor, example
  session, configuration reference, badges.

### Changed
- Source split into `server.ts` (tools + HTTP handler), `report.ts`, `fetch.ts`
  and a thin `index.ts` CLI entry.

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
