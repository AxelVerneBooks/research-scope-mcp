# Worked run 2 — market-facing claim audit (anonymized)

Scenario: a client-service business needs to verify a vendor's marketing claim that
"our platform handles 40% of all SMS-support tickets industry-wide" before publishing
it in a comparison piece.

## 1. plan_research

```
plan_research(scope: "verify vendor claim of 40% industry-wide SMS-ticket share before citing in comparison article")
```

Kill criteria set early: without **one** independent measurement (not the vendor's own
page) and one adjacent measurement to bracket it, the claim cannot be printed.

## 2. fetch_and_score

| # | Source class | Score | Flags | Note |
|---|---|---|---|---|
| S1 | vendor's claim page | **44 (C)** | `vendor-page`, `no-date` | the claim itself, not evidence |
| S2 | industry trade group's annual report (primary host) | **83 (A)** | none | gives an *addressable market* denominator |
| S3 | competitor's public monthly stat page | **76 (B)** | none (published 8 months ago) | brackets volume from elsewhere |
| S4 | analyst blog round-up citing S2 | **58 (C)** | outbound-citation proxy | secondary corroboration only |

Kill-criterion outcome on the *first* scoring pass: **proceed** — one primary (S2) +
one independent secondary (S3) found, even though the vendor's own page scores low.

## 3. build_report + claims

The registry pins the context around the claim:

- Addressable SMS-support market per S2 → vendor's implied ticket count [S1] exceeds
  the S2 denominator by 2.3×, i.e. **the claim is unbounded rather than false**.
- Printed conclusion: "unsupported by independent measurement; S2/S3 bracket the
  market at one-fifth of the implied volume."

## 4. check_report

```json
{
  "pass": true,
  "claimsFound": 5,
  "claimsCited": 5,
  "orphanClaims": "none",
  "verdict": "PASS — every claim cites a scored source"
}
```

**What this run proved:** the score is decision-relevant, not decorative. A low
`vendor-page` score on the claim source redirected the audit toward finding a
denominator source — the exact investigation the client actually needed — because
`fetch_and_score` surfaced the *reason* (unbounded claim, vendor-self-scored).

## Replay tips

- Run `fetch_and_score` before `build_report`; unscored sources are rejected
  intentionally.
- Expect `no-date` [flag] on forum/secondary pages — it costs 24 freshness points, so
  do NOT let an undated page be load-bearing for a fast-moving claim.
- If a source 404s after scoring, re-score it; `check_report` reads the registry, and a
  registry entry is only as good as the fetch behind it.
