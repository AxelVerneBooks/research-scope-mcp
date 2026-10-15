# Glama submission packet — research-scope-mcp

Built 2026-10-15 against the live directory (glama.ai/mcp/servers — 99,327 servers,
graded badges visible on listings: **license / quality / maintenance**). Live check
notes: the public "Add" entry routes through a GitHub-authorized admin flow — there is
no anonymous form URL (the old deep-link resolves to a search page), so this packet's
step 1 is a post-push step that needs the **AxelVerneBooks** session (we hold admin on
our own repo by definition).

## Why Glama grades us well already (the A-badge map)

Glama's automated scan checks the repo, not a form. Our repo passes each grade:

| Glama badge | What it checks | Our evidence |
|---|---|---|
| license | recognizable LICENSE | MIT LICENSE at root (`79016d3`) |
| quality | reproducible build + tests | `npm run build` (strict TS) + 2/2 integration tests incl. live fetch; Dockerfile for the build-scan |
| maintenance | recent commits + CHANGELOG | dated CHANGELOG.md with version-pinning discipline; 6 commits in one day |

**The scan blocker from the runbook is already handled in design:** a failing
reproducible build blocks discoverability — `docker/Dockerfile` builds from
package-lock (`npm ci`) and the entrypoint command is asserted by the integration
test. Keep this true: any dependency bump lands only with a green build+test locally.

## Submission steps (post-push, ~10 minutes)

1. **Sign in to glama.ai with GitHub under AxelVerneBooks** (admin access to
   `AxelVerneBooks/research-scope-mcp` is the authorization Glama requires).
2. Open the directory → **"Add MCP Server"** (header affordance when signed-in) →
   authorize → point it at the repo. The indexer runs the scan itself.
3. Wait for the first index pass; then check the listing page for the three badges.
   Fix order if one is missing: license → quality (build log is shown) → maintenance.
4. Edit the auto-generated listing text to our one-sentence value prop (below) rather
   than leaving the README-scrape fallback.

## The metadata Glama wants (paste when the form asks)

**One-sentence value prop:**

```
research-scope-mcp turns a scattered source set into a decision-ready, traceable
report: plan research with kill criteria, fetch-and-score every source with an
explainable 0-100 rubric, and enforce claim-level citations so the final report is
auditable in 90 seconds.
```

**Tool list (one-line each — matches src/index.ts exactly):**

- `plan_research(scope, domain_hints?)` — source-target plan with kill criteria; stops
  thin-evidence research before it wastes the run.
- `fetch_and_score(source_url)` — crawls one URL and returns the explainable 0-100
  score: primary-source detection, freshness, paywall + COI flags, per-dimension
  evidence.
- `build_report(topic, sources)` — assembles the citation-registry report shell;
  unscored sources are rejected with an error naming them.
- `check_report(report_id | report_path)` — every claim must cite at least one scored
  source; orphan claims return as an error list, never a pass.

**Supported transport:** stdio (default; no ports) + Streamable HTTP
(`--http --port 3001`, loopback — keep private or auth-proxy). Auth requirements:
none by default (no env secrets; `RESEARCH_SCOPE_DATA_DIR` optional).

**Install/config example:**

```json
{ "mcpServers": { "research-scope": { "command": "npx", "args": ["-y", "research-scope-mcp"] } } }
```

**Logo:** 400×400 PNG at `docs/logo/logo-400.png` (raw URL once public — verified path
in the publish-day packet step 3).
**Demo path:** the integration test + worked runs (`docs/runs/`) are the demo; a
30-second asciinema capture can follow with rubric v2.
**License:** MIT. **Maintenance contact:** via the GitHub repo (issues).

## Post-add verification

- Listing page shows: badge trio present, tool descriptions match the four above (not
  truncated stubs), install command renders working at a glance.
- If the auto-blurb scraped the README too thinly, the edit field is on the listing
  page itself.
- Log the row in `trackC-mcp-kit.md` action #2 with the listing URL.

*Live-check disclosure 2026-10-15: the anonymous add-page deep link no longer exists
(redirects to search); the signed-in admin flow is the operative path — consistent
with the runbook's original "needs admin access" note.*
