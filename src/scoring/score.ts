/**
 * research-scope-mcp — source-quality scoring (v0.1.0)
 *
 * Heuristic, explainable scoring. Every dimension it checks is returned with the
 * evidence that produced it, so a `score >= 70` can be audited by a human or an
 * agent rather than trusted blindly. This module deliberately has no network
 * access; `fetch_and_score` in index.ts owns the fetch and hands us plain text,
 * headers, and URL metadata.
 */

export interface SourceInput {
  url: string;
  /** Page <title> if extractable */
  title?: string;
  /** Body text extracted from HTML (whitespace-collapsed) */
  text: string;
  /** Raw response headers subset worth scoring on */
  headers?: Record<string, string>;
  /** HTTP status of the fetch */
  status: number;
  /** Alternate fetch timestamp; defaults to now */
  fetchedAt?: string;
}

export interface ScoreBreakdown {
  dimension: string;
  points: number; // 0..max
  max: number; // max
  verdict: "primary" | "secondary" | "unknown";
  notes: string;
}

export interface SourceScore {
  url: string;
  score: number; // 0..100
  grade: "A" | "B" | "C" | "D";
  isPrimarySource: boolean;
  publishedAt: string | null; // ISO date if detectable
  freshnessDays: number | null; // days since publishedAt
  flags: string[]; // e.g. "paywall", "conflict-of-interest:vendor", "no-date", "dead-link"
  breakdown: ScoreBreakdown[];
  scoredAt: string;
}

/** Domains where content is authored by the primary party (official docs, filings, reports). */
const PRIMARY_HOSTS = [
  ".gov",
  ".gov.uk",
  ".mil",
  ".edu",
  ".ac.uk",
  "arxiv.org",
  "doi.org",
  "sec.gov",
  "federalregister.gov",
  "data.gov",
  " CourtListener".trim(),
];

/** Vendor/press domains that count as primary-source about their own claims. */
const SELF_PUBLISHED_HINTS = [
  "/press-release",
  "/press/",
  "press-release-",
  "/announcements/",
  "/blog/announcement",
  "changelog",
  "/releases/",
];

/** Signals a page sits behind a paywall or registration wall. */
const PAYWALL_SIGNALS = [
  /\bsubscribe (?:to|now|today|to read|to continue)/i,
  /\btrial ends in/i,
  /\bplease (?:log ?in|sign ?in|register) to continue/i,
  /\bthis (?:article|content|story) is (?:for )?(?:members|-only|paywalled|exclusive)/i,
  /\bpremium (?:content|article|access)/i,
  "metered-paywall",
  "paywall",
];

/** Conflict-of-interest markers: the page exists to sell the thing it describes. */
const COI_PATTERNS: Array<[RegExp, string]> = [
  [/in partnership with\s+([A-Z][\w&. -]{2,40})/, "conflict-of-interest:partnership"],
  [/\bsponsored (?:by|content|post)\b/i, "conflict-of-interest:sponsored"],
  [/\baffiliate (?:link|disclosure)/i, "conflict-of-interest:affiliate"],
  [/\bwe may (?:earn|receive) (?:a )?commission\b/i, "conflict-of-interest:affiliate"],
  [/\bnow available for purchase\b/i, "conflict-of-interest:marketing"],
];

const DATE_PATTERNS: Array<[RegExp, string]> = [
  // meta tags are checked separately
  [/\b(?:published|posted|updated|revised|released)\s+(?:on\s+)?((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+\d{1,2},?\s+\d{4})/i, "$1"],
  [/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+\d{1,2},?\s+\d{4})/, "$1"],
  [/(\d{4}-\d{2}-\d{2})/, "$1"],
  [/(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/i, "$1"],
];

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isPrimaryHost(host: string): boolean {
  return (
    PRIMARY_HOSTS.some((p) => p && host.endsWith(p.startsWith(".") ? p.slice(1) : p) && (p.startsWith(".") || host === p || host.endsWith("." + p))) ||
    PRIMARY_HOSTS.includes(host)
  );
}

function includesSubstring(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

export function detectPublishedAt(input: SourceInput): string | null {
  const h = input.headers ?? {};
  const metaCandidates = [
    h["last-modified"],
    h["date"],
  ];
  for (const m of metaCandidates) {
    const t = Date.parse(m);
    if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  }
  const haystack = `${input.title ?? ""}\n${input.text.slice(0, 4000)}`;
  for (const [pattern, replacement] of DATE_PATTERNS) {
    const m = haystack.match(pattern);
    if (m && m[1]) {
      const t = Date.parse(m[1].replace(/\./g, ""));
      if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
      void replacement;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

export function scoreSource(input: SourceInput): SourceScore {
  const flags: string[] = [];
  const text = input.text ?? "";
  const host = hostnameOf(input.url);
  const softEvidence = `${host}\n${input.title ?? ""}\n${text.slice(0, 12000)}`;

  /* --- 0. gate: dead/inaccessible pages score 0 -------------------- */
  if (input.status !== 200) {
    flags.push(`http-${input.status}`);
    return {
      url: input.url,
      score: 0,
      grade: "D",
      isPrimarySource: false,
      publishedAt: null,
      freshnessDays: null,
      flags: [...flags, "dead-link"],
      breakdown: [
        {
          dimension: "availability",
          points: 0,
          max: 100,
          verdict: "unknown",
          notes: `HTTP ${input.status} — page not retrievable; no scoring possible.`,
        },
      ],
      scoredAt: input.fetchedAt ?? new Date().toISOString(),
    };
  }

  let points = 0;

  /* --- 1. availability & substance (20) ---------------------------- */
  const textLen = text.length;
  if (textLen >= 3000) points += 14;
  else if (textLen >= 800) points += 10;
  else if (textLen >= 300) points += 6;
  else points += 2;
  points += 2; // reachable 200 by construction here
  if (textLen < 300) flags.push("thin-content");

  const sourcePrimary = isPrimaryHost(host);
  let primaryRelevant = sourcePrimary;
  if (!sourcePrimary) {
    // self-published primary: vendor describing its own product/iframe-of-record
    if (SELF_PUBLISHED_HINTS.some((p) => includesSubstring(input.url, p))) {
      primaryRelevant = true;
    }
  }

  /* --- 2. primary-source status (32) ------------------------------- */
  if (primaryRelevant) {
    points += 26; // host signals it
  } else {
    // secondary corroboration still valuable: multi-source attribution
    const cited = (text.match(/https?:\/\/[^\s")\]]{20,}/g) ?? []).length;
    if (cited >= 5) points += 14;
    else if (cited >= 2) points += 8;
    else if (cited >= 1) points += 4;
  }

  /* --- 3. freshness (24) ------------------------------------------- */
  const publishedAt = detectPublishedAt(input);
  let freshnessDays: number | null = null;
  let freshnessPoints = 0;
  if (publishedAt) {
    const days = Math.floor((Date.now() - Date.parse(publishedAt)) / 86_400_000);
    freshnessDays = days;
    if (days <= 30) freshnessPoints = 24;
    else if (days <= 180) freshnessPoints = 18;
    else if (days <= 730) freshnessPoints = 12;
    else if (days <= 1825) freshnessPoints = 6;
    else {
      freshnessPoints = 2;
      flags.push("stale:>5y");
    }
  } else {
    flags.push("no-date");
    freshnessPoints = 0;
  }
  points += freshnessPoints;

  /* --- 4. paywall / access friction (12) --------------------------- */
  let paywalled = false;
  for (const needle of PAYWALL_SIGNALS) {
    const hit = needle instanceof RegExp ? needle.test(text.slice(0, 2000)) || needle.test(input.title ?? "") : includesSubstring(`${input.title ?? ""}\n${text.slice(0, 2000)}`, needle);
    if (hit) {
      paywalled = true;
      break;
    }
  }
  if (paywalled) {
    points += 3;
    flags.push("paywall");
  } else {
    points += 12;
  }

  /* --- 5. conflict-of-interest (12) -------------------------------- */
  let coi = false;
  for (const [pattern, flag] of COI_PATTERNS) {
    if (pattern.test(text.slice(0, 6000))) {
      flags.push(flag);
      coi = true;
      break;
    }
  }
  // vendor page scoring its own product is a mild structural COI even unmarked
  if (!coi && !sourcePrimary && /\/products?\//.test(input.url) && !primaryRelevant) {
    flags.push("vendor-page");
  }
  points += coi ? 4 : 12;

  const score = Math.max(0, Math.min(100, points));
  const grade: SourceScore["grade"] = score >= 80 ? "A" : score >= 65 ? "B" : score >= 45 ? "C" : "D";

  const breakdown: ScoreBreakdown[] = [
    {
      dimension: "availability & substance",
      points: Math.min(20, textLen >= 3000 ? 16 : textLen >= 800 ? 12 : textLen >= 300 ? 8 : 4),
      max: 20,
      verdict: "unknown",
      notes: `${textLen} chars extractable text`,
    },
    {
      dimension: "primary-source",
      points: primaryRelevant ? 26 : 0,
      max: 32,
      verdict: primaryRelevant ? (sourcePrimary ? "primary" : "primary") : "secondary",
      notes: sourcePrimary
        ? `primary host: ${host}`
        : primaryRelevant
          ? "self-published primary (announcement/press path or docs host)"
          : "corroborating secondary; outbound citation count used as proxy",
    },
    {
      dimension: "freshness",
      points: freshnessPoints,
      max: 24,
      verdict: "unknown",
      notes: publishedAt ? `published ${publishedAt} (${freshnessDays}d ago)` : "no publication date detectable",
    },
    {
      dimension: "access",
      points: paywalled ? 3 : 12,
      max: 12,
      verdict: "unknown",
      notes: paywalled ? "paywall/registration signals present — excerpt only" : "open access",
    },
    {
      dimension: "independence",
      points: coi ? 4 : 12,
      max: 12,
      verdict: coi ? "unknown" : primaryRelevant ? "primary" : "unknown",
      notes: coi ? "sponsored/affiliate/partnership language found" : "no COI markers detected",
    },
  ];

  return {
    url: input.url,
    score,
    grade,
    isPrimarySource: primaryRelevant,
    publishedAt,
    freshnessDays,
    flags,
    breakdown,
    scoredAt: input.fetchedAt ?? new Date().toISOString(),
  };
}
