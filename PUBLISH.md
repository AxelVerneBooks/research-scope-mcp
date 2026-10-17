# Publish runbook — first `mcp-publisher publish`

Everything that could be prepared locally is prepared and verified:

- ✅ `server.json` validates against the **live registry** with the current
  `2025-12-11` schema (`mcp-publisher validate` → ✅, no deprecation warning)
- ✅ server builds (`npm run build`), integration tests pass (`npm test`, includes a
  live network fetch), stdio + Streamable HTTP both smoke-tested
- ✅ `mcp-publisher` v1.8.1 binary installed at `~/bin/mcp-publisher`

## Run form — copy-paste packet

The exact commands (repo-create + push under AxelVerneBooks, registry login/publish)
and the Cline issue-firing sequence are packaged step-by-step in
[docs/publication/publish-day-packet.md](docs/publication/publish-day-packet.md) —
built 2026-10-15 to run with zero improvisation after the AxelVerneBooks login.

## Gates that need the user/account (cannot be automated here)

1. ~~**Real GitHub namespace.**~~ **RESOLVED 2026-10-15:** namespace is
   `io.github.AxelVerneBooks/research-scope-mcp` (case-sensitive — the OAuth token
   grants `io.github.AxelVerneBooks/*`; lowercase names get a 403), `repository.url` →
   `github.com/AxelVerneBooks/research-scope-mcp`, `websiteUrl` → `axelverne.com`
   (all patched here; account verified live via the GitHub API). ~~Remaining:
   **create the public repo under AxelVerneBooks and push**~~ — **DONE 2026-10-15**
   (repo public, `main` pushed, all download URLs verified). If the OAuth session ever
   lands on a different login, the namespace must be edited to match *before* publish
   (versions are immutable; a wrong namespace means re-publishing a new version).
2. **Create the public repo + push:**
   `git remote add origin git@github.com:<user>/research-scope-mcp.git && git push -u origin main`
   (public repo is what Glama/admin-access scans require)
3. **Login (one-time OAuth):** `~/bin/mcp-publisher login github` — opens a browser
   flow; the token is cached locally.
4. ~~**npm package must exist** if the `packages[]` block says `registryType: npm`.~~
   **RESOLVED 2026-10-15:** took the fallback — `packages[]` deleted (npm publication
   deferred; install path is repo clone + `npm ci && npm run build`). The placeholder
   `remotes[]` block was also removed rather than publish a fake URL. Registry
   publication landed same day: `io.github.AxelVerneBooks/research-scope-mcp` v0.1.0,
   status `active`.
5. **Publish:** `cd repo && ~/bin/mcp-publisher publish`

## Immutable-version discipline

Every publish needs a **unique new version** and metadata is immutable. Bump
`version` in `package.json`, `src/version.ts`, and `server.json` together (register
the bump in `CHANGELOG.md`), build, test, then publish. Errors are never "fixed" —
they are *superseded* by the next version.

**The mechanical runbook:** [docs/publication/release-checklist-version-bump.md]
(docs/publication/release-checklist-version-bump.md) — the complete 8-surface
version list, per-step commands with expected output, and the traps hit on 0.1.2
(premature CHANGELOG claims; expired publisher token). Follow it top-to-bottom for
each release.

## After publish — directory spread (from `gumroad-tracks/runbook-and-pricing.md`)

1. official registry (this step) → 2. Glama "Add MCP Server" (admin access +
   reproducible build — the Dockerfile exists for this) → 3. Cline marketplace issue
   (needs repo URL + 400×400 PNG logo + README installability; `clients/llms-install.md`
   is written) → 4. mcp.so GitHub issue → 5. Smithery URL publish. PulseMCP: still
   paused, skip.
