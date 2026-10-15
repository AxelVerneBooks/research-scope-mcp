# Worked run 1 — optics incident: circuit-loss report (anonymized)

Scenario: a defending-side citizen-science collective verifies an optics claim made by a
vendor about a before/after "dark sky rating" upgrade in a small town. Names, URLs and
identifiers below are placeholders — substitute your own sources when replaying.

## 1. plan_research

```
plan_research(scope: "verify vendor claim that streetlight retrofit raised the town's dark-sky rating to 6/9 in 2025", domain_hints: [".gov", "darksky.org", "press"])
```

Output (abridged):

- primarySourceTargets: vendor's own press release; the lighting standards body page
- corroboratingTargets: two independent secondaries (local news not carried by the vendor);
  community thread documenting pre-retrofit skyglow
- antiTargets: affiliate round-ups; undated aggregator rewrites
- killCriteria: fewer than 1 primary + 2 secondaries → stop, "insufficient sources"

## 2. fetch_and_score (each source, results abridged)

| # | Source class | Score | Flags |
|---|---|---|---|
| S1 | standards body page (primary host) | **88 (A)** | none |
| S2 | vendor press release (`/press-release/` path) | **71 (B)** | `conflict-of-interest:sponsored` absent but `vendor-page` set later |
| S3 | local news secondary (cites S2 + city minutes) | **62 (C)** | `no-date` |
| S4 | community forum thread | **54 (C)** | `no-date`, thin-content |

Kill criterion checked: 1 primary + 2 secondaries scored ≥ 45 → proceed.

## 3. build_report

```
build_report(topic: "Optics incident: retrofit rating claim", sources: [S1..S4])
```

Report shell written to `data/reports/report-<id>.md` with the `[Sn]` registry printed.
Claims written against it (excerpt):

> The town's rating rose from 4/9 to **6/9** following the Q3 retrofit — but the
> standards body page confirms the rating cycle in which the audit was performed [S1];
> the vendor page itself only claims the upgrade, not the cycle timing [S2].

> The "6/9" figure was re-published by exactly one non-vendor outlet [S3]; no second
> independent confirmation was found.

## 4. check_report

```
check_report(report_id: "<id>")
```

Output:

```json
{
  "pass": true,
  "claimsFound": 7,
  "claimsCited": 7,
  "orphanClaims": "none",
  "verdict": "PASS — every claim cites a scored source"
}
```

**What the run proved:** the mechanical pass matters because drafting attempt #1
contained two orphan sentences ("residents reported brighter horizons", "the council
voted unanimously") that would have shipped unscored. The check forced both to be
sourced or dropped; one was traceable to the forum thread and gained its `[S4]`, the
other was uninsourced and removed.
