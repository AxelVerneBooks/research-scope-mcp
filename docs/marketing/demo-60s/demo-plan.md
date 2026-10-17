# 60-second demo run — plan → score → check FAILS honestly on an orphan claim

The demo promise (from the Starter listing copy): `check_report` "returns orphan claims
as an error list, never a pass". This video shows that promise demonstrated in under
a minute, on a captured run of **the shipped dist** (`dist/index.js`, the same bytes a
buyer gets from the $9 Starter zip).

## The one honest failure

A draft report gets written where a hand-typed claim **forgets its `[S1]` citation** —
the exact thing that happens when a busy analyst (or an over-eager agent) pastes a
finding mid-edit. `check_report` must refuse to bless it. The kill beat of the video is
`"pass": false` with the orphan claim named in an error list.

## Runbook (what actually gets executed)

1. `initialize` + `tools/list` on a spawned `node dist/index.js` (stdio).
2. `plan_research { scope: "verify vendor data-retention claim before it goes in a comparison article" }`
3. `fetch_and_score { source_url: "https://www.nhtsa.gov/" }` — a real fetch, real score, in the registry as `[S1]`.
4. `build_report { topic, sources: ["https://www.nhtsa.gov/"] }` — shell + numbered registry.
5. Human/agent step (shown as it is): one claim cites `[S1]`; a second claim is written **without** any citation.
6. `check_report { report_path: ... }` → `pass: false`, `orphanClaims` lists the bad claim, verdict FAIL.

Why this shape: it hits all four tools, is reproducible (one fetch, one registry),
and delivers the product's core differentiator (honest failure) as the climactic
moment — the "what this kit is" beat is the `false`, not a happy path.

## Scene plan @ 60 s

| t | Beat on screen |
|---|---|
| 0–4s | Title card: `plan → score → check · the honest version` |
| 4–11s | plan_research call → kill criteria (trimmed) |
| 11–22s | fetch_and_score → real score + flags for nhtsa.gov |
| 22–30s | build_report → registry `[S1] … score NN/100` |
| 30–42s | claims section being written; the orphan line lands |
| 42–54s | check_report → **pass: false**, orphanClaims panel, verdict FAIL (hold + highlight) |
| 54–60s | Outro: "Orphan claims come back as errors — never a pass. research-scope-mcp 0.1.1 · $9 Starter kit" |

## Authenticity contract

- Every command/result shown is copied from one captured run (`run-capture.jsonl`,
  sha256 recorded below and next to it in the player footer).
- Fetching, scoring, and check are real server responses; the only dressed-up part is
  that claims are typed into the report file *between* tool calls (that step is a human
  editing markdown, which the server correctly treats as in-scope for check_report).
- The player labels the capture unambiguously: "captured run, sha256 …".

## Artifacts

- `docs/marketing/demo-60s/run-capture.jsonl` — the raw run
- `docs/marketing/demo-60s/demo.html` — the 60 s player
- `docs/marketing/demo-60s/demo-60s.webm` — the recording

## Short-form cuts (vertical 1080x1920, h264 yuv420p @5fps)

| Cut | Length | Take |
|---|---|---|
| `cuts/cut1-what-it-does.mp4` | 24.1 s | the honest-failure story in one screen |
| `cuts/cut2-the-honest-failure.mp4` | 16.8 s | FAIL verdict + orphan panel |
| `cuts/cut3-setup-in-30s.mp4` | 34.0 s | setup-in-30s player (real npm ci capture) |

cut3 production note (2026-10-16): rendered headlessly frame-sequence (puppeteer-core
via `render-cut3.mjs`, 170 PNG frames @200ms → ffmpeg `framerate 5`) because the
tab recorder locks a pre-resize viewport (1280x1387) and the setup player's
below-fold PASS verdict + outro were never captured on screen-recorded takes.
`demo-setup-vertical.html` got a parity fix in the same pass: `show()` now
`scrollIntoView`s like its 60s sibling, so any future tab recording shows the
verdict + outro too. To re-render: install puppeteer-core into a scratch dir, point
`render-cut3.mjs`'s import at its `lib/esm/puppeteer/puppeteer-core.js`, serve `docs/`
on :8899, run `node render-cut3.mjs`, assemble with `-framerate 5 -i …/f%04d.png`.
