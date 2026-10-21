# Changelog

All notable changes to `research-scope-mcp`. Each version bump is one immutable
registry publish version (official MCP registry rule: versions are unique per publish;
metadata is immutable, so fix errors by publishing a *new* version).

## [Unreleased]

### Fixed
- **`npx research-scope-mcp` did not work.** The published package had no `bin`
  entry and `dist/index.js` had no shebang, so `npx` (the install path in every
  client config) couldn't find an executable. Added both, and CI now installs the
  packed tarball and runs it.
- **Every page scored as published today.** `detectPublishedAt` trusted the HTTP
  `Date` response header, which is the time the response was sent. Every reachable
  page got full freshness marks. The header is now ignored. Dates come from page
  metadata (`article:published_time`, `citation_publication_date`, JSON-LD
  `datePublished`, `<time datetime>`, read before the HTML is flattened), then
  labelled text dates, then `Last-Modified`, then loose text dates. Future dates
  are rejected.
- **`check_report` passed citations to sources that don't exist.** `[S99]` counted
  as a citation even with two sources in the registry. Citations now have to resolve
  to a `[Sn]` entry in the report's citation registry, and dangling ids are listed
  under `unknownCitations`.
- **`check_report` by `report_id` ignored your edits.** It checked the in-memory
  copy of the untouched shell, so a filled-in report always failed with "no claims".
  It now reads the saved file, which also works after a server restart. Invalid ids
  are rejected (no path traversal).
- `check_report` no longer ignores claims in sections after the scoring appendix,
  and skips multi-line HTML comments and code fences. It also accepts `[S1, S2]` and
  numbered list items. `claimId` is now the 1-based line number. A report with no
  claims gets a "no claims found" verdict instead of an orphan-claims message.
- The score breakdown didn't add up. Citation points for secondary sources were in
  the total but shown as 0 in the breakdown. The score is now computed as the sum of
  the breakdown.
- Primary-host matching wasn't label-aware: `cardiac.uk` matched `.ac.uk`, and the
  CourtListener entry could never match. Self-published path hints now match the
  URL path only, not the query string.
- A bare "paywall" substring flagged every article that *mentions* paywalls. Paywall
  detection now uses phrases only.
- `fetch_and_score` rejects non-http(s) URLs (`file:`, `data:`). Network failures
  and timeouts come back as clear tool errors. Bodies are capped at 5 MB (with a
  `truncated` flag), HTML entities are decoded, and any 2xx response is scored.
- `build_report` de-duplicates a URL and its redirect target, and keeps a multi-line
  topic on the title line.
- `zod` dependency raised to `^3.25` to match what the MCP SDK requires.
- Client config snippets in `clients/` are now valid JSON (they had `//` comments).

### Changed
- HTTP transport binds to `127.0.0.1` by default (`--host` / `HOST` to change; the
  Docker image passes `--host 0.0.0.0`). It serves `/mcp` and `GET /healthz`, and
  returns 404 for any other path. The README no longer claims 401/OAuth discovery,
  which was never implemented.
- New CLI flags: `--host`, `--help`, `--version`. Invalid arguments exit with code 2.
- Docker image runs as the `node` user and has a `HEALTHCHECK`.
- Source split into `cli.ts`, `fetch.ts`, `report.ts`, `server.ts` and
  `scoring/score.ts`, so each part can be tested.

### Added
- Test suite (88 tests, offline, using a local fixture server): scorer, fetch layer,
  report parsing and checking, CLI parsing, every tool through a real MCP client,
  and the built CLI over stdio and Streamable HTTP. `npm run test:live` keeps an
  optional real-network smoke test.
- GitHub Actions CI: ESLint + typecheck, tests on Node 20/22/24 (plus macOS and
  Windows), an `npm pack` install smoke test, and a Docker build with a health check.
- ESLint (flat config, typescript-eslint). README rewritten with badges and setup
  for Claude Desktop, Claude Code and Cursor, worked examples, and a configuration
  reference. Added `clients/claude-desktop.json`.

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
