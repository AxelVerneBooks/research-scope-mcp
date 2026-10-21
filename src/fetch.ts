/**
 * research-scope-mcp — source fetching
 *
 * Owns the network side of fetch_and_score: one bounded HTTP(S) GET, HTML
 * flattened to text, plus the metadata the scorer needs (title, Last-Modified,
 * publication date from <meta>/JSON-LD/<time> before the markup is stripped).
 */

import { version } from "./version.js";

export interface FetchedSource {
  status: number;
  title: string;
  text: string;
  headers: Record<string, string>;
  finalUrl: string;
  /** Publication date found in page metadata, if any (raw string, unparsed). */
  publishedHint?: string;
  /** True when the body exceeded maxBytes and was cut off. */
  truncated: boolean;
}

export interface FetchOptions {
  timeoutMs?: number;
  /** Upper bound on bytes read from the response body. */
  maxBytes?: number;
}

export const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const MAX_NON_HTML_CHARS = 200_000;

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
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

const PUBLISHED_META_KEYS = new Set([
  "article:published_time",
  "og:published_time",
  "datepublished",
  "date",
  "pubdate",
  "publishdate",
  "publish-date",
  "publication_date",
  "citation_publication_date",
  "citation_date",
  "dc.date",
  "dc.date.issued",
  "dcterms.issued",
  "dcterms.created",
]);

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
}

/** Publication date from page metadata: <meta>, JSON-LD datePublished, then the first <time datetime>. */
export function extractPublishedHint(html: string): string | undefined {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (attr(tag, "property") ?? attr(tag, "name") ?? attr(tag, "itemprop"))?.toLowerCase();
    const content = attr(tag, "content");
    if (key && content && PUBLISHED_META_KEYS.has(key)) return content.trim();
  }
  const ld = html.match(/"datePublished"\s*:\s*"([^"]+)"/);
  if (ld) return ld[1];
  const time = html.match(/<time\b[^>]*\bdatetime\s*=\s*["']([^"']+)["']/i);
  return time ? time[1] : undefined;
}

async function readBounded(res: Response, maxBytes: number): Promise<{ body: string; truncated: boolean }> {
  if (!res.body) return { body: "", truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const room = maxBytes - total;
    if (value.byteLength >= room) {
      chunks.push(value.subarray(0, room));
      total += room;
      truncated = value.byteLength > room;
      if (truncated) await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  return { body: new TextDecoder("utf-8").decode(buf), truncated };
}

export function isHttpUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export async function fetchSource(url: string, options: FetchOptions = {}): Promise<FetchedSource> {
  if (!isHttpUrl(url)) throw new Error(`Only http(s) URLs can be fetched: ${url}`);
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": `research-scope-mcp/${version} (+https://github.com/AxelVerneBooks/research-scope-mcp)`,
        accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
      },
    });
    const contentType = res.headers.get("content-type") ?? "";
    const { body, truncated } = await readBounded(res, maxBytes);
    const isHtml = /html/i.test(contentType) || (!contentType && /^\s*</.test(body));
    return {
      status: res.status,
      title: isHtml ? extractTitle(body) : "",
      text: isHtml ? htmlToText(body) : body.slice(0, MAX_NON_HTML_CHARS),
      headers: {
        "content-type": contentType,
        "last-modified": res.headers.get("last-modified") ?? "",
        date: res.headers.get("date") ?? "",
      },
      finalUrl: res.url || url,
      publishedHint: isHtml ? extractPublishedHint(body) : undefined,
      truncated,
    };
  } catch (err) {
    if (controller.signal.aborted) throw new Error(`Timed out after ${timeoutMs}ms fetching ${url}`);
    const cause = (err as Error & { cause?: Error }).cause;
    throw new Error(`Could not fetch ${url}: ${(err as Error).message}${cause?.message ? ` (${cause.message})` : ""}`);
  } finally {
    clearTimeout(timer);
  }
}
