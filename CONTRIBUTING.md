# Contributing to research-scope-mcp

Thanks for helping improve `research-scope-mcp`. This project is by
**Axel Verne**, author of the MCP book series — [axelverne.com](https://axelverne.com).

## Getting started

```bash
npm ci
npm run build
npm test
```

Node.js **20 or newer** is required (`engines.node` in `package.json`).

## Code style

- **TypeScript, strict mode.** All server code lives in `src/` and compiles with
  `tsconfig.json` (`strict: true`, `module`/`moduleResolution: Node16`). Do not
  loosen compiler options to make code build.
- **ES modules only.** Relative imports carry the `.js` suffix
  (`import { version } from "./version.js"`); Node built-ins use the `node:`
  prefix (`node:fs`, `node:path`).
- **Formatting:** 2-space indentation, double quotes, semicolons, trailing commas
  in multi-line literals — match the surrounding code.
- **Validate tool inputs with `zod`** and return explicit, actionable errors.
  The server's contract is that failures are loud: an orphan claim or unscored
  source must come back as an error list, never a silent pass.
- **Keep scoring explainable.** Any change to `src/scoring/score.ts` must keep
  returning evidence per dimension, and rubric weight changes must be reflected
  in the README "Scoring rubric" table.
- **Version lives in three places** — `package.json`, `server.json`, and
  `src/version.ts`. Bump all three together, and only in a release PR.
- No new runtime dependencies without discussion in the PR description.

## Test requirements

- `npm test` (build + `node --test test/server.test.mjs`) must pass before you
  open a PR.
- **Bug fixes need a regression test** that fails without the fix — see the
  stateless-HTTP regression test in `test/server.test.mjs` for the pattern.
- **New or changed tools need tests** that drive them over the real MCP protocol
  (spawn `dist/index.js`, send JSON-RPC), not just unit calls.
- Tests must use a temporary data dir (`RESEARCH_SCOPE_DATA_DIR`) and never write
  to the repo's `data/`.
- Tests that need network access must say so in their name (e.g.
  `"... (live fetch, network required)"`).

## Changelog

`CHANGELOG.md` follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
**Every PR must add at least one line under `## [Unreleased]`**, in the matching
section (`Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`).
The `Changelog` CI check fails any PR that does not modify `CHANGELOG.md`.

For changes with nothing user-facing to record (typo fixes, CI-only tweaks), a
maintainer can apply the **`skip-changelog`** label to bypass the check.

On release, rename `[Unreleased]` to `[x.y.z] - YYYY-MM-DD`, start a fresh empty
`[Unreleased]` section, and update the comparison links at the bottom of the file.

## PR checklist

- [ ] Branch is up to date with `main`.
- [ ] `npm test` passes locally.
- [ ] Regression test added for bug fixes; tests added/updated for tool changes.
- [ ] `CHANGELOG.md` has an entry under `[Unreleased]` (or the PR has the
      `skip-changelog` label).
- [ ] README updated if tools, inputs/outputs, transports, or the scoring rubric
      changed.
- [ ] No version bump unless this is a release PR (then `package.json`,
      `server.json`, and `src/version.ts` all match).
- [ ] No secrets, tokens, or generated `data/reports/` files committed.

## Reporting security issues

Please do not open public issues for vulnerabilities — see [SECURITY.md](SECURITY.md).

## License

By contributing, you agree your contributions are licensed under the
[MIT License](LICENSE).
