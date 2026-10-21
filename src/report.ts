/**
 * research-scope-mcp — report shell rendering and citation checking
 *
 * Pure functions (no I/O) so the report format and the check_report rules can
 * be tested without a server.
 */

import { version } from "./version.js";

export interface PaperTrailEntry {
  url: string;
  score: number;
  grade: string;
  publishedAt: string | null;
  flags: string[];
  scoredAt: string;
}

export interface Claim {
  claim: string;
  /** `C<line>` — 1-based line number of the claim in the report markdown. */
  claimId: string;
  /** Citation ids found on the claim line, e.g. ["S1", "S3"]. */
  sourceUrls: string[];
}

export interface CheckResult {
  pass: boolean;
  claimsFound: number;
  claimsCited: number;
  registrySources: number;
  orphanClaims: Claim[] | "none";
  unknownCitations: Array<{ claimId: string; citations: string[] }> | "none";
  verdict: string;
}

/** Sections whose lines are report scaffolding, not authored findings. */
const NON_CLAIM_SECTIONS = /^#{1,2}\s+(?:citation registry|scoring appendix)\b/i;
const REGISTRY_SECTION = /^#{1,2}\s+citation registry\b/i;

/** Minimum length for a line to count as a substantive claim. */
export const MIN_CLAIM_LENGTH = 40;

/** Citation ids in a line. Accepts `[S1]`, `[S1][S2]` and `[S1, S2]` / `[S1; S2]`. */
export function parseCitations(line: string): string[] {
  const ids: string[] = [];
  for (const m of line.matchAll(/\[\s*(S\d+(?:\s*[,;]\s*S\d+)*)\s*\]/gi)) {
    for (const id of m[1].split(/[,;]/)) ids.push(id.trim().toUpperCase());
  }
  return [...new Set(ids)];
}

function stripCitations(line: string): string {
  return line
    .replace(/\[\s*S\d+(?:\s*[,;]\s*S\d+)*\s*\]/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

/** Extract claim-looking sentences from markdown ("claims" = assertion-bearing lines). */
export function extractClaims(markdown: string): Claim[] {
  const claims: Claim[] = [];
  let inNonClaimSection = false;
  let inFence = false;
  let inComment = false;

  markdown.split(/\r?\n/).forEach((line, i) => {
    let trimmed = line.trim();

    if (/^(```|~~~)/.test(trimmed)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;

    // HTML comments (template examples) never count, including multi-line ones.
    if (inComment) {
      const end = trimmed.indexOf("-->");
      if (end < 0) return;
      inComment = false;
      trimmed = trimmed.slice(end + 3).trim();
    }
    trimmed = trimmed.replace(/<!--[\s\S]*?-->/g, "").trim();
    const open = trimmed.indexOf("<!--");
    if (open >= 0) {
      inComment = true;
      trimmed = trimmed.slice(0, open).trim();
    }
    if (!trimmed) return;

    const heading = trimmed.match(/^(#{1,6})\s/);
    if (heading) {
      // Only top-level sections switch state; "### [S1] flags" stays inside the appendix.
      if (heading[1].length <= 2) inNonClaimSection = NON_CLAIM_SECTIONS.test(trimmed);
      return;
    }
    if (inNonClaimSection) return;

    // The shell's own instruction preamble (italic _…_ lines) is not a finding.
    if (trimmed.length > 1 && trimmed.startsWith("_") && trimmed.endsWith("_")) return;

    const body = trimmed
      .replace(/^>\s*/, "") // blockquote
      .replace(/^(?:[-*+]|\d+[.)])\s+/, "") // bullet or numbered list item
      .trim();
    if (body.length < MIN_CLAIM_LENGTH) return;

    claims.push({
      claim: stripCitations(body),
      claimId: `C${i + 1}`,
      sourceUrls: parseCitations(body),
    });
  });
  return claims;
}

/** `[Sn] <url> …` entries listed under the "Citation registry" heading. */
export function parseRegistry(markdown: string): Map<string, string> {
  const registry = new Map<string, string>();
  let inRegistry = false;
  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    const heading = trimmed.match(/^(#{1,6})\s/);
    if (heading && heading[1].length <= 2) {
      inRegistry = REGISTRY_SECTION.test(trimmed);
      continue;
    }
    if (!inRegistry) continue;
    const m = trimmed.match(/^(?:[-*]\s+)?\[(S\d+)\]:?\s+(\S+)/i);
    if (m) registry.set(m[1].toUpperCase(), m[2]);
  }
  return registry;
}

/**
 * Every substantive claim must cite at least one source that exists in the
 * report's citation registry. A citation to an id the registry doesn't list
 * (a typo, or a source that was never scored) is an error, not a pass.
 */
export function checkReportMarkdown(markdown: string): CheckResult {
  const claims = extractClaims(markdown);
  const registry = parseRegistry(markdown);

  const orphan: Claim[] = [];
  const unknown: Array<{ claimId: string; citations: string[] }> = [];
  for (const c of claims) {
    const known = c.sourceUrls.filter((id) => registry.has(id));
    const missing = c.sourceUrls.filter((id) => !registry.has(id));
    if (known.length === 0) orphan.push(c);
    if (missing.length) unknown.push({ claimId: c.claimId, citations: missing });
  }

  const pass = claims.length > 0 && orphan.length === 0 && unknown.length === 0;
  let verdict: string;
  if (pass) verdict = "PASS — every claim cites a scored source";
  else if (claims.length === 0) verdict = "FAIL — no claims found; write findings under ## Claims citing sources as [S1], [S2], …";
  else if (registry.size === 0) verdict = "FAIL — no citation registry found, so no citation can be resolved to a scored source";
  else {
    const parts: string[] = [];
    if (orphan.length) parts.push(`${orphan.length} orphan claim(s) cite no scored source`);
    if (unknown.length) parts.push(`${unknown.length} claim(s) cite ids missing from the citation registry`);
    verdict = `FAIL — ${parts.join("; ")}; fill, fix or remove them`;
  }

  return {
    pass,
    claimsFound: claims.length,
    claimsCited: claims.length - orphan.length,
    registrySources: registry.size,
    orphanClaims: orphan.length ? orphan : "none",
    unknownCitations: unknown.length ? unknown : "none",
    verdict,
  };
}

export function renderReportShell(topic: string, sources: PaperTrailEntry[], now = new Date()): string {
  const lines: string[] = [];
  lines.push(`# Research report — ${topic}`);
  lines.push("");
  lines.push(`_Generated by research-scope-mcp ${version} on ${now.toISOString().slice(0, 10)}._`);
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
