/**
 * research-scope-mcp — source-quality scoring
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
  /** Publication date declared by the page itself (meta tag / <time datetime>), if any */
  metaPublished?: string;
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
  "courtlistener.com",
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

const DATE_PATTERNS: RegExp[] = [
  // meta tags are checked separately (SourceInput.metaPublished)
  /\b(?:published|posted|updated|revised|released)\s+(?:on\s+)?((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+\d{1,2},?\s+\d{4})/i,
  /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+\d{1,2},?\s+\d{4})/,
  /(\d{4}-\d{2}-\d{2})/,
  /(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/i,
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

export function isPrimaryHost(host: string): boolean {
  const h = host.toLowerCase();
  return PRIMARY_HOSTS.some((p) =>
    // ".gov" style entries are suffixes; "arxiv.org" style entries match the domain or its subdomains
    p.startsWith(".") ? h.endsWith(p) : h === p || h.endsWith("." + p)
  );
}

function includesSubstring(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function toIsoDate(value: string | undefined): string | null {
  if (!value) return null;
  const t = Date.parse(value.replace(/\.(?=\s)/g, ""));
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

/**
 * Publication date, in order of trust: the page's own meta declaration, a
 * Last-Modified header, then the first date-looking string in title/body.
 * The HTTP `Date` header is deliberately ignored: it is the time the response
 * was generated, so it would make every page look published today.
 */
export function detectPublishedAt(input: SourceInput): string | null {
  const declared = toIsoDate(input.metaPublished) ?? toIsoDate(input.headers?.["last-modified"]);
  if (declared) return declared;
  const haystack = `${input.title ?? ""}\n${input.text.slice(0, 4000)}`;
  for (const pattern of DATE_PATTERNS) {
    const m = haystack.match(pattern);
    const iso = toIsoDate(m?.[1]);
    if (iso) return iso;
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
  // +2 because the page is reachable (status 200 by construction here)
  const substancePoints = 2 + (textLen >= 3000 ? 14 : textLen >= 800 ? 10 : textLen >= 300 ? 6 : 2);
  points += substancePoints;
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
  let primaryPoints = 0;
  let outboundCitations = 0;
  if (primaryRelevant) {
    primaryPoints = 26; // host signals it
  } else {
    // secondary corroboration still valuable: multi-source attribution
    outboundCitations = (text.match(/https?:\/\/[^\s")\]]{20,}/g) ?? []).length;
    if (outboundCitations >= 5) primaryPoints = 14;
    else if (outboundCitations >= 2) primaryPoints = 8;
    else if (outboundCitations >= 1) primaryPoints = 4;
  }
  points += primaryPoints;

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
      points: substancePoints,
      max: 20,
      verdict: "unknown",
      notes: `${textLen} chars extractable text`,
    },
    {
      dimension: "primary-source",
      points: primaryPoints,
      max: 32,
      verdict: primaryRelevant ? "primary" : "secondary",
      notes: sourcePrimary
        ? `primary host: ${host}`
        : primaryRelevant
          ? "self-published primary (announcement/press path or docs host)"
          : `corroborating secondary; ${outboundCitations} outbound citation(s) used as proxy`,
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
