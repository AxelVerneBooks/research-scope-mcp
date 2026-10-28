# Troubleshooting

Problems below were found by reading the server code and running the test suite,
not guessed. Each section says what you see, why it happens, and what to do.
Error messages returned by the tools link straight to the matching section.

- [Reading the logs](#reading-the-logs)
- [Fetch fails with a network error](#fetch-fails-with-a-network-error)
- [Fetch times out](#fetch-times-out)
- [Source scores 0 with dead-link but opens in a browser](#source-scores-0-with-dead-link-but-opens-in-a-browser)
- [Every source shows published today](#every-source-shows-published-today)
- [build_report says a URL was never scored](#build_report-says-a-url-was-never-scored)
- [Report directory is not writable](#report-directory-is-not-writable)
- [check_report cannot find the report](#check_report-cannot-find-the-report)
- [check_report fails on a report I edited](#check_report-fails-on-a-report-i-edited)
- [check_report passes with a citation that points nowhere](#check_report-passes-with-a-citation-that-points-nowhere)
- [check_report passed but a citation later dead-links](#check_report-passed-but-a-citation-later-dead-links)
- [HTTP server will not start](#http-server-will-not-start)
- [HTTP requests get no 401 and no auth](#http-requests-get-no-401-and-no-auth)
- [Client shows no tools or reports invalid JSON](#client-shows-no-tools-or-reports-invalid-json)
- [npm test fails on the full workflow test](#npm-test-fails-on-the-full-workflow-test)
- [Reporting a bug](#reporting-a-bug)

---

## Reading the logs

The server writes one JSON object per line to **stderr**, never stdout (stdout is
the stdio protocol channel). Every line has `ts`, `level` and `event`, plus fields
for that event:

```json
{"ts":"2026-10-28T06:04:17.264Z","level":"warn","event":"fetch.failed","url":"https://does-not-exist.invalid/","durationMs":25,"code":"ENOTFOUND","err":{"name":"TypeError","message":"fetch failed","cause":{"message":"getaddrinfo ENOTFOUND does-not-exist.invalid","code":"ENOTFOUND"}}}
```

Set the level with `RESEARCH_SCOPE_LOG_LEVEL` (`debug`, `info` (default), `warn`,
`error`, `silent`). `debug` adds tool arguments, registered scores and each HTTP
request. Most clients show server stderr in their MCP log; to see it directly:

```bash
RESEARCH_SCOPE_LOG_LEVEL=debug npx research-scope-mcp 2> server.log
```

Events worth searching for:

| Event | Meaning |
|---|---|
| `server.start` | version, transport, the resolved `dataDir`, pid |
| `tool.finish` | tool name, `ok`, `durationMs`, and the error text when `ok` is false |
| `tool.crash` | a tool threw unexpectedly; this is a bug, please report it |
| `fetch.done` / `fetch.failed` / `fetch.non_200` | outcome of each source fetch |
| `report.built` / `report.checked` | report id and path; pass/fail and orphan count |
| `server.listen_failed` / `server.invalid_port` | HTTP transport could not start |

## Fetch fails with a network error

**Symptom.** `fetch_and_score` returns an error such as `Could not resolve host
"example.org" (ENOTFOUND)`, `Network error reaching ... (ECONNREFUSED)` or `TLS
certificate check failed`. Before this release the tool returned only the bare text
`fetch failed`.

**Why.** The server uses Node's built-in `fetch`. Node puts the real reason in the
error's `cause`, and:

- Node's `fetch` **ignores `HTTPS_PROXY` / `HTTP_PROXY`** unless the process starts
  with `NODE_USE_ENV_PROXY=1` (Node 22.21+ / 24+). In a container, CI runner or
  corporate network that only allows traffic through a proxy, every fetch fails
  with a DNS or connection error even though `curl` works.
- Containers and sandboxes often have no outbound network or no DNS.
- Proxies that re-sign HTTPS make Node reject the certificate.

**Fix.**

1. Check the URL itself (`curl -I <url>`).
2. Behind a proxy, add the variable to the client's MCP config:
   ```json
   { "command": "npx", "args": ["-y", "research-scope-mcp"],
     "env": { "NODE_USE_ENV_PROXY": "1", "HTTPS_PROXY": "http://proxy:8080" } }
   ```
3. For TLS errors from a re-signing proxy, set `NODE_EXTRA_CA_CERTS` to the proxy's
   CA bundle. Do not set `NODE_TLS_REJECT_UNAUTHORIZED=0`.
4. In Docker, confirm the container has outbound network (`docker run --network`).

## Fetch times out

**Symptom.** `Timed out after 15s fetching <url>`.

**Why.** Each fetch has a fixed 15-second limit for the whole response, body
included. Large PDFs, slow hosts and bot-protection interstitials hit it.

**Fix.** Retry once. If a source keeps timing out, treat it as unusable (your
reader may not be able to load it either) or score an archived copy, for example
from the Wayback Machine. See also [docs/notes/one-common-failure.md](docs/notes/one-common-failure.md).

## Source scores 0 with dead-link but opens in a browser

**Symptom.** `fetch_and_score` returns `score: 0`, grade `D`, flags
`["http-403", "dead-link"]` (or `http-401`, `http-429`), yet the page loads in a
browser.

**Why.** Any status other than 200 scores 0 and is flagged `dead-link`. Many sites
return 403 or 429 to non-browser clients (bot walls, rate limits), so the page is
blocked, not dead. The server logs a `fetch.non_200` warning with a hint when the
status is 401, 403 or 429.

**Fix.** Do not cite the score as proof the page is gone. Try the canonical or
archived URL, an official mirror, or a different primary source for the same claim.

## Every source shows published today

**Symptom.** `publishedAt` is today's date and `freshnessDays` is `0` for pages that
are clearly older, so freshness gets full marks (24/24).

**Why (known issue).** `detectPublishedAt` in `src/scoring/score.ts` checks the
`last-modified` header, then the HTTP `date` header, before looking in the page
text. The `date` header is the time the server *sent the response*, not when the
page was published, and almost every server sends it. So for any page without
`last-modified`, the date found in the page text is never reached.

**Workaround.** Until the scorer is fixed, read the freshness dimension critically:
if `notes` says `published <today> (0d ago)`, check the page's own date by hand
and, if it is old, say so in the report. A scoring fix will change scores and
needs its own release.

## build_report says a URL was never scored

**Symptom.** `These URLs were never scored — run fetch_and_score on them first`,
even though you did.

**Why.** Scores are kept in memory and keyed by the exact URL string:

- `https://example.org/page` and `https://example.org/page/` are different keys.
  The error now suggests the scored URL when only a trailing slash, host case or
  similar differs (`did you mean ...?`).
- A score is stored under the URL you passed and the final URL after redirects.
  Any other spelling misses.
- Scores are lost when the server process restarts (client reload, crash, new
  `npx` run). The error says so when nothing at all is scored.

**Fix.** Pass `build_report` the exact URLs you passed to `fetch_and_score`, in the
same server session. After a restart, score the sources again.

## Report directory is not writable

**Symptom.** `Cannot create the report directory ...` or `Cannot write ...` with a
code such as `EACCES`, `EROFS` or `ENOTDIR`.

**Why.** Reports go to `$RESEARCH_SCOPE_DATA_DIR/reports/`. The default data dir
is `./data` relative to the **server's** working directory, which is wherever the
MCP client launched it, often `/` or an application folder you cannot write to.

**Fix.** Set an absolute, writable path in the client config:

```json
{ "env": { "RESEARCH_SCOPE_DATA_DIR": "/Users/you/research-scope-data" } }
```

The `server.start` log line shows the resolved `dataDir`. In Docker, mount a volume
on `/app/data`.

## check_report cannot find the report

**Symptom.** `Report file not found: ...` or `Unknown report_id "..."`.

**Why.**

- `report_path` is resolved against the server's working directory, not the
  client's or your shell's. A relative path usually points somewhere else.
- `report_id` values are kept in memory only and are lost when the server
  restarts.

**Fix.** Pass `report_path` with the absolute path that `build_report` printed
(`Report shell <id> saved to <path>`).

## check_report fails on a report I edited

**Symptom.** You added cited claims to the saved report, ran `check_report` with
`report_id`, and it still says `FAIL — no substantive claims found`.

**Why.** `report_id` checks the shell as `build_report` produced it, kept in memory.
Edits to the file on disk are not seen. The result now includes a `note` saying so.

**Fix.** Use `report_path` with the saved file's absolute path.

A fresh, unedited shell always fails: it has no claims yet. Write findings of 40 or
more characters under `## Claims`, each citing a registry number such as `[S1]`.
Headings, short lines, the italic preamble and `<!-- -->` comments are not counted
as claims.

## check_report passes with a citation that points nowhere

**Symptom.** A claim citing `[S9]` passes even though the registry has only
`[S1]`–`[S3]`.

**Why (known issue).** `check_report` checks that each claim carries at least one
`[Sn]` marker. It does not check that `n` exists in the report's citation registry.

**Workaround.** Before publishing, check that every `[Sn]` in the claims section
has a matching line under `## Citation registry`.

## check_report passed but a citation later dead-links

`check_report` reads the stored scores and does not fetch again, so a source can go
404 after it was scored. Re-run `fetch_and_score` on every source on the day you
publish. Details: [docs/notes/one-common-failure.md](docs/notes/one-common-failure.md).

## HTTP server will not start

**Symptom.** The process exits right after launch with `--http`.

**Why and fix.** Check the `server.listen_failed` or `server.invalid_port` log line:

- `EADDRINUSE`: another process holds the port. Stop it or pass `--port <free port>`.
- `EACCES`: ports below 1024 need extra privileges. Use a higher port.
- `server.invalid_port`: `--port` or `PORT` is not an integer from 1 to 65535.
  Earlier versions silently fell back to 3001 instead.

## HTTP requests get no 401 and no auth

Earlier README text said unauthenticated HTTP clients get a `401` with a
`WWW-Authenticate` header. **The server has no auth layer and never sends one.**
Anyone who can reach the port can call every tool, including `fetch_and_score`,
which makes outbound requests to any URL it is given. The listener binds all
interfaces (`0.0.0.0`, shown in the `server.start` log line), so on a machine with
a public address it is reachable from outside unless a firewall blocks the port.
Keep the HTTP transport behind a firewall or an authenticating proxy, as
[SECURITY.md](SECURITY.md) says.

The HTTP transport is stateless: each request gets a new MCP server, and scores and
reports are shared through process memory. Running more than one replica behind a
load balancer means a `build_report` can land on a replica that never scored the
source.

## Client shows no tools or reports invalid JSON

**Why.** In stdio mode, stdout carries JSON-RPC. Anything else written to stdout
(a wrapper script's `echo`, an `npm` banner, a `console.log` in a fork) corrupts the
stream. This server logs only to stderr.

**Fix.** Launch the server directly with `npx -y research-scope-mcp` or
`node dist/index.js`, not through a script that prints to stdout. Use `npx -y` so
npx does not stop to ask for install confirmation. Check the client's MCP log for
the `server.start` line; if it is missing, the process never started (check that
`node --version` is 20 or newer).

## npm test fails on the full workflow test

**Symptom.** `full workflow: plan → fetch_and_score → build → check (live fetch,
network required)` fails with `live fetch failed (network required ...)`.

**Why.** That test fetches `https://www.nhtsa.gov/` for real. Without outbound
network, or behind a proxy without `NODE_USE_ENV_PROXY=1`, it fails. The other
tests, including the offline workflow test that uses a local HTTP fixture, do not
need network.

**Fix.** Run the suite with network access, or read the failure message: it now
gives the underlying network error instead of a JSON parse error.

## Reporting a bug

Open a [bug report](https://github.com/AxelVerneBooks/research-scope-mcp/issues/new?template=bug_report.yml)
with:

- the server version (`server.start` log line, or `npm ls -g research-scope-mcp`),
- Node version, OS, MCP client, and transport (stdio or HTTP),
- the tool call that failed and its full response,
- the stderr log lines around the failure, captured with
  `RESEARCH_SCOPE_LOG_LEVEL=debug`. Remove any private URLs first.

Security issues go through [SECURITY.md](SECURITY.md), not public issues.
