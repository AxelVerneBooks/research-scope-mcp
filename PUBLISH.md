# Publish runbook — first `mcp-publisher publish`

Everything that could be prepared locally is prepared and verified:

- ✅ `server.json` validates against the **live registry** with the current
  `2025-12-11` schema (`mcp-publisher validate` → ✅, no deprecation warning)
- ✅ server builds (`npm run build`), integration tests pass (`npm test`, includes a
  live network fetch), stdio + Streamable HTTP both smoke-tested
- ✅ `mcp-publisher` v1.8.1 binary installed at `~/bin/mcp-publisher`

## Gates that need the user/account (cannot be automated here)

1. **Real GitHub namespace.** `server.json` currently has placeholders:
   - `name`: `io.github.axelverne/research-scope-mcp` — must be
     `io.github.<your-GitHub-username>/research-scope-mcp` and match the account you
     log in with
   - `repository.url`: point at the real public repo once created
   - `websiteUrl`: your real store/landing URL (or delete the field)
   - `remotes[]`: leave only if you actually host the HTTP server publicly; an
     stdio-only server should delete the `remotes` section entirely
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
