# Publish-day packet — one page, zero improvisation

All copy-paste commands + the exact Cline issue fields. Run under your
**AxelVerneBooks** login (browser-signed-in account; the local `gh` CLI is currently
the *other* account — see auth path A). Nothing here requires decisions: choices were
locked on 2026-10-15 (namespace `axelvernebooks`, registry 2025-12-11 schema, Cline
packet built against the live template).

---

## STEP 1 · Authenticate the CLI as AxelVerneBooks

**Path A (recommended — web login inherits the browser's Google session):**

```bash
gh auth login --hostname github.com --web --git-protocol https
# browser opens complete the Google sign-in for AxelVerneBooks; then:
gh auth switch --hostname github.com --user AxelVerneBooks   # only if needed
gh auth status    # verify: "Active account: true" -> AxelVerneBooks
```

**Path B (if web flow lands on the wrong account — personal access token):**
Token needs scopes `repo` (that is all — public repo + push). Create at
github.com/settings/tokens (AxelVerneBooks session), then:

```bash
gh auth login --hostname github.com --with-token
# paste the token on one line, then press Ctrl+D
gh auth status
```

## STEP 2 · Create the public repo and push (one command)

```bash
cd /Users/agent/Projects/research-scope-mcp
gh repo create AxelVerneBooks/research-scope-mcp \
  --public \
  --description "MCP server: research-to-report workflow — plan_research, fetch_and_score (explainable 0-100 source scoring), build_report, check_report (citation coverage enforced)" \
  --homepage "https://axelverne.com/" \
  --source=. --remote=origin --push
```

Fallback if you prefer plain git (equivalent; auth via credential helper of the
step-1 login):

```bash
git remote add origin https://github.com/AxelVerneBooks/research-scope-mcp.git
git push -u origin main
```

## STEP 3 · Verify the push did what the submissions claim

```bash
gh repo view AxelVerneBooks/research-scope-mcp --json name,visibility,url,pushedAt
gh api repos/AxelVerneBooks/research-scope-mcp/contents/server.json --jq '.name'
# the Cline draft's URL-for-the-logo must now 200:
curl -sIL https://github.com/AxelVerneBooks/research-scope-mcp/raw/main/docs/logo/logo-400.png | head -3
```

Expected: public visibility, `pushedAt` = today, `server.json` resolves, logo `HTTP/2 200`.

## STEP 4 · Registry publish (same session still under AxelVerneBooks)

```bash
cd /Users/agent/Projects/research-scope-mcp
~/bin/mcp-publisher validate          # 5-second re-check; last run 2026-10-15: valid
~/bin/mcp-publisher login github      # OAuth — completes in the AxelVerneBooks browser session
~/bin/mcp-publisher publish
```

- The namespace `io.github.axelvernebooks/research-scope-mcp` matches the login —
  the publish is accepted on that pairing.
- **npm decision reminder:** `server.json` still claims `packages[] → registryType:
  npm`. If the npm package isn't published today, delete the `packages[]` block,
  bump the version trio (`package.json`, `src/version.ts`, `server.json`),
  commit, and `publish` again — registry versions are immutable.

## STEP 5 · Fire the Cline marketplace issue

Open: **https://github.com/cline/mcp-marketplace/issues/new?template=mcp-server-submission.yml**
(The full packet already lives at
[docs/publication/cline-marketplace-issue.md](cline-marketplace-issue.md) — the fields
below are the paste-exact extracts.)

**Title:**

```
[Server Submission]: research-scope-mcp
```

**Field 1 · GitHub Repository URL:**

```
https://github.com/AxelVerneBooks/research-scope-mcp
```

**Field 2 · Logo Image:** drag-and-drop `docs/logo/logo-400.png` (or paste the raw
URL verified in step 3).

**Fields 3+4 · both checkboxes:** confirm honestly after a 60-second re-test:

```bash
npx research-scope-mcp &          # or repo clone path if npm not yet published
# per clients/llms-install.md: add the stdio block to Cline, call plan_research("verify install"),
# expect JSON with primarySourceTargets + killCriteria, then kill the process
```

**Field 5 · Additional Information:** paste the block from
[cline-marketplace-issue.md FIELD 5](cline-marketplace-issue.md) — update its npm
line to match whatever you chose in step 4 before pasting.

---

## If anything blocks — the two likely stoppers

1. **OAuth lands on the wrong login** → namespace must match the publishing login.
   Fix `server.json`'s `name` to the login you *actually* have, re-validate, commit,
   then publish (bump trio version first — immutable metadata rule).
2. **npm identifier missing at install-test time** → Cline reviewers fall back to the
   repo-clone path; the submission's disclosure already says so. Keep the CHANGELOG's
   chronology tidy.

Post-success: log the row in `gumroad-tracks/trackC-mcp-kit.md` action #1 and the
directory-spread checklist (Glama next — it needs the admin-access step on the repo).

This packet is referenced from [PUBLISH.md](../../PUBLISH.md) as the run form for its
gates.
