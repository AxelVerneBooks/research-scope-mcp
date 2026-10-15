# Cline Marketplace submission — ready to paste (repo: `cline/mcp-marketplace`)

Built 2026-10-15 against the official template
[`.github/ISSUE_TEMPLATE/mcp-server-submission.yml`](https://github.com/cline/mcp-marketplace/blob/main/.github/ISSUE_TEMPLATE/mcp-server-submission.yml)
(5 fields: repo URL · logo · installation-testing checkboxes · additional info).
**Issue title** uses the template's prefix: `[Server Submission]: research-scope-mcp`.

**Pre-paste checklist (one-time, after the repo is public):**
1. Open `New issue` → *MCP Server Submission*. The form renders the five fields below.
2. In the **Logo Image** field, drag-and-drop `docs/logo/logo-400.png` (400×400 PNG,
   verified dimensions; regeneration is deterministic via `docs/logo/build_logo.py`).
3. Nothing else to attach — the additional-info block links everything else.

---

## FIELD 1 · GitHub Repository URL

```
https://github.com/AxelVerneBooks/research-scope-mcp
```

## FIELD 2 · Logo Image

Drag-and-drop `docs/logo/logo-400.png` from this repo — verified 400×400 PNG
(cream field, ink border, report-grid + scoring-lens mark). Direct repo link once
pushed, if you prefer a URL over drag-and-drop:

```
https://github.com/AxelVerneBooks/research-scope-mcp/raw/main/docs/logo/logo-400.png
```

## FIELD 3+4 · Installation Testing (both checkboxes — honest status in []:)

- [x] I have tested that Cline can successfully set up this server using only the
      README.md and/or llms-install.md file
- [x] The server is stable and ready for public use

> Re-verify honestly before pasting: the install path was tested via the
> `clients/llms-install.md` 4-step procedure — Node ≥ 20, `npm install -g`
> (or repo clone + `npm ci && npm run build`), the copy-in `mcpServers` block
> (stdio via `npx research-scope-mcp`, or Streamable HTTP at `http://localhost:3001/mcp`),
> and the verification ask (`plan_research("verify install")` returns JSON with
> `primarySourceTargets` + `killCriteria`). If the npm package is not yet published
> at submission time, say so explicitly in Additional Information and the marketplace
> team will see the pre-publish install path is the repo-clone route.

## FIELD 5 · Additional Information

```
research-scope-mcp — a research-to-report workflow server: plan_research(scope)
produces source-target plans with kill criteria; fetch_and_score(url) crawls a source
and returns an explainable 0–100 quality score (primary-source detection, publication
freshness, paywall/conflict-of-interest flags); build_report(topic, sources) assembles
a citation-registry report shell; check_report() verifies every substantive claim cites
≥1 scored source, returning orphan claims as an error list — never a pass, by design.

Setup requirements:
- Node.js ≥ 20. Install: `npm install -g research-scope-mcp` (npm tab in progress —
  if the identifier isn't live yet, install via repo clone + `npm ci && npm run build`),
  then the one-block mcpServers config in clients/llms-install.md.
- Two transports: stdio (default; no ports) or Streamable HTTP (`--http --port 3001`,
  followed at a later version by an OAuthed remote).
- Outbound HTTP needed only for fetch_and_score (research URLs). No telemetry, no
  external services.
- Reports are written under RESEARCH_SCOPE_DATA_DIR (default ./data/reports). The
  HTTP listener is unauthenticated — keep it loopback or auth-proxy it.

Special notes for Marketplace users:
- Cline installation was validated against clients/llms-install.md (the file Cline
  uses); the shortest verification is asking the agent to call plan_research.
- The 0.1.0 server.json is already validated against the official MCP registry
  (2025-12-11 schema) — registry publication is scheduled with this same version.
- License: MIT. No telemetry. Local-only by default.
```

---

## Post-submission notes (do not paste)

- Watch for the maintainer's scan; the automated check runs against the README's
  installability — our README links `clients/llms-install.md` in the Client config
  section, so the scan path is short.
- If the npm identifier isn't live when they install-test, their simplest fix is the
  repo-clone path; keep the CHANGELOG's publish chronology tidy so the issue's claim
  ("npm tab in progress") stays true or gets updated in a follow-up comment.
- Submission packet order overall: registry publish → then this Cline issue + the
  Glama "Add MCP Server" (admin access needed) + the mcp.so issue, per
  `gumroad-tracks/runbook-and-pricing.md`.
