/**
 * research-scope-mcp — report model, HTML extraction, and citation checking.
 *
 * Pure functions only (no network, no filesystem) so they can be unit-tested
 * directly; the tool handlers in server.ts own I/O.
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
  claimId: string;
  /** Citation ids found on the claim line, e.g. ["S1", "S3"] */
  sourceUrls: string[];
}

export interface CheckResult {
  pass: boolean;
  claimsFound: number;
  claimsCited: number;
  orphanClaims: Claim[];
  /** Claims citing an [Sn] that is not in the report's citation registry */
  unknownCitations: Array<Claim & { unknown: string[] }>;
  verdict: string;
}

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ent: string) => {
    if (ent[0] === "#") {
      const code = ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[ent.toLowerCase()] ?? whole;
  });
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

export function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1]).replace(/\s+/g, " ").trim() : "";
}

/** The page's self-declared publication date (Open Graph / schema.org / <time>), if any. */
export function extractMetaPublished(html: string): string | undefined {
  const metaPatterns = [
    /<meta[^>]+(?:property|name|itemprop)=["'](?:article:published_time|datePublished|date|dc\.date|dcterms\.created|citation_publication_date)["'][^>]*>/i,
    /<time[^>]+datetime=["'][^"']+["'][^>]*>/i,
  ];
  for (const p of metaPatterns) {
    const tag = html.match(p)?.[0];
    if (!tag) continue;
    const value = tag.match(/(?:content|datetime)=["']([^"']+)["']/i)?.[1];
    if (value) return value.trim();
  }
  return undefined;
}

/** Map of citation id ("S1") -> URL, read from the report's "## Citation registry" section. */
export function parseRegistry(markdown: string): Map<string, string> {
  const registry = new Map<string, string>();
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => /^## Citation registry/i.test(l.trim()));
  if (start < 0) return registry;
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();
    if (/^##\s/.test(trimmed)) break;
    const m = trimmed.match(/^\[S(\d+)\]\s+(\S+)/);
    if (m) registry.set(`S${m[1]}`, m[2]);
  }
  return registry;
}

/** Extract claim-looking sentences from markdown ("claims" = assertion-bearing lines). */
export function extractClaims(markdown: string): Claim[] {
  const claims: Claim[] = [];
  const lines = markdown.split("\n");
  // everything from the citation registry down is the paper trail, not claims
  const cutoff = lines.findIndex((l) => /^## Citation registry/i.test(l.trim()));
  let inFence = false;
  lines.slice(0, cutoff >= 0 ? cutoff : lines.length).forEach((line, i) => {
    const trimmed = line.trim();
    if (/^(```|~~~)/.test(trimmed)) {
      inFence = !inFence;
      return;
    }
    if (inFence || !trimmed || /^#{1,6}\s/.test(trimmed)) return;
    // Template boilerplate never counts as a claim: the shell's own instruction
    // preamble (italic _…_ lines) and HTML example comments are not authored
    // findings, so check_report must not orphan them.
    const isTemplateComment = trimmed.startsWith("<!--");
    const isTemplatePreamble = trimmed.startsWith("_") && trimmed.endsWith("_");
    if (isTemplateComment || isTemplatePreamble) return;
    const body = trimmed.replace(/^(?:[-*+]|\d+[.)])\s+/, "").replace(/^>\s*/, "");
    // only substantive assertion sentences
    if (body.length < 40) return;
    const citations = [...new Set([...body.matchAll(/\[S(\d+)\]/g)].map((m) => `S${m[1]}`))];
    claims.push({
      claim: body.replace(/\s*\[S\d+\]/g, "").trim(),
      claimId: `C${i + 1}`,
      sourceUrls: citations,
    });
  });
  return claims;
}

/** Every claim must cite at least one [Sn] that exists in the report's citation registry. */
export function checkReportMarkdown(markdown: string): CheckResult {
  const claims = extractClaims(markdown);
  const registry = parseRegistry(markdown);
  const orphanClaims = claims.filter((c) => c.sourceUrls.length === 0);
  const unknownCitations = claims
    .map((c) => ({ ...c, unknown: c.sourceUrls.filter((id) => !registry.has(id)) }))
    .filter((c) => c.unknown.length > 0);
  const pass = claims.length > 0 && orphanClaims.length === 0 && unknownCitations.length === 0;
  const claimsCited = claims.filter((c) => c.sourceUrls.length > 0 && c.sourceUrls.every((id) => registry.has(id))).length;
  let verdict: string;
  if (pass) verdict = "PASS — every claim cites a scored source";
  else if (claims.length === 0) verdict = "FAIL — no claims written yet; add findings under ## Claims citing [Sn] sources";
  else verdict = "FAIL — orphan claims cite no scored source, or cite an [Sn] missing from the citation registry; fill or remove them";
  return { pass, claimsFound: claims.length, claimsCited, orphanClaims, unknownCitations, verdict };
}

export function renderReportShell(topic: string, sources: PaperTrailEntry[], now = new Date()): string {
  const lines: string[] = [];
  lines.push(`# Research report — ${topic.replace(/\s+/g, " ").trim()}`);
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
