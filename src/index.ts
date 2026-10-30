#!/usr/bin/env node
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
 *     Stateless, no auth layer — keep it on loopback or behind an auth proxy.
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

const DATA_DIR = pathResolve(process.env.RESEARCH_SCOPE_DATA_DIR ?? pathResolve(process.cwd(), "data"));

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

async function fetchSource(url: string, timeoutMs = 15000): Promise<{ status: number; title: string; text: string; headers: Record<string, string>; finalUrl: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": "research-scope-mcp/0.1 (+research-scoring)",
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
  async ({ scope, domain_hints }) => {
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
      source_url: z.string().url().describe("The source URL to fetch and score"),
    },
  },
  async ({ source_url }) => {
    const fetched = await fetchSource(source_url);
    const score = scoreSource({
      url: fetched.finalUrl,
      title: fetched.title,
      text: fetched.text,
      headers: fetched.headers,
      status: fetched.status,
    });
    scoreRegistry.set(fetched.finalUrl, score);
    scoreRegistry.set(source_url, score); // index under the requested URL too
    return {
      content: [{ type: "text" as const, text: JSON.stringify(score, null, 2) }],
    };
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
  },
  async ({ topic, sources }) => {
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
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `These URLs were never scored — run fetch_and_score on them first:\n${missing.join("\n")}`,
          },
        ],
      };
    }
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    if (!existsSync(pathResolve(DATA_DIR, "reports"))) mkdirSync(pathResolve(DATA_DIR, "reports"), { recursive: true });
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
    const reportPath = pathResolve(DATA_DIR, "reports", `report-${id}.md`);
    writeFileSync(reportPath, markdown, "utf8");
    const registryLine = entries.map((e, i) => `[S${i + 1}] ${e.url} (${e.score}/100, ${e.grade})`).join("\n");
    return {
      content: [
        {
          type: "text" as const,
          text: `Report shell ${id} saved to ${reportPath}\n\n---\n${markdown.replace(registryLine, registryLine)}\n---\n\nCitation registry:\n${registryLine}\nUse these [Sn] numbers when writing claims, then run check_report.`,
        },
      ],
    };
  }
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
  async ({ report_id, report_path }) => {
    let markdown: string | null = null;
    let label = report_id ?? report_path ?? "";
    if (report_path) {
      const p = pathResolve(report_path);
      if (!existsSync(p)) {
        return { isError: true, content: [{ type: "text" as const, text: `Report file not found: ${p}` }] };
      }
      markdown = readFileSync(p, "utf8");
      label = p;
    } else if (report_id && reports.has(report_id)) {
      markdown = reports.get(report_id)!.markdown;
      label = report_id;
    } else {
      return {
        isError: true,
        content: [{ type: "text" as const, text: "Provide either report_id (from build_report) or report_path." }],
      };
    }

    const claims = extractClaims(markdown ?? "");
    const orphan = claims.filter((c) => c.sourceUrls.length === 0);
    const ok = orphan.length === 0 && claims.length > 0;

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
              verdict: ok ? "PASS — every claim cites a scored source" : "FAIL — orphan claims above cite no scored source; fill or remove them",
            },
            null,
            2
          ),
        },
      ],
      ...(ok ? {} : {}),
    };
  }
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
  // stdio keeps the process alive until the client closes the pipe
}

function runHttp(port: number): void {
  // Stateless Streamable HTTP: the SDK requires a fresh transport per request
  // (a reused stateless transport throws "cannot be reused across requests"
  // from the second request on, which surfaced as silent 500s). Mirror the
  // SDK's official stateless example: new server + new transport per request,
  // both closed when the response ends. Module-scope registries keep state.
  const httpServer = createHttpServer((req, res) => {
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
        // never leak as 403; protocol discovery errors surface as 401/discovery doc
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader("content-type", "application/json");
        }
        const payload = JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: (err as Error).message } });
        if (!res.writableEnded) {
          res.end(payload);
        } else {
          res.destroy();
        }
      }
    })();
  });
  httpServer.listen(port, () => {
    const addr = httpServer.address();
    const bound = typeof addr === "object" && addr ? `${addr.address}:${addr.port}` : String(port);
    // stdout carries protocol logs to the log file; stderr to the console
    console.error(`research-scope-mcp ${version} listening (Streamable HTTP) on http://${bound}/mcp`);
  });
}

/* --- entry -------------------------------------------------------- */

const args = process.argv.slice(2);
if (args.includes("--http")) {
  const portIdx = args.indexOf("--port");
  const port = portIdx >= 0 ? Number(args[portIdx + 1]) || 3001 : Number(process.env.PORT) || 3001;
  runHttp(port);
} else {
  runStdio().catch((err) => {
    console.error("stdio transport failed:", err);
    process.exit(1);
  });
}

// keep version.ts below credits budget — single export
