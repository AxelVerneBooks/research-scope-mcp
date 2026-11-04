/**
 * Input validation for every tool exposed by research-scope-mcp.
 *
 * Each tool's parameters are described by a Zod raw shape. The shapes are passed
 * straight to `server.registerTool({ inputSchema })`, so the MCP SDK both
 * advertises them as JSON Schema in `tools/list` and enforces them before the
 * handler runs. When a call is rejected, the SDK returns an `isError: true` tool
 * result whose text is built from the Zod issue messages below — which is why
 * every message says what was wrong AND what to send instead.
 *
 * `validateToolInput()` applies the same schemas outside the server (used by the
 * unit tests and available to embedders), formatting errors the same way.
 */

import { z } from "zod";

/* ------------------------------------------------------------------ */
/* limits                                                              */
/* ------------------------------------------------------------------ */

export const LIMITS = {
  scopeMin: 3,
  scopeMax: 500,
  domainHintsMax: 20,
  domainHintMax: 100,
  topicMin: 3,
  topicMax: 200,
  sourcesMax: 50,
  urlMax: 2048,
  reportPathMax: 1024,
} as const;

/* ------------------------------------------------------------------ */
/* shared field builders                                               */
/* ------------------------------------------------------------------ */

function requiredString(field: string, example: string) {
  return z.string({
    required_error: `${field} is required — e.g. ${example}`,
    invalid_type_error: `${field} must be a string — e.g. ${example}`,
  });
}

function boundedText(field: string, min: number, max: number, example: string) {
  return requiredString(field, example)
    .trim()
    .min(min, `${field} must be at least ${min} characters after trimming whitespace — e.g. ${example}`)
    .max(max, `${field} must be at most ${max} characters — shorten it to the core question`);
}

/** An absolute http(s) URL. Other schemes (file:, ftp:, javascript:, data:) are refused. */
function httpUrl(field: string) {
  const example = '"https://www.nhtsa.gov/"';
  return requiredString(field, example)
    .trim()
    .min(1, `${field} must not be empty — pass an absolute URL such as ${example}`)
    .max(LIMITS.urlMax, `${field} must be at most ${LIMITS.urlMax} characters`)
    .superRefine((value, ctx) => {
      if (value.length === 0) return; // already reported by .min()
      let parsed: URL;
      try {
        parsed = new URL(value);
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${field} "${value}" is not a valid absolute URL — include the scheme and host, e.g. ${example}`,
        });
        return;
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${field} must use http or https (got "${parsed.protocol}") — only web sources can be fetched and scored`,
        });
      }
    });
}

/* ------------------------------------------------------------------ */
/* per-tool input shapes                                               */
/* ------------------------------------------------------------------ */

export const planResearchInput = {
  scope: boundedText("scope", LIMITS.scopeMin, LIMITS.scopeMax, '"verify vendor claim about NREMT 2025 exam change"').describe(
    "What is being researched, e.g. 'verify vendor claim about NREMT 2025 exam change'"
  ),
  domain_hints: z
    .array(
      z
        .string({ invalid_type_error: 'each domain_hints entry must be a string — e.g. ".gov" or "arxiv.org"' })
        .trim()
        .min(1, 'domain_hints entries must not be empty — use values like ".gov" or "arxiv.org"')
        .max(LIMITS.domainHintMax, `each domain_hints entry must be at most ${LIMITS.domainHintMax} characters`),
      { invalid_type_error: 'domain_hints must be an array of strings — e.g. [".gov", "arxiv.org"]' }
    )
    .max(LIMITS.domainHintsMax, `domain_hints accepts at most ${LIMITS.domainHintsMax} entries — keep the most authoritative hosts`)
    .optional()
    .describe("Suggested source domains, e.g. ['.gov', 'arxiv.org']"),
};

export const fetchAndScoreInput = {
  source_url: httpUrl("source_url").describe("The source URL to fetch and score (absolute http/https URL)"),
};

export const buildReportInput = {
  topic: boundedText("topic", LIMITS.topicMin, LIMITS.topicMax, '"NREMT 2025 exam format change"').describe("Report topic / title"),
  sources: z
    .array(httpUrl("each sources entry"), {
      required_error: 'sources is required — pass the URLs you already scored with fetch_and_score, e.g. ["https://www.nhtsa.gov/"]',
      invalid_type_error: 'sources must be an array of URL strings — e.g. ["https://www.nhtsa.gov/"]',
    })
    .min(1, "sources must contain at least one URL — score a source with fetch_and_score first, then pass its URL here")
    .max(LIMITS.sourcesMax, `sources accepts at most ${LIMITS.sourcesMax} URLs — split the work into several reports`)
    .superRefine((urls, ctx) => {
      const seen = new Set<string>();
      urls.forEach((url, i) => {
        if (seen.has(url)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [i],
            message: `duplicate source "${url}" — list each URL once so citation numbers [Sn] stay unique`,
          });
        }
        seen.add(url);
      });
    })
    .describe("Source URLs previously scored with fetch_and_score"),
};

export const REPORT_ID_PATTERN = /^[0-9a-f]{8}$/;

export const checkReportInput = {
  report_id: z
    .string({ invalid_type_error: 'report_id must be a string — the 8-character id printed by build_report, e.g. "1a2b3c4d"' })
    .trim()
    .regex(REPORT_ID_PATTERN, 'report_id must be the 8-character lowercase hex id printed by build_report, e.g. "1a2b3c4d"')
    .optional()
    .describe("Report id returned by build_report"),
  report_path: z
    .string({ invalid_type_error: 'report_path must be a string path to a .md file, e.g. "data/reports/report-1a2b3c4d.md"' })
    .trim()
    .min(1, 'report_path must not be empty — pass a .md file path, e.g. "data/reports/report-1a2b3c4d.md"')
    .max(LIMITS.reportPathMax, `report_path must be at most ${LIMITS.reportPathMax} characters`)
    .refine((p) => /\.(md|markdown)$/i.test(p), {
      message: 'report_path must point to a Markdown file ending in .md or .markdown, e.g. "data/reports/report-1a2b3c4d.md"',
    })
    .optional()
    .describe("Path to a report markdown file (overrides report_id)"),
};

/**
 * Cross-field rule for check_report: at least one of report_id / report_path.
 * Kept out of the object shape so the advertised JSON Schema stays a plain
 * object; the handler calls this and returns the message as an isError result.
 */
export function checkReportTargetError(args: { report_id?: string; report_path?: string }): string | null {
  if (!args.report_id && !args.report_path) {
    return 'Input validation error: provide report_id (the 8-character id printed by build_report, e.g. "1a2b3c4d") or report_path (a .md file, e.g. "data/reports/report-1a2b3c4d.md").';
  }
  return null;
}

export const toolInputShapes = {
  plan_research: planResearchInput,
  fetch_and_score: fetchAndScoreInput,
  build_report: buildReportInput,
  check_report: checkReportInput,
} as const;

export type ToolName = keyof typeof toolInputShapes;

/* ------------------------------------------------------------------ */
/* standalone validation (same formatting as the server)               */
/* ------------------------------------------------------------------ */

/** Render Zod issues as "<message> at <path>" lines, matching the MCP SDK's output. */
export function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => (issue.path.length ? `${issue.message} at ${issue.path.join(".")}` : issue.message))
    .join("\n");
}

export type ValidationResult<T> = { ok: true; data: T } | { ok: false; message: string };

export function validateToolInput<N extends ToolName>(
  tool: N,
  args: unknown
): ValidationResult<z.infer<z.ZodObject<(typeof toolInputShapes)[N]>>> {
  const schema = z.object(toolInputShapes[tool] as z.ZodRawShape);
  const parsed = schema.safeParse(args ?? {});
  if (!parsed.success) {
    return { ok: false, message: `Input validation error: Invalid arguments for tool ${tool}: ${formatIssues(parsed.error)}` };
  }
  if (tool === "check_report") {
    const crossField = checkReportTargetError(parsed.data as { report_id?: string; report_path?: string });
    if (crossField) return { ok: false, message: crossField };
  }
  return { ok: true, data: parsed.data as z.infer<z.ZodObject<(typeof toolInputShapes)[N]>> };
}
