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
  /** HTTP status of the fetch */
  status: number;
  /** Alternate fetch timestamp; defaults to now. Also the reference point for freshness. */
  fetchedAt?: string;
  /**
   * Publication date found in page metadata (<meta article:published_time>,
   * JSON-LD datePublished, <time datetime>), extracted before the HTML is
   * flattened to text. Preferred over any date found in the body text.
   */
  publishedHint?: string;
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

/**
 * Signals a page sits behind a paywall or registration wall. Phrase-level only:
 * a bare "paywall" substring flagged every article that merely discusses
 * paywalls, and markup-only markers (class="metered-paywall") never survive
 * the HTML-to-text step anyway.
 */
const PAYWALL_SIGNALS: RegExp[] = [
  /\bsubscribe (?:to|now|today|to read|to continue)/i,
  /\btrial ends in/i,
  /\bplease (?:log ?in|sign ?in|register) to continue/i,
  /\bthis (?:article|content|story) is (?:for )?(?:members(?:-only)?|paywalled|exclusive)/i,
  /\bpremium (?:content|article|access)/i,
];

/** Conflict-of-interest markers: the page exists to sell the thing it describes. */
const COI_PATTERNS: Array<[RegExp, string]> = [
  [/in partnership with\s+([A-Z][\w&. -]{2,40})/, "conflict-of-interest:partnership"],
  [/\bsponsored (?:by|content|post)\b/i, "conflict-of-interest:sponsored"],
  [/\baffiliate (?:link|disclosure)/i, "conflict-of-interest:affiliate"],
  [/\bwe may (?:earn|receive) (?:a )?commission\b/i, "conflict-of-interest:affiliate"],
  [/\bnow available for purchase\b/i, "conflict-of-interest:marketing"],
];

/** "Published on Oct 5, 2026" style: an explicit label makes this the strongest text signal. */
const LABELLED_DATE_PATTERN =
  /\b(?:published|posted|updated|revised|released)\s*(?:on\s+|:\s*)?((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/i;

/** Unlabelled dates anywhere near the top of the page; weakest signal. */
const LOOSE_DATE_PATTERNS: RegExp[] = [
  /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+\d{1,2},?\s+\d{4})/,
  /\b(\d{4}-\d{2}-\d{2})\b/,
  /(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/i,
];

/** Dates further than this in the future are treated as noise, not publication dates. */
const FUTURE_TOLERANCE_MS = 2 * 86_400_000;

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

/**
 * Suffix entries (".gov", ".ac.uk") match that public suffix exactly;
 * domain entries ("arxiv.org") match the domain or any subdomain of it.
 * Suffix matching is label-aware: "cardiac.uk" is not under ".ac.uk".
 */
export function isPrimaryHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (!h) return false;
  return PRIMARY_HOSTS.some((p) => (p.startsWith(".") ? h.endsWith(p) : h === p || h.endsWith("." + p)));
}

function pathnameOf(url: string): string {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return "";
  }
}

/** Parse a date candidate into YYYY-MM-DD, rejecting garbage and implausible future dates. */
function toIsoDate(raw: string | undefined, nowMs: number): string | null {
  if (!raw) return null;
  const t = Date.parse(raw.replace(/\b(Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\./i, "$1").trim());
  if (Number.isNaN(t) || t > nowMs + FUTURE_TOLERANCE_MS) return null;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Publication date, strongest signal first: page metadata, a labelled date in
 * the text ("Published Oct 5, 2026"), the Last-Modified header, then any
 * unlabelled date near the top of the page.
 *
 * The HTTP `Date` header is deliberately ignored: it is the time the response
 * was generated, so trusting it made every page look published today.
 */
export function detectPublishedAt(input: SourceInput): string | null {
  const nowMs = input.fetchedAt ? Date.parse(input.fetchedAt) : Date.now();
  const haystack = `${input.title ?? ""}\n${(input.text ?? "").slice(0, 4000)}`;
  const candidates: Array<() => string | undefined> = [
    () => input.publishedHint,
    () => haystack.match(LABELLED_DATE_PATTERN)?.[1],
    () => input.headers?.["last-modified"],
    ...LOOSE_DATE_PATTERNS.map((p) => () => haystack.match(p)?.[1]),
  ];
  for (const candidate of candidates) {
    const iso = toIsoDate(candidate(), nowMs);
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
  const scoredAt = input.fetchedAt ?? new Date().toISOString();
  const nowMs = Date.parse(scoredAt);

  /* --- 0. gate: dead/inaccessible pages score 0 -------------------- */
  if (input.status < 200 || input.status > 299) {
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
      scoredAt,
    };
  }

  /* --- 1. availability & substance (20) ---------------------------- */
  const textLen = text.length;
  let availabilityPoints: number;
  if (textLen >= 3000) availabilityPoints = 14;
  else if (textLen >= 800) availabilityPoints = 10;
  else if (textLen >= 300) availabilityPoints = 6;
  else availabilityPoints = 2;
  availabilityPoints += 2; // reachable 2xx by construction here
  if (textLen < 300) flags.push("thin-content");

  const sourcePrimary = isPrimaryHost(host);
  // self-published primary: vendor describing its own product/release-of-record
  const selfPublished = !sourcePrimary && SELF_PUBLISHED_HINTS.some((p) => pathnameOf(input.url).includes(p));
  const primaryRelevant = sourcePrimary || selfPublished;

  /* --- 2. primary-source status (32) ------------------------------- */
  let primaryPoints = 0;
  let outboundCitations = 0;
  if (primaryRelevant) {
    primaryPoints = 26; // host or path signals it
  } else {
    // secondary corroboration still valuable: multi-source attribution
    outboundCitations = (text.match(/https?:\/\/[^\s")\]]{20,}/g) ?? []).length;
    if (outboundCitations >= 5) primaryPoints = 14;
    else if (outboundCitations >= 2) primaryPoints = 8;
    else if (outboundCitations >= 1) primaryPoints = 4;
  }

  /* --- 3. freshness (24) ------------------------------------------- */
  const publishedAt = detectPublishedAt(input);
  let freshnessDays: number | null = null;
  let freshnessPoints = 0;
  if (publishedAt) {
    const days = Math.max(0, Math.floor((nowMs - Date.parse(publishedAt)) / 86_400_000));
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

  /* --- 4. paywall / access friction (12) --------------------------- */
  const accessHaystack = `${input.title ?? ""}\n${text.slice(0, 2000)}`;
  const paywalled = PAYWALL_SIGNALS.some((p) => p.test(accessHaystack));
  if (paywalled) flags.push("paywall");
  const accessPoints = paywalled ? 3 : 12;

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
  if (!coi && !primaryRelevant && /\/products?\//.test(pathnameOf(input.url))) {
    flags.push("vendor-page");
  }
  const independencePoints = coi ? 4 : 12;

  const breakdown: ScoreBreakdown[] = [
    {
      dimension: "availability & substance",
      points: availabilityPoints,
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
        : selfPublished
          ? "self-published primary (announcement/press/release path)"
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
      points: accessPoints,
      max: 12,
      verdict: "unknown",
      notes: paywalled ? "paywall/registration signals present — excerpt only" : "open access",
    },
    {
      dimension: "independence",
      points: independencePoints,
      max: 12,
      verdict: coi ? "unknown" : primaryRelevant ? "primary" : "unknown",
      notes: coi ? "sponsored/affiliate/partnership language found" : "no COI markers detected",
    },
  ];

  // The score is the sum of the breakdown, so the evidence always adds up.
  const score = Math.max(0, Math.min(100, breakdown.reduce((sum, b) => sum + b.points, 0)));
  const grade: SourceScore["grade"] = score >= 80 ? "A" : score >= 65 ? "B" : score >= 45 ? "C" : "D";

  return {
    url: input.url,
    score,
    grade,
    isPrimarySource: primaryRelevant,
    publishedAt,
    freshnessDays,
    flags,
    breakdown,
    scoredAt,
  };
}
