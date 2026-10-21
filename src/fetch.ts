/**
 * research-scope-mcp — source fetching. Owns all network access for
 * fetch_and_score; the scorer itself never touches the network.
 */

import { extractMetaPublished, extractTitle, htmlToText } from "./report.js";
import { version } from "./version.js";

export interface FetchedSource {
  status: number;
  title: string;
  text: string;
  metaPublished?: string;
  headers: Record<string, string>;
  finalUrl: string;
}

/** Bodies beyond this are truncated: enough for any article, bounded for hostile pages. */
export const MAX_BODY_BYTES = 5 * 1024 * 1024;

export class FetchError extends Error {}

export function assertFetchableUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new FetchError(`Not a valid URL: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new FetchError(`Only http(s) URLs can be fetched, got ${parsed.protocol}`);
  }
  return parsed;
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
    if (total >= maxBytes) {
      await reader.cancel();
      break;
    }
  }
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, maxBytes));
}

export async function fetchSource(url: string, timeoutMs = 15000): Promise<FetchedSource> {
  assertFetchableUrl(url);
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
    const raw = await readCapped(res, MAX_BODY_BYTES);
    const isHtml = contentType.includes("html");
    return {
      status: res.status,
      title: isHtml ? extractTitle(raw) : "",
      text: isHtml ? htmlToText(raw) : raw.slice(0, 200_000),
      metaPublished: isHtml ? extractMetaPublished(raw) : undefined,
      headers: {
        "content-type": contentType,
        "last-modified": res.headers.get("last-modified") ?? "",
      },
      finalUrl: res.url || url,
    };
  } catch (err) {
    if (err instanceof FetchError) throw err;
    const reason = controller.signal.aborted ? `timed out after ${timeoutMs}ms` : ((err as Error).cause as Error | undefined)?.message ?? (err as Error).message;
    throw new FetchError(`Could not fetch ${url}: ${reason}`);
  } finally {
    clearTimeout(timer);
  }
}
