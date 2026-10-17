# mcp.so issue #5484 — one-week follow-up comment (Oct 22, staged; do NOT post until told)

**CONSUMED 2026-10-16:** the comment was posted early (per user instruction) with
the framing adapted — "poking early / confirming receipt" instead of "one week",
because only 1 day had passed. Pre-flight ran clean before posting (search
payload `total: 0`, `/server/` 404). **Do not post this file again** — the
one-nudge-per-directory guardrail below is now in force; next touchpoint Nov 22
or npm-landing, whichever is later (or if maintainers reply with an ask).
Ledger row: `gumroad-tracks/trackC-mcp-kit.md` §2 watch-items.

Issue: https://github.com/chatmcp/mcpso/issues/5484 (research-scope-mcp submission,
filed 2026-10-15, plain FAQ-format issue — no template on that repo).

## Pre-flight check (≤60s, before posting)

If either of these shows the listing exists, the comment is moot — do NOT post,
just log the row and move on:

1. https://mcp.so/search?q=research-scope — any hit for "research-scope-mcp"
2. https://mcp.so/server/research-scope-mcp — 200 rather than 404

If indexing still shows nothing on Oct 22 → paste the comment below.

- Note: if by Oct 22 **npm also went live** (i.e. the B-comment in
  `npm-status-followup-comments.md` has already been posted), use the combined
  variant at the bottom instead of the plain one.
- After posting: log the row in `gumroad-tracks/trackC-mcp-kit.md` action #2
  (date, "one-week nudge", issue number 5484); leave the issue open.

## The comment (paste everything between the rules)

---

**Gentle nudge — one week since filing (2026-10-15):** `research-scope-mcp` still
doesn't surface on mcp.so on our end (search + direct URL both come up empty), so in
case the index pass skipped over the thread — everything the submission describes is
live and re-verified today:

- **Repo (public):** https://github.com/AxelVerneBooks/research-scope-mcp — MIT,
  TypeScript, Node ≥ 20, dated CHANGELOG
- **Official MCP registry:** `io.github.AxelVerneBooks/research-scope-mcp`
  **v0.1.2**, status **active** (published 2026-10-17; `server.json` validates
  against the 2025-12-11 schema)
- **Logo (400×400):**
  https://github.com/AxelVerneBooks/research-scope-mcp/raw/main/docs/logo/logo-400.png
- **One-ask verification:** spawn `node dist/index.js` (or `npx research-scope-mcp`
  once npm lands) and call `plan_research("verify install")` → JSON containing
  `primarySourceTargets` + `killCriteria`

v0.1.2 also carries a fix: a fresh report shell's own template boilerplate is no
longer reported as orphan claims by `check_report`.

One caveat stays in place for now (same as the original note): the npm package is
prepared and dry-run verified but publication is still pending — until then the
working install path is the repo clone: `git clone` → `npm ci && npm run build`
(step-by-step in `clients/llms-install.md`).

**Question:** is the indexing pass queued for this issue, or is anything missing at
your end that we can fix from the outside — logo URL, connection-info format, tool
list shape, anything the crawler expects? Happy to reformat or resubmit in whatever
shape makes the indexer's job easier.

Thank you — and apologies for the poke; we only want the same correct listing you do.

---

## Combined variant (only if npm is already live before/when posting Oct 22)

Paste this instead, replacing the caveat paragraph and keeping the rest of the
plain variant identical:

> One update from the caveat paragraph: the npm package is now live —
> `npm install -g research-scope-mcp` / `npx -y research-scope-mcp` — so the
> connection info from the original submission works verbatim, no clone needed.
> (Changelog: https://github.com/AxelVerneBooks/research-scope-mcp/blob/main/CHANGELOG.md)

## Do-not-post guardrails (unchanged from the A/B packet)

- Never post B-flavored text unless npm is actually live — check
  https://www.npmjs.com/package/research-scope-mcp first.
- One nudge per directory, then silence: if Oct 22 passes with no reply, the next
  touchpoint is a month out (Nov 22) or when npm lands, whichever is later.
- Keep both #3028 (Cline) and #5484 (mcp.so) open; maintainers close them.
