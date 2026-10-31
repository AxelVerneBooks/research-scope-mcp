# Changelog

All notable changes to `research-scope-mcp` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Each version bump is one immutable registry publish version (official MCP registry
rule: versions are unique per publish; metadata is immutable, so fix errors by
publishing a *new* version). Every pull request must add an entry under
[Unreleased] — CI fails otherwise (see [CONTRIBUTING.md](CONTRIBUTING.md)).

## [Unreleased]

### Added
- `CONTRIBUTING.md` with code style, test requirements, and a PR checklist.
- CI check (`.github/workflows/changelog.yml`) that fails a pull request when
  `CHANGELOG.md` is not updated; apply the `skip-changelog` label to opt out.
- Author attribution (Axel Verne, author of the MCP book series —
  [axelverne.com](https://axelverne.com)) in README and CONTRIBUTING.
- 600px listing thumbnails and PNG payload carriers for marketplace upload under
  `docs/marketing/`.

### Changed
- This changelog now follows Keep a Changelog: `[Unreleased]` section, ISO dates,
  standard section headings, and version comparison links; entries backfilled
  from git history.

### Fixed
- Payload carrier PNGs now use bit depth 8 / colour type 6 (RGBA) instead of
  grayscale, with a round-trip-tested decoder.

## [0.1.2] - 2026-10-17

### Added
- `npm run demo:capture` (`tools/demo-capture.mjs`): reproducible stdio capture of
  the scripted 60-second demo run into
  `docs/marketing/demo-60s/run-capture.jsonl` (refuses to overwrite the
  published-capture transcript without `--force`); see README “Demo capture”.
- 60-second honest-failure demo assets (`docs/marketing/demo-60s/`): planned
  script, recorded capture, animated GIF, vertical Shorts cuts (mp4/webm), and a
  standalone player.
- First npm publication: [`research-scope-mcp`](https://www.npmjs.com/package/research-scope-mcp)
  **v0.1.2 is live** (confirmed 2026-10-17 against the registry API —
  `dist-tags.latest: 0.1.2`, tarball sha512 `LJv0PL9tMTyBF…`, 10 files / 18.0 kB).
  Install with `npm install -g research-scope-mcp` or `npx -y research-scope-mcp`;
  the repo-clone route remains valid for source builds.

### Fixed
- **check_report no longer orphans the report shell's own template boilerplate.**
  The italic `_*_` instruction preamble and the `<!-- … -->` example comments were
  being counted as orphan claims in every fresh shell (surplus `orphanClaims` noise
  alongside real findings). `extractClaims` now skips both.

## [0.1.1] - 2026-10-15

### Added
- Regression test `stateless HTTP transport: second request works with no session`
  in `test/server.test.mjs` — sends sessionless `initialize`, then `tools/list`,
  then a real `tools/call` and asserts non-500 with full payloads.
- Starter kit bundle artifact (src + dist + clients + run-1 + failure notes), with
  dev-only `.map` files stripped from `dist/`.

### Fixed
- **Streamable HTTP: every request after `initialize` returned a silent 500**
  (empty body). Root cause: a single shared stateless transport (`sessionIdGenerator:
  undefined`) was created at startup and reused for all requests, but the SDK
  requires a fresh server + transport pair **per request** in stateless mode
  ("Stateless transport cannot be reused across requests"). `runHttp` now builds
  both per request and closes them on response end — the SDK's official stateless
  example pattern. Verified: sessionless `initialize` → `tools/call plan_research`
  returns 200 with a full plan.

## [0.1.0] - 2026-10-15

### Added
- `plan_research(scope)` — source-target plan with kill criteria.
- `fetch_and_score(source_url)` — explainable source-quality scoring
  (primary-source detection, freshness, paywall + COI flags; HTTP status gate).
- `build_report(topic, sources)` — citation-registry report shell saved under
  `data/reports/`; unscored sources are rejected with an error naming them.
- `check_report(report_id | report_path)` — every substantive claim must cite ≥1
  scored source; orphan claims return an error list, never a pass.
- Dual transport: stdio (default) + Streamable HTTP (`--http --port N`).
- Docker build ([docker/Dockerfile](docker/Dockerfile)) for Glama/Docker-Catalog
  reproducible-build scans.
- Client configs: Claude Code, Cursor, Cline (`clients/llms-install.md`).
- MIT `LICENSE` file.
- Publish runbook (`PUBLISH.md`) and submission packets for the official MCP
  registry, Cline marketplace, Glama, and mcp.so.
- Published to the official MCP registry as
  `io.github.AxelVerneBooks/research-scope-mcp` v0.1.0.

### Changed
- `server.json` migrated to the 2025-12-11 registry schema (`title`, plain
  `remotes` transport).
- Registry namespace resolved to `io.github.AxelVerneBooks` (case-sensitive);
  `repository` and `websiteUrl` updated to match. The `packages[]` entry was
  removed in favour of the documented npm fallback.

### Notes
- Scoring rubric v1 weights (availability 20 / primary 32 / freshness 24 / access 12 /
  independence 12) documented in README and returned with evidence per dimension.

[Unreleased]: https://github.com/AxelVerneBooks/research-scope-mcp/compare/ba2d1e7...HEAD
[0.1.2]: https://github.com/AxelVerneBooks/research-scope-mcp/compare/579218a...ba2d1e7
[0.1.1]: https://github.com/AxelVerneBooks/research-scope-mcp/compare/ed885a6...579218a
[0.1.0]: https://github.com/AxelVerneBooks/research-scope-mcp/commit/ed885a6
