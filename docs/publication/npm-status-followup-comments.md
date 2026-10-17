# npm status follow-up comments — ready to paste (do NOT post until told)

**STATE SUPERSEDED 2026-10-17:** npm 0.1.2 is **confirmed LIVE**
(`dist-tags.latest: 0.1.2`, verified against the registry API). The B-comment
below is now the live truth and is the one to post on the two open issues;
comment A ("publication in progress") is retired — do not post it anywhere.
The B text already names the correct version and install commands.

## A · post now (honest status update)

> **Status update (0.1.2):** the official MCP registry now carries
> `io.github.AxelVerneBooks/research-scope-mcp` **v0.1.2** (published
> 2026-10-17), including a fix to `check_report` so the report shell's own
> template boilerplate is never reported as orphan claims — a fresh shell
> reports exactly the authored claims. npm publication is still **in
> progress**: the 0.1.2 package is prepared and dry-run verified in the
> repo, and it publishes as soon as an npm account/token is attached
> (CHANGELOG.md documents this). Until npm goes live the working install
> path is the repo-clone route: `git clone` → `npm ci && npm run build`,
> then the `mcpServers` block in `clients/llms-install.md`.

## B · post when npm is live (replaces A's npm lines)

> **Status update (0.1.2 + npm):** v0.1.2 is published on the official MCP
> registry, and the npm package is now live at
> **https://www.npmjs.com/package/research-scope-mcp** — the caveat in the
> original submission can be dropped:
>
> - install: `npm install -g research-scope-mcp` (or `npx -y research-scope-mcp`)
> - verify in one ask: `plan_research("verify install")` → JSON with
>   `primarySourceTargets` + `killCriteria`
>
> v0.1.2 also fixes `check_report` so a fresh report shell's template
> boilerplate is no longer reported as orphan claims.
> https://github.com/AxelVerneBooks/research-scope-mcp/blob/main/CHANGELOG.md

## Where these go

- Cline: https://github.com/cline/mcp-marketplace/issues/3028 (comment box)
- mcp.so: https://github.com/chatmcp/mcpso/issues/5484 (comment box)
- After posting, log the row in `gumroad-tracks/trackC-mcp-kit.md` action #2
  with the date, then keep both issues open (they close by the maintainers).
