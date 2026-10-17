# npm unblock handoff — the one human step that kills the caveat

Status as of 2026-10-17: the 0.1.2 package is **fully publish-ready** (dry-run
clean: 10 files, 18.0 kB tarball, name `research-scope-mcp` free, versions
aligned in `package.json`/`server.json`/`src/version.ts`). The only missing input
is an npm credential. This machine's egress IP is DataDome-blocked on
www.npmjs.com ("Access is temporarily restricted", ID cda90727-…d6), so the
account + token must be created from a browser that isn't on this network —
your normal browser may pass (DataDome sometimes challenges instead of blocking)
or use your phone's mobile network.

## Human steps (~5 minutes)

1. **Create the account** (from a non-flagged network): https://www.npmjs.com/signup
   → **Continue with GitHub** → authorize with **AxelVerneBooks**. Verify 2FA is
   on (new accounts are forced through it).
2. **Create a granular publish token:**
   https://www.npmjs.com/settings/AxelVerneBooks/tokens → *Generate New Token* →
   **Granular Access Token**:
   - Token name: `research-scope-mcp-publish`
   - Expiration: your choice (90d is sensible)
   - Packages and scopes: **Read and write**
   - "Select packages": either **All packages** or add `research-scope-mcp`
     by name (it doesn't exist yet — granular scoping of a not-yet-published
     name may reject; if so, choose All packages)
   - Organizations: no access. Website: no access.
3. **Store the token where this agent can use it — in a file, never in chat:**
   save the token string (starts `npm_`) to a private file, e.g.:

   ```bash
   umask 077; nano /tmp/npm-publish-token   # or your editor of choice
   ```

   Only the path matters to me — I will never print or read its contents.

4. **Tell me the path** and I run the wiring script (below), which:
   - imports the token into `~/.npmrc` (chmod 600) without echoing it,
   - verifies identity with `npm whoami` (expect `AxelVerneBooks`),
   - runs `npm publish` on the repo (0.1.2) and then verifies the registry.

## After publish (I do these automatically once it succeeds)

- CHANGELOG `### Pending` npm block → past tense (per the release checklist
  rule: only after `npm publish` exits 0).
- B-variant comment becomes the live truth for the open Cline #3028 /
  mcp.so #5484 threads (per `npm-status-followup-comments.md`) — post only on
  your go.
- Ledger row in `gumroad-tracks/trackC-mcp-kit.md`; the caveat paragraph in
  every staged doc is then retired for good.
