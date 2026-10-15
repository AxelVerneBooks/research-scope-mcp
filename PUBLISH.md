# Publish runbook — first `mcp-publisher publish`

Everything that could be prepared locally is prepared and verified:

- ✅ `server.json` validates against the **live registry** with the current
  `2025-12-11` schema (`mcp-publisher validate` → ✅, no deprecation warning)
- ✅ server builds (`npm run build`), integration tests pass (`npm test`, includes a
  live network fetch), stdio + Streamable HTTP both smoke-tested
- ✅ `mcp-publisher` v1.8.1 binary installed at `~/bin/mcp-publisher`

## Gates that need the user/account (cannot be automated here)

1. ~~**Real GitHub namespace.**~~ **RESOLVED 2026-10-15:** namespace is
   `io.github.axelvernebooks/research-scope-mcp`, `repository.url` →
   `github.com/AxelVerneBooks/research-scope-mcp`, `websiteUrl` → `axelverne.com`
   (all patched here; account verified live via the GitHub API). Remaining:
   **create the public repo under AxelVerneBooks and push** — must be done under
   that login (`gh` CLI on this machine is authed as a different account), then
   keep the browser session on **AxelVerneBooks** for the OAuth step in gate 3.
   If the OAuth session ever lands on a different login, the namespace must be
   edited to match *before* publish (versions are immutable; a wrong namespace
   means re-publishing a new version).
2. **Create the public repo + push:**
   `git remote add origin git@github.com:<user>/research-scope-mcp.git && git push -u origin main`
   (public repo is what Glama/admin-access scans require)
3. **Login (one-time OAuth):** `~/bin/mcp-publisher login github` — opens a browser
   flow; the token is cached locally.
4. **npm package must exist** if the `packages[]` block says `registryType: npm`.
   Either publish first (`npm publish` — currently private/unpublished) or delete the
   `packages[]` block and keep only `remotes[]` until npm publication.
5. **Publish:** `cd repo && ~/bin/mcp-publisher publish`

## Immutable-version discipline

Every publish needs a **unique new version** and metadata is immutable. Bump
`version` in `package.json`, `src/version.ts`, and `server.json` together (register
the bump in `CHANGELOG.md`), build, test, then publish. Errors are never "fixed" —
they are *superseded* by the next version.

## After publish — directory spread (from `gumroad-tracks/runbook-and-pricing.md`)

1. official registry (this step) → 2. Glama "Add MCP Server" (admin access +
   reproducible build — the Dockerfile exists for this) → 3. Cline marketplace issue
   (needs repo URL + 400×400 PNG logo + README installability; `clients/llms-install.md`
   is written) → 4. mcp.so GitHub issue → 5. Smithery URL publish. PulseMCP: still
   paused, skip.
