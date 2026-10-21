/**
 * research-scope-mcp — MCP server definition and transports
 *
 * Tools:
 *   plan_research(scope)            -> source-target plan with kill criteria
 *   fetch_and_score(source_url)     -> crawl + quality score of a single source
 *   build_report(topic, sources[])  -> citation-registry report shell (markdown)
 *   check_report(report_id|path)    -> every claim must cite >=1 scored source
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import { scoreSource, type SourceScore } from "./scoring/score.js";
import { fetchSource, isHttpUrl, type FetchOptions } from "./fetch.js";
import { checkReportMarkdown, renderReportShell, type PaperTrailEntry } from "./report.js";
import { version } from "./version.js";

/* ------------------------------------------------------------------ */
/* state                                                               */
/* ------------------------------------------------------------------ */

interface StoredReport {
  id: string;
  topic: string;
  createdAt: string;
  path: string;
  sources: PaperTrailEntry[];
  markdown: string;
}

/**
 * Shared in-memory registries. The Streamable HTTP transport builds a fresh
 * McpServer per request, so state lives here rather than on the server.
 */
export interface ServerState {
  dataDir: string;
  fetchOptions: FetchOptions;
  scores: Map<string, SourceScore>;
  reports: Map<string, StoredReport>;
}

export function createState(options: { dataDir?: string; fetchOptions?: FetchOptions } = {}): ServerState {
  return {
    dataDir: pathResolve(options.dataDir ?? process.env.RESEARCH_SCOPE_DATA_DIR ?? pathResolve(process.cwd(), "data")),
    fetchOptions: options.fetchOptions ?? {},
    scores: new Map(),
    reports: new Map(),
  };
}

const REPORT_ID = /^[A-Za-z0-9_-]{1,64}$/;

function reportsDir(state: ServerState): string {
  return pathResolve(state.dataDir, "reports");
}

function textResult(text: string, isError = false) {
  return { ...(isError ? { isError: true } : {}), content: [{ type: "text" as const, text }] };
}

const httpUrl = z
  .string()
  .url()
  .refine(isHttpUrl, { message: "Only http:// and https:// URLs are supported" });

/* ------------------------------------------------------------------ */
/* server                                                              */
/* ------------------------------------------------------------------ */

export function buildServer(state: ServerState): McpServer {
  const server = new McpServer(
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
        scope: z.string().trim().min(3).describe("What is being researched, e.g. 'verify vendor claim about NREMT 2025 exam change'"),
        domain_hints: z.array(z.string()).optional().describe("Suggested source domains, e.g. ['.gov', 'arxiv.org']"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ scope, domain_hints }) => {
      const hints = domain_hints?.map((h) => h.trim()).filter(Boolean);
      const domains = hints?.length ? hints : [".gov", ".edu", "arxiv.org", "press"];
      const plan = {
        scope,
        generatedAt: new Date().toISOString(),
        domainHints: domains,
        primarySourceTargets: [
          { what: "The original claim-maker's own statement (press release, changelog, official filing)", why: "anchors what is actually claimed, before anyone's summary of it" },
          { what: `Any regulator / standards body page covering the domain (${domains.join(", ")})`, why: "highest-weight primary host in the scorer" },
        ],
        corroboratingTargets: [
          { what: "Two independent secondary reports citing different primaries", why: "cross-check that the primary claim wasn't retracted or misread" },
          { what: "A dated community thread (forum, mailing list archive) for on-the-ground reaction", why: "flags practical impact the official pages omit" },
        ],
        antiTargets: ["sponsored posts, affiliate round-ups, pages with 'in partnership with'", "undated aggregator rewrites"],
        killCriteria: [
          "Fewer than 1 primary + 2 independent secondaries found after checking all target hosts -> stop, report 'insufficient sources' rather than proceeding on thin evidence",
          "Every scored source below 45/100 -> stop",
          "Primary source is paywalled AND no archived copy is retrievable -> mark claim unverifiable",
        ],
      };
      return textResult(JSON.stringify(plan, null, 2));
    }
  );

  /* --- tool 2: fetch_and_score -------------------------------------- */

  server.registerTool(
    "fetch_and_score",
    {
      title: "Fetch and score a source",
      description:
        "Crawl one source URL and return an explainable 0-100 quality score: primary-source detection, publication freshness, paywall and conflict-of-interest flags. Scores are registered for use in build_report/check_report.",
      inputSchema: {
        source_url: httpUrl.describe("The http(s) source URL to fetch and score"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ source_url }) => {
      let fetched;
      try {
        fetched = await fetchSource(source_url, state.fetchOptions);
      } catch (err) {
        return textResult(`${(err as Error).message}\nThe source was not scored. Retry once; if it keeps failing, treat it as unusable.`, true);
      }
      const score = scoreSource({
        url: fetched.finalUrl,
        title: fetched.title,
        text: fetched.text,
        headers: fetched.headers,
        status: fetched.status,
        publishedHint: fetched.publishedHint,
      });
      if (fetched.truncated) score.flags.push("truncated");
      state.scores.set(fetched.finalUrl, score);
      state.scores.set(source_url, score); // index under the requested URL too
      return textResult(JSON.stringify(score, null, 2));
    }
  );

  /* --- tool 3: build_report ----------------------------------------- */

  server.registerTool(
    "build_report",
    {
      title: "Build citation-registry report shell",
      description:
        "Assemble a report shell from already-scored sources: claims section stubs, numbered citation registry, scoring appendix. Returns the markdown and saves it under data/reports/.",
      inputSchema: {
        topic: z.string().trim().min(3).describe("Report topic / title"),
        sources: z.array(z.string().url()).min(1).describe("Source URLs previously scored with fetch_and_score"),
      },
    },
    async ({ topic, sources }) => {
      const entries: PaperTrailEntry[] = [];
      const missing: string[] = [];
      const seen = new Set<string>();
      for (const url of sources) {
        const s = state.scores.get(url);
        if (!s) {
          missing.push(url);
          continue;
        }
        // A URL and its redirect target resolve to the same score: list it once.
        if (seen.has(s.url)) continue;
        seen.add(s.url);
        entries.push({ url: s.url, score: s.score, grade: s.grade, publishedAt: s.publishedAt, flags: s.flags, scoredAt: s.scoredAt });
      }
      if (missing.length) {
        return textResult(`These URLs were never scored — run fetch_and_score on them first:\n${missing.join("\n")}`, true);
      }

      const dir = reportsDir(state);
      mkdirSync(dir, { recursive: true });
      const id = randomUUID().slice(0, 8);
      // Keep the title on one line so it can't inject headings into the shell.
      const markdown = renderReportShell(topic.replace(/\s+/g, " "), entries);
      const reportPath = pathResolve(dir, `report-${id}.md`);
      writeFileSync(reportPath, markdown, "utf8");
      state.reports.set(id, { id, topic, createdAt: new Date().toISOString(), path: reportPath, sources: entries, markdown });

      const registry = entries.map((e, i) => `[S${i + 1}] ${e.url} (${e.score}/100, ${e.grade})`).join("\n");
      return textResult(
        `Report shell ${id} saved to ${reportPath}\n\n---\n${markdown}\n---\n\nCitation registry:\n${registry}\n` +
          `Write claims into that file using these [Sn] numbers, then run check_report with report_id "${id}".`
      );
    }
  );

  /* --- tool 4: check_report ----------------------------------------- */

  server.registerTool(
    "check_report",
    {
      title: "Check report citation coverage",
      description:
        "Verify every substantive claim in a report cites at least one scored source from its citation registry. Orphan claims and citations to unknown [Sn] ids are returned as an error list — never a pass. Accepts a report id (as built) or a markdown file path.",
      inputSchema: {
        report_id: z.string().optional().describe("Report id returned by build_report (checks the saved file, including your edits)"),
        report_path: z.string().optional().describe("Path to a report markdown file (overrides report_id)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ report_id, report_path }) => {
      let markdown: string;
      let label: string;
      if (report_path) {
        const p = pathResolve(report_path);
        if (!existsSync(p)) return textResult(`Report file not found: ${p}`, true);
        markdown = readFileSync(p, "utf8");
        label = p;
      } else if (report_id) {
        if (!REPORT_ID.test(report_id)) return textResult(`Invalid report_id: ${JSON.stringify(report_id)}`, true);
        // Read the saved file so edits made after build_report are what gets
        // checked; it also survives a server restart.
        const p = state.reports.get(report_id)?.path ?? pathResolve(reportsDir(state), `report-${report_id}.md`);
        if (existsSync(p)) markdown = readFileSync(p, "utf8");
        else if (state.reports.has(report_id)) markdown = state.reports.get(report_id)!.markdown;
        else return textResult(`Unknown report_id "${report_id}": no report-${report_id}.md under ${reportsDir(state)}`, true);
        label = report_id;
      } else {
        return textResult("Provide either report_id (from build_report) or report_path.", true);
      }

      const result = checkReportMarkdown(markdown);
      return textResult(JSON.stringify({ report: label, ...result }, null, 2));
    }
  );

  return server;
}

/* ------------------------------------------------------------------ */
/* Streamable HTTP                                                     */
/* ------------------------------------------------------------------ */

export interface HttpOptions {
  port: number;
  host: string;
  state: ServerState;
}

/**
 * Stateless Streamable HTTP on /mcp (plus GET /healthz). The SDK requires a
 * fresh transport per request in stateless mode (a reused one throws "cannot
 * be reused across requests"), so each request gets its own server +
 * transport pair, torn down when the response closes. ServerState keeps
 * scores and reports across requests.
 */
export function createMcpHttpServer(state: ServerState): HttpServer {
  return createHttpServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (path === "/healthz" && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ status: "ok", name: "research-scope-mcp", version }));
      return;
    }
    if (path !== "/mcp") {
      res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "Not found. The MCP endpoint is /mcp." }));
      return;
    }
    void (async () => {
      try {
        const requestServer = buildServer(state);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        res.on("close", () => {
          void transport.close();
          void requestServer.close();
        });
        await requestServer.connect(transport);
        await transport.handleRequest(req, res);
      } catch (err) {
        if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
        const payload = JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32603, message: (err as Error).message } });
        if (!res.writableEnded) res.end(payload);
        else res.destroy();
      }
    })();
  });
}

export function runHttp({ port, host, state }: HttpOptions): Promise<HttpServer> {
  const httpServer = createMcpHttpServer(state);
  return new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => {
      httpServer.off("error", reject);
      const addr = httpServer.address();
      const bound = typeof addr === "object" && addr ? `${addr.address.includes(":") ? `[${addr.address}]` : addr.address}:${addr.port}` : String(port);
      // stdout is reserved for protocol traffic in stdio mode; log to stderr everywhere
      console.error(`research-scope-mcp ${version} listening (Streamable HTTP) on http://${bound}/mcp`);
      resolve(httpServer);
    });
  });
}
