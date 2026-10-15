# Gumroad lead-magnet listing — "Research-to-Report: the one-page sources scoring checklist"

Built 2026-10-15 · the $0+ free listing (PWYW set to $0 per the verified mechanics in
`gumroad-tracks/runbook-and-pricing.md` — free products carry a lower file-size limit,
which the one-page 4.6 KB PDF respects with room to spare). Product file:
[lead-magnet-sources-scoring-checklist.pdf](lead-magnet-sources-scoring-checklist.pdf).

## Product settings checklist (dashboard, do-not-copy)

- [ ] Price: **Pay What You Want, minimum $0** (free listing)
- [ ] File: the one-page PDF only — nothing bundled; keep the file tiny
- [ ] Related products: the $9 Starter kit (set after that listing exists)
- [ ] Workflow: attach the 4-email sequence below to the free-purchase event
- [ ] Rating reviews on; a short support note instead of an email address
- [ ] Content page: paste the "What's inside" copy below; thumbnail = the PDF's top
      band cropped, or the 400×400 logo from docs/logo/logo-400.png

## Listing title

**Research-to-Report: the one-page sources scoring checklist**

## Listing description (paste text)

> Score any source 0–100 in under a minute — with the rubric an actual MCP server runs
> mechanically.
>
> A too-good claim, a vendor quote, a republished statistic — the difference between a
> defensible report and an embarrassing one is *how the source was scored before it got
> a citation number*. This one page is the scoring rule the **research-scope-mcp**
> server applies to every source it fetches — primary-source detection, freshness
> windows, paywall and conflict-of-interest flags, grade bands, and the kill rules
> that tell you when to stop and report "insufficient sources" instead of thin evidence.
>
> Inside:
> - the five scoring dimensions with their exact weights (availability / primary-source
>   / freshness / access / independence — rubric v1, matching server 0.1.0)
> - the grade bands (A ≥ 80 down to D) and the three kill rules
> - the citation-registry report shell — one claims section, one numbered registry,
>   one scoring appendix a reader can audit in 90 seconds
> - the 4-step tool loop (plan → score → build → check) the kit automates
>
> Free. Print it, tape it beside your research table. When you want the machines that
> run it, the $9 Starter kit is one click away in the recommended products.

## The 4-email workflow (Gumroad Workflow, attach to free purchase)

**Email 1 — immediately on free purchase. Subject: "Your scoring checklist — and the
15-second version"**
> The checklist is attached (or one click away). Fastest possible start: take any
> source you cited this week — score it in the margins. Five dimensions? One number?
> Grade band?
>
> If that took 90 seconds to hand-score, hold that thought — the kit runs this
> mechanically on every URL you feed it, and it refuses undated sources at the
> freshness line, not at your embarrassment. (Tomorrow: the one failure we see
> constantly, and the 30-second fix.)

**Email 2 — +1 day. Subject: "The failure mode: the report that PASSES with a dead
source"**
> True story from our runs: check_report returns pass, everything is cited, and the
> source 404s between scoring and publication. The registry stores the evidence from
> the fetch *at scoring time* — a report check is reproducible, which cuts both ways.
>
> The 30-second fix (it's now a printed page in the kit): re-run fetch_and_score on
> every source the morning you finalize; a source that now scores http-404 shows
> dead-link in its flags before your reader finds it. Slow sources time out at 15 s —
> score them unusable; never cite what your reader can't load either.
>
> Full walkthroughs of this and one other failure are in docs/runs/ in the repo if
> you want the receipts.

**Email 3 — +3 days. Subject: "When you're ready to stop hand-scoring" (the $9
starter pitch, stated plainly)**
> Three things you get the moment you want this done by machine:
>
> 1. The server itself — plan_research, fetch_and_score, build_report, check_report;
>    stdio for Claude Code/Cursor/Cline, Streamable HTTP if you host it.
> 2. The client configs and llms-install.md — four steps to first run.
> 3. The field guide chapters that explain what breaks (401-vs-403 discovery,
>    timeouts, the disagreement resolvers).
>
> $9 Starter gets the server + one worked run + install support. $19 Kit adds the
> field guide + both worked runs + version-pinned updates. No bundle pressure; if
> the checklist already changed how you ship reports, the Starter is the natural
> next step — that's the whole pitch.
> → [starter kit link]

**Email 4 — +7 days (and reusable as a customer broadcast). Subject: "Scoring rubric
v1.1 — what changed and why"**
> Heads-up from behind the curtain: the rubric is versioned like the server because
> registry metadata is immutable; you'll see v1 -> v2 in CHANGELOG entries, never as
> silent swaps. What we're watching before the next bump: how the "no date = 0
> freshness" rule treats archived pages.
>
> Nothing needs action here — this is what the updates list is for. The checklist PDF
> you took is yours; the history of rubric versions stays explained in the kit's
> CHANGELOG, which the Starter tier includes first.

## Placement wiring

- The paid Starter page's related-products row: lead magnet (visible as "FREE —
  start here"), Field tier ($49) above Starter.
- Kit product page embeds the field-guide sample chapter as the second lead magnet
  later — one capture asset per product family maximum, per the plan's subscriber-
  segmentation rule (engineers got this email list via the lead magnet; books
  audience stays on their own list).
