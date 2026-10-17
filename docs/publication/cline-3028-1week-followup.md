# Cline marketplace issue #3028 — one-week follow-up comment (staged; do NOT post until told)

Issue: https://github.com/cline/mcp-marketplace/issues/3028 (research-scope-mcp,
filed 2026-10-15 via the official `mcp-server-submission.yml` template — the 5-field
form with logo. Follow-ups go in the comment box; no template needed).

Sibling to `mcpso-5484-oct22-followup.md` — same discipline, Cline-specific content
(what their reviewers check is different: README/llms-install.md installability,
not a general crawler).

## Framing rule (date-honest)

- Posted **on/after Oct 22**: use the comment verbatim — it says "one week since
  filing", which is then true.
- Posted **before Oct 22**: swap the opener to the early-poke variant included
  below (the mcp.so nudge was consumed early on day 1; do not repeat the
  verbatim-one-week mistake).

## Pre-flight check (≤60s, before posting)

If the listing already exists, skip the comment and just log the row:

1. https://cline.bot/mcp — marketplace search for "research-scope-mcp"
2. The issue thread itself — a maintainer reply or label means they're on it;
   in that case respond to *their* ask instead of posting this nudge.

If still nothing on/after Oct 22 → paste the comment below.

- If **npm went live** before posting (check
  https://www.npmjs.com/package/research-scope-mcp), use the combined variant.
- After posting: log the row in `gumroad-tracks/trackC-mcp-kit.md` §2 watch-items
  (date, "one-week nudge", issue #3028); leave the issue open.

## The comment (paste everything between the rules)

---

**Gentle nudge — one week since filing (2026-10-15):** `research-scope-mcp` hasn't
appeared in the marketplace on our end (search clean, no reviewer triage on this
thread yet), so flagging in case the scan queue skipped it. Everything from the
submission is live and re-verified today, in exactly the shape your install test
expects:

- **Repo (public):** https://github.com/AxelVerneBooks/research-scope-mcp — MIT,
  TypeScript, Node ≥ 20, dated CHANGELOG
- **The two files your scan cares about:** [README.md](https://github.com/AxelVerneBooks/research-scope-mcp#readme)
  links [clients/llms-install.md](https://github.com/AxelVerneBooks/research-scope-mcp/blob/main/clients/llms-install.md) —
  the 4-step install Cline actually follows (Node ≥ 20 → install → paste the
  one-block `mcpServers` config → verify), unchanged from the submission
- **Official MCP registry:** `io.github.AxelVerneBooks/research-scope-mcp`
  **v0.1.2**, status **active** (`isLatest`); `server.json` validates against the
  2025-12-11 schema
- **One-ask verification:** `plan_research("verify install")` → JSON containing
  `primarySourceTargets` + `killCriteria`

v0.1.2 also carries a fix: a fresh report shell's own template boilerplate is no
longer reported as orphan claims by `check_report`.

The npm caveat from the submission stands (package prepared and dry-run verified,
publication pending) — the install path that already worked at validation time is
the repo-clone route: `git clone` → `npm ci && npm run build`, then the
`clients/llms-install.md` config block.

**Question:** did the installability scan run for this submission, and if it hit
anything — README depth, the llms-install link path, logo rendering, anything —
we'll fix it same-day and re-check. Happy to resubmit in whatever form helps the
automated check.

Thanks for maintaining the marketplace — we'd rather have the listing right than
fast.

---

## Early-poke opener (only if posting before Oct 22)

Replace the first line with:

> **Status check (poking early — normally we'd wait a week, just confirming the
> submission was received):** the rest of this comment stands as written, with all
> links re-verified today.

## Combined variant (only if npm is live before posting)

Insert after the v0.1.2-fix line, replacing the npm-caveat paragraph:

> Update from the caveat paragraph: the npm package is now live —
> `npm install -g research-scope-mcp` (or `npx -y research-scope-mcp`) — so the
> `clients/llms-install.md` install is even shorter than at validation time.
> (Changelog: https://github.com/AxelVerneBooks/research-scope-mcp/blob/main/CHANGELOG.md)

## Guardrails (same packet as mcp.so)

- One nudge, then silence: if Oct 22 passes with no reply, next touchpoint is
  Nov 22 or npm-landing, whichever is later — or immediately if a maintainer
  asks something.
- Never claim npm-live text without first loading the npm URL.
- Keep the issue open; maintainers close it.
- Do not re-post the **A-comment** from `npm-status-followup-comments.md` here —
  this nudge supersedes it (they'd say the same thing twice in one thread).
