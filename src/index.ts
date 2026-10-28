/**
 * research-scope-mcp — MCP server
 *
 * Research-to-report workflow: plan sources with kill criteria, fetch-and-score
 * them, assemble a citation-registry report shell, then verify every claim has a
 * scored source.
 *
 * Transports:
 *   - stdio (default):  `node dist/index.js`
 *   - Streamable HTTP:  `node dist/index.js --http --port 3001`
 *     No auth layer: keep it on loopback or behind an auth proxy (SECURITY.md).
 *
 * Logging: structured JSON lines on stderr only (see log.ts); stdout belongs to
 * the stdio protocol.
 *
 * Tools:
 *   plan_research(scope)            -> source-target plan with kill criteria
 *   fetch_and_score(source_url)     -> crawl + quality score of a single source
 *   build_report(topic, sources[])  -> citation-registry report shell (markdown)
 *   check_report(report_path)       -> every claim must cite >=1 scored source
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import { createServer as createHttpServer } from "node:http";
import { randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import { scoreSource, type SourceScore } from "./scoring/score.js";
import { version } from "./version.js";
import { log } from "./log.js";

const DATA_DIR = pathResolve(process.env.RESEARCH_SCOPE_DATA_DIR ?? pathResolve(process.cwd(), "data"));
const FETCH_TIMEOUT_MS = 15000;
const TROUBLESHOOTING_URL = "https://github.com/AxelVerneBooks/research-scope-mcp/blob/main/TROUBLESHOOTING.md";

/* ------------------------------------------------------------------ */
/* report model                                                        */
/* ------------------------------------------------------------------ */

interface PaperTrailEntry {
  url: string;
  score: number;
  grade: string;
  publishedAt: string | null;
  flags: string[];
  scoredAt: string;
}

interface StoredReport {
  id: string;
  topic: string;
  createdAt: string;
  sources: PaperTrailEntry[];
  claims: Array<{ claim: string; claimId: string; sourceUrls: string[] }>;
  markdown: string;
}

const scoreRegistry = new Map<string, SourceScore>();
const reports = new Map<string, StoredReport>();

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Link to a TROUBLESHOOTING.md section, appended to every actionable error. */
function seeDocs(anchor: string): string {
  return `See ${TROUBLESHOOTING_URL}#${anchor}`;
}

function toolError(text: string) {
  return { isError: true, content: [{ type: "text" as const, text }] };
}

function errorCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = e?.cause?.code ?? e?.code;
  return typeof code === "string" ? code : undefined;
}

/**
 * Turn a fetch() rejection into a message that says what failed and what to do.
 * Node's fetch rejects with a bare "fetch failed"; the useful part is in `cause`.
 */
function describeFetchError(url: string, err: unknown): string {
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  })();
  if (err instanceof Error && err.name === "AbortError") {
    return `Timed out after ${FETCH_TIMEOUT_MS / 1000}s fetching ${url}. The host accepted no complete response in time (large PDF, slow server, or bot wall). Retry once; if it keeps timing out, treat the source as unusable or score an archived copy. ${seeDocs("fetch-times-out")}`;
  }
  const code = errorCode(err);
  const detail = err instanceof Error ? `${err.message}${code ? ` (${code})` : ""}` : String(err);
  switch (code) {
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return `Could not resolve host "${host}" (${code}). Check the URL for typos; if the server runs in a container or sandbox, confirm it has DNS and outbound network access, and behind an HTTP proxy start Node with NODE_USE_ENV_PROXY=1. ${seeDocs("fetch-fails-with-a-network-error")}`;
    case "ECONNREFUSED":
    case "ECONNRESET":
    case "ETIMEDOUT":
    case "EHOSTUNREACH":
    case "ENETUNREACH":
    case "UND_ERR_CONNECT_TIMEOUT":
    case "UND_ERR_SOCKET":
      return `Network error reaching "${host}" (${code}). The host refused or dropped the connection, or outbound traffic is blocked (firewall, proxy, container network policy). ${seeDocs("fetch-fails-with-a-network-error")}`;
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "UNABLE_TO_GET_ISSUER_CERT_LOCALLY":
    case "SELF_SIGNED_CERT_IN_CHAIN":
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "CERT_HAS_EXPIRED":
    case "ERR_TLS_CERT_ALTNAME_INVALID":
      return `TLS certificate check failed for "${host}" (${code}). If a corporate proxy re-signs HTTPS, point NODE_EXTRA_CA_CERTS at its CA bundle; never disable TLS verification. ${seeDocs("fetch-fails-with-a-network-error")}`;
    default:
      return `Fetching ${url} failed: ${detail}. ${seeDocs("fetch-fails-with-a-network-error")}`;
  }
}

/** Trailing slash, scheme and host case differ often between what was scored and what is cited. */
function normalizeUrlForMatch(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.toLowerCase()}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  } catch {
    return url;
  }
}

/** Run a tool handler with start/finish logging; unexpected throws become actionable tool errors. */
function logged<A>(tool: string, handler: (args: A) => Promise<ReturnType<typeof toolError> | { content: Array<{ type: "text"; text: string }> }>) {
  return async (args: A) => {
    const started = Date.now();
    log.debug("tool.start", { tool, args });
    try {
      const result = await handler(args);
      const isError = "isError" in result && result.isError === true;
      (isError ? log.warn : log.info)("tool.finish", {
        tool,
        ok: !isError,
        durationMs: Date.now() - started,
        ...(isError ? { error: result.content[0]?.text } : {}),
      });
      return result;
    } catch (err) {
      log.error("tool.crash", { tool, durationMs: Date.now() - started, err });
      return toolError(
        `${tool} hit an unexpected internal error: ${(err as Error)?.message ?? String(err)}. This is a bug, not a problem with your input — please file it with the stderr log lines (set RESEARCH_SCOPE_LOG_LEVEL=debug). ${seeDocs("reporting-a-bug")}`
      );
    }
  };
}

async function fetchSource(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<{ status: number; title: string; text: string; headers: Record<string, string>; finalUrl: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": `research-scope-mcp/${version} (+research-scoring)`,
        accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
      },
    });
    const contentType = res.headers.get("content-type") ?? "";
    const raw = await res.text();
    const isHtml = contentType.includes("html");
    const titleMatch = isHtml ? raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i) : null;
    return {
      status: res.status,
      title: titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim() : "",
      text: isHtml ? htmlToText(raw) : raw.slice(0, 200_000),
      headers: {
        "content-type": contentType,
        "last-modified": res.headers.get("last-modified") ?? "",
        date: res.headers.get("date") ?? "",
      },
      finalUrl: res.url || url,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Extract claim-looking sentences from markdown ("claims" = assertion-bearing lines). */
function extractClaims(markdown: string): Array<{ claim: string; claimId: string; sourceUrls: string[] }> {
  const claims: StoredReport["claims"] = [];
  const lines = markdown.split("\n");
  // skip the citation registry section itself
  const cutoff = Math.max(0, lines.findIndex((l) => /^## Citation registry/i.test(l)));
  lines.slice(0, cutoff > 0 ? cutoff : lines.length).forEach((line, i) => {
    const trimmed = line.trim();
    const isHeading = /^#{1,6}\s/.test(trimmed);
    const isListItem = /^[-*]\s/.test(trimmed);
    const isBlockqualte = /^>/.test(trimmed);
    void isBlockqualte;
    if (!trimmed || isHeading) return;
    // Template boilerplate never counts as a claim: the shell's own instruction
    // preamble (italic _…_ lines) and HTML example comments are not authored
    // findings, so check_report must not orphan them.
    const isTemplateComment = trimmed.startsWith("<!--");
    const isTemplatePreamble = trimmed.startsWith("_") && trimmed.endsWith("_");
    if (isTemplateComment || isTemplatePreamble) return;
    const body = isListItem ? trimmed.slice(2) : trimmed;
    // only substantive assertion sentences
    if (body.length < 40) return;
    const citations = [...body.matchAll(/\[S(\d+)\]/g)].map((m) => `S${m[1]}`);
    claims.push({
      claim: body.replace(/\[S\d+\]/g, "").trim(),
      claimId: `C${i}`,
      sourceUrls: citations,
    });
  });
  return claims;
}

function renderReportShell(topic: string, sources: PaperTrailEntry[]): string {
  const lines: string[] = [];
  lines.push(`# Research report — ${topic}`);
  lines.push("");
  lines.push(`_Generated by research-scope-mcp ${version} on ${new Date().toISOString().slice(0, 10)}._`);
  lines.push("_Every claim below must cite at least one scored source. Claims without a `[Sn]` citation fail `check_report`._");
  lines.push("");
  lines.push("## Claims");
  lines.push("");
  lines.push("<!-- Write findings here as bullets or short paragraphs, citing sources as [S1], [S2], ... -->");
  lines.push("<!-- Example: The 2025 exam redesign moved EMT testing to CAT with 70–120 items [S2]. -->");
  lines.push("");
  lines.push("## Citation registry");
  lines.push("");
  sources.forEach((s, i) => {
    lines.push(`[S${i + 1}] ${s.url} — score ${s.score}/100 (${s.grade}${s.publishedAt ? `, published ${s.publishedAt}` : ", no date"})`);
  });
  lines.push("");
  lines.push("## Scoring appendix");
  lines.push("");
  sources.forEach((s, i) => {
    lines.push(`### [S${i + 1}] flags`);
    lines.push(s.flags.length ? s.flags.join(", ") : "none");
    lines.push("");
  });
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* server                                                              */
/* ------------------------------------------------------------------ */

// Factory (not a singleton): the Streamable HTTP transport is stateless and
// requires a fresh server + transport pair per request. Shared in-memory
// registries (scoreRegistry, reports) live at module scope, so every instance
// sees the same scores/reports.
function buildServer(): McpServer {
  const server: McpServer = new McpServer(
  { name: "research-scope-mcp", version },
  {
    instructions:
      "Research-to-report workflow. Use plan_research first, then fetch_and_score each candidate source, then build_report, then check_report before presenting findings.",
  }
);

/* --- tool 1: plan_research ---------------------------------------- */

server.registerTool(
  "plan_research",
  {
    title: "Plan research scope",
    description:
      "Turn a research scope into a source-target plan with kill criteria: primary-source targets, corroborating targets, and when to abandon the topic for lack of sources.",
    inputSchema: {
      scope: z.string().min(3).describe("What is being researched, e.g. 'verify vendor claim about NREMT 2025 exam change'"),
      domain_hints: z.array(z.string()).optional().describe("Suggested source domains, e.g. ['.gov', 'arxiv.org']"),
    },
  },
  logged("plan_research", async ({ scope, domain_hints }: { scope: string; domain_hints?: string[] }) => {
    const hints = domain_hints?.length ? domain_hints : [".gov", ".edu", "arxiv.org", "press"];
    const plan = {
      scope,
      generatedAt: new Date().toISOString(),
      primarySourceTargets: [
        { what: "The original claim-maker's own statement (press release, changelog, official filing)", why: "anchors what is actually claimed, before anyone's summary of it" },
        { what: `Any regulator / standards body page covering the domain (${hints[0]})`, why: "highest-weight primary host in the scorer" },
      ],
      corroboratingTargets: [
        { what: "Two independent secondary reports citing different primaries", why: "cross-check that the primary claim wasn't retracted or misread" },
        { what: "A dated community thread (forum, mailing list archive) for on-the-ground reaction", why: "flags practical impact the official pages omit" },
      ],
      antiTargets: [
        "sponsored posts, affiliate round-ups, pages with 'in partnership with'",
        "undated aggregator rewrites",
      ],
      killCriteria: [
        "Fewer than 1 primary + 2 independent secondaries found after checking all target hosts -> stop, report 'insufficient sources' rather than proceeding on thin evidence",
        "Every scored source below 45/100 -> stop",
        "Primary source is paywalled AND no archived copy is retrievable -> mark claim unverifiable",
      ],
    };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(plan, null, 2) }],
    };
  })
);

/* --- tool 2: fetch_and_score -------------------------------------- */

server.registerTool(
  "fetch_and_score",
  {
    title: "Fetch and score a source",
    description:
      "Crawl one source URL and return an explainable 0-100 quality score: primary-source detection, publication freshness, paywall and conflict-of-interest flags. Scores are registered for use in build_report/check_report.",
    inputSchema: {
      source_url: z.string().url().describe("The source URL to fetch and score"),
    },
  },
  logged("fetch_and_score", async ({ source_url }: { source_url: string }) => {
    const started = Date.now();
    let fetched: Awaited<ReturnType<typeof fetchSource>>;
    try {
      fetched = await fetchSource(source_url);
    } catch (err) {
      log.warn("fetch.failed", { url: source_url, durationMs: Date.now() - started, code: errorCode(err), err });
      return toolError(describeFetchError(source_url, err));
    }
    log.info("fetch.done", {
      url: source_url,
      finalUrl: fetched.finalUrl,
      status: fetched.status,
      contentType: fetched.headers["content-type"],
      textChars: fetched.text.length,
      durationMs: Date.now() - started,
    });
    if (fetched.status !== 200) {
      log.warn("fetch.non_200", {
        url: source_url,
        status: fetched.status,
        hint:
          fetched.status === 401 || fetched.status === 403 || fetched.status === 429
            ? "likely a bot wall or rate limit rather than a dead page; the source scores 0/D"
            : "page not retrievable; the source scores 0/D",
      });
    }
    const score = scoreSource({
      url: fetched.finalUrl,
      title: fetched.title,
      text: fetched.text,
      headers: fetched.headers,
      status: fetched.status,
    });
    scoreRegistry.set(fetched.finalUrl, score);
    scoreRegistry.set(source_url, score); // index under the requested URL too
    log.debug("score.registered", { url: source_url, finalUrl: fetched.finalUrl, score: score.score, grade: score.grade, flags: score.flags });
    return {
      content: [{ type: "text" as const, text: JSON.stringify(score, null, 2) }],
    };
  })
);

/* --- tool 3: build_report ----------------------------------------- */

server.registerTool(
  "build_report",
  {
    title: "Build citation-registry report shell",
    description:
      "Assemble a report shell from already-scored sources: claims section stubs, numbered citation registry, scoring appendix. Returns the markdown and saves it under data/reports/.",
    inputSchema: {
      topic: z.string().min(3).describe("Report topic / title"),
      sources: z.array(z.string().url()).min(1).describe("Source URLs previously scored with fetch_and_score"),
    },
  },
  logged("build_report", async ({ topic, sources }: { topic: string; sources: string[] }) => {
    const entries: PaperTrailEntry[] = [];
    const missing: string[] = [];
    for (const url of sources) {
      const s = scoreRegistry.get(url);
      if (!s) {
        missing.push(url);
        continue;
      }
      entries.push({ url: s.url, score: s.score, grade: s.grade, publishedAt: s.publishedAt, flags: s.flags, scoredAt: s.scoredAt });
    }
    if (missing.length) {
      // Point at near-misses (trailing slash, host case, redirect target) so the
      // caller can fix the citation instead of re-fetching.
      const scored = [...scoreRegistry.keys()];
      const lines = missing.map((url) => {
        const near = scored.find((k) => normalizeUrlForMatch(k) === normalizeUrlForMatch(url));
        return near ? `${url}  (did you mean ${near}? URLs must match exactly)` : url;
      });
      const empty = scoreRegistry.size === 0
        ? "\nNo sources are scored in this server process at all. Scores live in memory only: they are lost when the server restarts, and the HTTP transport shares them only within one running process."
        : "";
      return toolError(
        `These URLs were never scored — run fetch_and_score on them first, then pass the exact same URLs to build_report:\n${lines.join("\n")}${empty}\n${seeDocs("build_report-says-a-url-was-never-scored")}`
      );
    }
    const reportsDir = pathResolve(DATA_DIR, "reports");
    try {
      mkdirSync(reportsDir, { recursive: true });
    } catch (err) {
      log.error("report.mkdir_failed", { dir: reportsDir, code: errorCode(err), err });
      return toolError(
        `Cannot create the report directory ${reportsDir} (${errorCode(err) ?? (err as Error).message}). ${process.env.RESEARCH_SCOPE_DATA_DIR ? "RESEARCH_SCOPE_DATA_DIR points there; change it" : "RESEARCH_SCOPE_DATA_DIR is unset, so the data dir is ./data under the directory the client launched the server from, which is often read-only. Set RESEARCH_SCOPE_DATA_DIR"} to a writable absolute path in the client's MCP config. ${seeDocs("report-directory-is-not-writable")}`
      );
    }
    const id = randomUUID().slice(0, 8);
    const markdown = renderReportShell(topic, entries);
    const report: StoredReport = {
      id,
      topic,
      createdAt: new Date().toISOString(),
      sources: entries,
      claims: [],
      markdown,
    };
    reports.set(id, report);
    const reportPath = pathResolve(reportsDir, `report-${id}.md`);
    try {
      writeFileSync(reportPath, markdown, "utf8");
    } catch (err) {
      log.error("report.write_failed", { path: reportPath, code: errorCode(err), err });
      return toolError(
        `Cannot write ${reportPath} (${errorCode(err) ?? (err as Error).message}). Set RESEARCH_SCOPE_DATA_DIR to a writable absolute path. ${seeDocs("report-directory-is-not-writable")}`
      );
    }
    log.info("report.built", { id, path: reportPath, sources: entries.length });
    const registryLine = entries.map((e, i) => `[S${i + 1}] ${e.url} (${e.score}/100, ${e.grade})`).join("\n");
    return {
      content: [
        {
          type: "text" as const,
          text: `Report shell ${id} saved to ${reportPath}\n\n---\n${markdown.replace(registryLine, registryLine)}\n---\n\nCitation registry:\n${registryLine}\nUse these [Sn] numbers when writing claims, then run check_report.`,
        },
      ],
    };
  })
);

/* --- tool 4: check_report ----------------------------------------- */

server.registerTool(
  "check_report",
  {
    title: "Check report citation coverage",
    description:
      "Verify every substantive claim in a report cites at least one scored source. Orphan claims are returned as an error list — never a pass. Accepts a report id (as built) or a markdown file path.",
    inputSchema: {
      report_id: z.string().optional().describe("Report id returned by build_report"),
      report_path: z.string().optional().describe("Path to a report markdown file (overrides report_id)"),
    },
  },
  logged("check_report", async ({ report_id, report_path }: { report_id?: string; report_path?: string }) => {
    let markdown: string | null = null;
    let label = report_id ?? report_path ?? "";
    let note: string | undefined;
    if (report_path) {
      const p = pathResolve(report_path);
      if (!existsSync(p)) {
        const relative = p !== report_path ? ` Relative paths resolve against the server's working directory (${process.cwd()}), not the client's — pass an absolute path.` : "";
        return toolError(`Report file not found: ${p}.${relative} ${seeDocs("check_report-cannot-find-the-report")}`);
      }
      try {
        markdown = readFileSync(p, "utf8");
      } catch (err) {
        return toolError(`Cannot read report file ${p} (${errorCode(err) ?? (err as Error).message}). report_path must point at a readable markdown file, not a directory. ${seeDocs("check_report-cannot-find-the-report")}`);
      }
      label = p;
    } else if (report_id && reports.has(report_id)) {
      // report_id checks the shell as build_report produced it; edits made to the
      // saved file are only seen via report_path.
      markdown = reports.get(report_id)!.markdown;
      label = report_id;
      note = "Checked the in-memory shell for this report_id, not the file on disk. If you edited the saved report, re-run check_report with report_path.";
    } else if (report_id) {
      return toolError(
        `Unknown report_id "${report_id}". Report ids live in memory only, so they are lost when the server restarts; the in-memory copy is also the unedited shell. Pass report_path with the absolute path build_report printed (${pathResolve(DATA_DIR, "reports", `report-${report_id}.md`)}) to check your edited file. ${seeDocs("check_report-cannot-find-the-report")}`
      );
    } else {
      return toolError("Provide either report_id (from build_report) or report_path (absolute path to the report markdown file).");
    }

    const claims = extractClaims(markdown ?? "");
    const orphan = claims.filter((c) => c.sourceUrls.length === 0);
    const ok = orphan.length === 0 && claims.length > 0;
    const verdict = ok
      ? "PASS — every claim cites a scored source"
      : claims.length === 0
        ? "FAIL — no substantive claims found. Write findings (40+ characters each) under ## Claims, citing [Sn] numbers from the citation registry, then re-run check_report."
        : "FAIL — orphan claims above cite no scored source; add a [Sn] citation from the registry or remove them";
    log.info("report.checked", { report: label, pass: ok, claimsFound: claims.length, orphanClaims: orphan.length });

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              report: label,
              pass: ok,
              claimsFound: claims.length,
              claimsCited: claims.length - orphan.length,
              orphanClaims: orphan.length ? orphan : "none",
              verdict,
              ...(note ? { note } : {}),
            },
            null,
            2
          ),
        },
      ],
    };
  })
);
  return server;
}

// stdio keeps one long-lived server for the process lifetime.
const server: McpServer = buildServer();

/* ------------------------------------------------------------------ */
/* transports                                                          */
/* ------------------------------------------------------------------ */

async function runStdio(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info("server.start", { version, transport: "stdio", dataDir: DATA_DIR, pid: process.pid });
  // stdio keeps the process alive until the client closes the pipe
}

function runHttp(port: number): void {
  // Stateless Streamable HTTP: the SDK requires a fresh transport per request
  // (a reused stateless transport throws "cannot be reused across requests"
  // from the second request on, which surfaced as silent 500s). Mirror the
  // SDK's official stateless example: new server + new transport per request,
  // both closed when the response ends. Module-scope registries keep state.
  const httpServer = createHttpServer((req, res) => {
    const requestId = randomUUID().slice(0, 8);
    const started = Date.now();
    res.on("finish", () => {
      log.debug("http.request", { requestId, method: req.method, path: req.url, status: res.statusCode, durationMs: Date.now() - started });
    });
    void (async () => {
      try {
        const requestServer = buildServer();
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        res.on("close", () => {
          void transport.close();
          if (requestServer) {
            void requestServer.close();
          }
        });
        await requestServer.connect(transport);
        await transport.handleRequest(req, res);
        // Note: closing the pair here (after a completed request) would race
        // clients that keep SSE streams open; the "close" listener owns teardown.
      } catch (err) {
        log.error("http.request_failed", { requestId, method: req.method, path: req.url, err });
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader("content-type", "application/json");
        }
        // -32603 = JSON-RPC internal error (this is not a parse error)
        const payload = JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32603, message: `Internal server error: ${(err as Error).message}`, data: { requestId } },
        });
        if (!res.writableEnded) {
          res.end(payload);
        } else {
          res.destroy();
        }
      }
    })();
  });
  httpServer.on("error", (err) => {
    const code = errorCode(err);
    const hint =
      code === "EADDRINUSE"
        ? `port ${port} is already in use — stop the other process or pass --port <free port>`
        : code === "EACCES"
          ? `not allowed to bind port ${port} — use a port above 1024 or run with the needed privileges`
          : "could not start the HTTP listener";
    log.error("server.listen_failed", { port, code, hint, err });
    process.exit(1);
  });
  httpServer.listen(port, () => {
    const addr = httpServer.address();
    const bound = typeof addr === "object" && addr ? `${addr.address}:${addr.port}` : String(port);
    log.info("server.start", { version, transport: "http", url: `http://${bound}/mcp`, dataDir: DATA_DIR, pid: process.pid });
  });
}

/* --- entry -------------------------------------------------------- */

process.on("unhandledRejection", (reason) => {
  log.error("process.unhandled_rejection", { err: reason });
});
process.on("uncaughtException", (err) => {
  log.error("process.uncaught_exception", { err });
  process.exit(1);
});

function parsePort(args: string[]): number {
  const portIdx = args.indexOf("--port");
  const raw = portIdx >= 0 ? args[portIdx + 1] : process.env.PORT;
  if (raw === undefined || raw === "") return 3001;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    log.error("server.invalid_port", {
      value: raw,
      source: portIdx >= 0 ? "--port" : "PORT",
      hint: "port must be an integer between 1 and 65535, e.g. --port 3001",
    });
    process.exit(2);
  }
  return port;
}

const args = process.argv.slice(2);
if (args.includes("--http")) {
  runHttp(parsePort(args));
} else {
  runStdio().catch((err) => {
    log.error("server.start_failed", { transport: "stdio", err });
    process.exit(1);
  });
}
