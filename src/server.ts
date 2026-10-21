/**
 * research-scope-mcp — MCP server factory and HTTP handler.
 *
 * Research-to-report workflow: plan sources with kill criteria, fetch-and-score
 * them, assemble a citation-registry report shell, then verify every claim has a
 * scored source.
 *
 * Tools:
 *   plan_research(scope)            -> source-target plan with kill criteria
 *   fetch_and_score(source_url)     -> crawl + quality score of a single source
 *   build_report(topic, sources[])  -> citation-registry report shell (markdown)
 *   check_report(report_path)       -> every claim must cite >=1 scored source
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve as pathResolve, relative as pathRelative, isAbsolute } from "node:path";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse, type Server as HttpServer } from "node:http";
import { randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import { scoreSource, type SourceScore } from "./scoring/score.js";
import { fetchSource, FetchError } from "./fetch.js";
import { checkReportMarkdown, renderReportShell, type PaperTrailEntry } from "./report.js";
import { version } from "./version.js";

/* ------------------------------------------------------------------ */
/* state                                                               */
/* ------------------------------------------------------------------ */

export interface ServerState {
  dataDir: string;
  /** When true, check_report only reads files inside dataDir (set for network transports). */
  restrictPathsToDataDir: boolean;
  scores: Map<string, SourceScore>;
  /** report id -> path of the saved markdown */
  reports: Map<string, string>;
}

export function defaultDataDir(): string {
  return pathResolve(process.env.RESEARCH_SCOPE_DATA_DIR ?? pathResolve(process.cwd(), "data"));
}

export function createState(options: Partial<Pick<ServerState, "dataDir" | "restrictPathsToDataDir">> = {}): ServerState {
  return {
    dataDir: pathResolve(options.dataDir ?? defaultDataDir()),
    restrictPathsToDataDir: options.restrictPathsToDataDir ?? false,
    scores: new Map(),
    reports: new Map(),
  };
}

function isInside(dir: string, p: string): boolean {
  const rel = pathRelative(dir, p);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

const textResult = (text: string) => ({ content: [{ type: "text" as const, text }] });
const errorResult = (text: string) => ({ isError: true, content: [{ type: "text" as const, text }] });

/* ------------------------------------------------------------------ */
/* server                                                              */
/* ------------------------------------------------------------------ */

// Factory (not a singleton): the Streamable HTTP transport is stateless and
// requires a fresh server + transport pair per request. The shared state
// (scores, reports) is passed in, so every instance sees the same registries.
export function buildServer(state: ServerState = createState()): McpServer {
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
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ scope, domain_hints }) => {
      const hints = domain_hints?.length ? domain_hints : [".gov", ".edu", "arxiv.org", "press"];
      const plan = {
        scope,
        generatedAt: new Date().toISOString(),
        primarySourceTargets: [
          { what: "The original claim-maker's own statement (press release, changelog, official filing)", why: "anchors what is actually claimed, before anyone's summary of it" },
          { what: `Any regulator / standards body page covering the domain (${hints.join(", ")})`, why: "highest-weight primary host in the scorer" },
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
        source_url: z.string().url().describe("The http(s) source URL to fetch and score"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ source_url }) => {
      let fetched;
      try {
        fetched = await fetchSource(source_url);
      } catch (err) {
        if (err instanceof FetchError) return errorResult(err.message);
        throw err;
      }
      const score = scoreSource({
        url: fetched.finalUrl,
        title: fetched.title,
        text: fetched.text,
        metaPublished: fetched.metaPublished,
        headers: fetched.headers,
        status: fetched.status,
      });
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
        topic: z.string().min(3).describe("Report topic / title"),
        sources: z.array(z.string().url()).min(1).describe("Source URLs previously scored with fetch_and_score"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
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
        if (seen.has(s.url)) continue; // same source listed twice (or via its redirect target)
        seen.add(s.url);
        entries.push({ url: s.url, score: s.score, grade: s.grade, publishedAt: s.publishedAt, flags: s.flags, scoredAt: s.scoredAt });
      }
      if (missing.length) {
        return errorResult(`These URLs were never scored — run fetch_and_score on them first:\n${missing.join("\n")}`);
      }
      const reportsDir = pathResolve(state.dataDir, "reports");
      if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });
      const id = randomUUID().slice(0, 8);
      const markdown = renderReportShell(topic, entries);
      const reportPath = pathResolve(reportsDir, `report-${id}.md`);
      writeFileSync(reportPath, markdown, "utf8");
      state.reports.set(id, reportPath);
      const registryLines = entries.map((e, i) => `[S${i + 1}] ${e.url} (${e.score}/100, ${e.grade})`).join("\n");
      return textResult(
        `Report shell ${id} saved to ${reportPath}\n\n---\n${markdown}\n---\n\nCitation registry:\n${registryLines}\nUse these [Sn] numbers when writing claims, then run check_report.`
      );
    }
  );

  /* --- tool 4: check_report ----------------------------------------- */

  server.registerTool(
    "check_report",
    {
      title: "Check report citation coverage",
      description:
        "Verify every substantive claim in a report cites at least one scored source from its citation registry. Orphan claims and citations to unknown [Sn] ids are returned as an error list — never a pass. Accepts a report id (as built) or a markdown file path; the file on disk is always what gets checked, so edits are picked up.",
      inputSchema: {
        report_id: z.string().optional().describe("Report id returned by build_report"),
        report_path: z.string().optional().describe("Path to a report markdown file (overrides report_id)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ report_id, report_path }) => {
      let p: string;
      if (report_path) {
        p = pathResolve(report_path);
        if (state.restrictPathsToDataDir && !isInside(state.dataDir, p)) {
          return errorResult(`report_path must be inside the server data directory (${state.dataDir}) on this transport.`);
        }
      } else if (report_id) {
        const known = state.reports.get(report_id) ?? pathResolve(state.dataDir, "reports", `report-${report_id}.md`);
        if (!/^[\w-]+$/.test(report_id) || !existsSync(known)) {
          return errorResult(`Unknown report_id "${report_id}" — use the id returned by build_report, or pass report_path.`);
        }
        p = known;
      } else {
        return errorResult("Provide either report_id (from build_report) or report_path.");
      }
      if (!existsSync(p)) return errorResult(`Report file not found: ${p}`);

      const result = checkReportMarkdown(readFileSync(p, "utf8"));
      return textResult(
        JSON.stringify(
          {
            report: report_path ? p : report_id,
            pass: result.pass,
            claimsFound: result.claimsFound,
            claimsCited: result.claimsCited,
            orphanClaims: result.orphanClaims.length ? result.orphanClaims : "none",
            unknownCitations: result.unknownCitations.length ? result.unknownCitations : "none",
            verdict: result.verdict,
          },
          null,
          2
        )
      );
    }
  );

  return server;
}

/* ------------------------------------------------------------------ */
/* Streamable HTTP                                                     */
/* ------------------------------------------------------------------ */

export function createHttpHandler(state: ServerState): (req: IncomingMessage, res: ServerResponse) => void {
  // Stateless Streamable HTTP: the SDK requires a fresh transport per request
  // (a reused stateless transport throws "cannot be reused across requests"
  // from the second request on, which surfaced as silent 500s). Mirror the
  // SDK's official stateless example: new server + new transport per request,
  // both closed when the response ends. The shared state keeps registries.
  return (req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (path === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ status: "ok", name: "research-scope-mcp", version }));
      return;
    }
    if (path !== "/mcp") {
      res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "not found; the MCP endpoint is /mcp" }));
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
        // Note: closing the pair here (after a completed request) would race
        // clients that keep SSE streams open; the "close" listener owns teardown.
      } catch (err) {
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader("content-type", "application/json");
        }
        const payload = JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: (err as Error).message }, id: null });
        if (!res.writableEnded) res.end(payload);
        else res.destroy();
      }
    })();
  };
}

export function startHttpServer(port: number, host: string, state: ServerState): HttpServer {
  const httpServer = createHttpServer(createHttpHandler(state));
  httpServer.listen(port, host, () => {
    const addr = httpServer.address();
    const bound = typeof addr === "object" && addr ? `${addr.address.includes(":") ? `[${addr.address}]` : addr.address}:${addr.port}` : String(port);
    // stdout is reserved for protocol traffic in stdio mode; log to stderr everywhere
    console.error(`research-scope-mcp ${version} listening (Streamable HTTP) on http://${bound}/mcp`);
  });
  return httpServer;
}
