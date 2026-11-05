/**
 * Outbound HTTP policy: request timeouts + basic rate-limit awareness.
 *
 * Every outbound call the server makes (today: `fetch_and_score`) goes through
 * `fetchText`, which
 *   - aborts the request (headers *and* body) after `timeoutMs`,
 *   - on 429 / 503 honours `Retry-After` (delta-seconds or HTTP-date) when the
 *     upstream sends it, otherwise falls back to exponential backoff with jitter,
 *   - gives up with a typed error rather than hanging or silently scoring an
 *     error page.
 *
 * `fetch`, `sleep`, `now` and `random` are injectable so the branches can be
 * unit-tested with mocks and fake time (no real network, no real waiting).
 */

export interface FetchPolicyConfig {
  /** Per-attempt timeout in ms (covers connect, headers and body read). */
  timeoutMs: number;
  /** Retries after the first attempt for rate-limited (429/503) responses. */
  maxRetries: number;
  /** Base delay for exponential backoff when no Retry-After is given. */
  retryBaseDelayMs: number;
  /** Upper bound on any single wait; a longer Retry-After is not waited out. */
  retryMaxDelayMs: number;
}

export const DEFAULT_FETCH_POLICY: FetchPolicyConfig = {
  timeoutMs: 15_000,
  maxRetries: 2,
  retryBaseDelayMs: 500,
  retryMaxDelayMs: 30_000,
};

/** Status codes treated as "rate limited / try later". */
export const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 503]);

export const ENV_KEYS = {
  timeoutMs: "RESEARCH_SCOPE_FETCH_TIMEOUT_MS",
  maxRetries: "RESEARCH_SCOPE_FETCH_MAX_RETRIES",
  retryBaseDelayMs: "RESEARCH_SCOPE_FETCH_RETRY_BASE_MS",
  retryMaxDelayMs: "RESEARCH_SCOPE_FETCH_RETRY_MAX_DELAY_MS",
} as const satisfies Record<keyof FetchPolicyConfig, string>;

/**
 * Read the policy from environment variables. Unset, empty, non-numeric or
 * out-of-range values fall back to the default (timeout must be > 0; the others
 * must be >= 0).
 */
export function loadFetchPolicy(env: Record<string, string | undefined> = process.env): FetchPolicyConfig {
  const read = (key: keyof FetchPolicyConfig, min: number): number => {
    const raw = env[ENV_KEYS[key]];
    if (raw === undefined || raw.trim() === "") return DEFAULT_FETCH_POLICY[key];
    const n = Number(raw);
    return Number.isFinite(n) && n >= min ? Math.floor(n) : DEFAULT_FETCH_POLICY[key];
  };
  return {
    timeoutMs: read("timeoutMs", 1),
    maxRetries: read("maxRetries", 0),
    retryBaseDelayMs: read("retryBaseDelayMs", 0),
    retryMaxDelayMs: read("retryMaxDelayMs", 0),
  };
}

export class FetchTimeoutError extends Error {
  readonly url: string;
  readonly timeoutMs: number;
  constructor(url: string, timeoutMs: number) {
    super(`Request to ${url} timed out after ${timeoutMs} ms`);
    this.name = "FetchTimeoutError";
    this.url = url;
    this.timeoutMs = timeoutMs;
  }
}

export class RateLimitedError extends Error {
  readonly url: string;
  readonly status: number;
  readonly attempts: number;
  /** Server-requested wait in ms, if it sent a parseable Retry-After. */
  readonly retryAfterMs: number | null;
  constructor(url: string, status: number, attempts: number, retryAfterMs: number | null, reason: string) {
    const hint = retryAfterMs !== null ? ` (Retry-After: ${Math.ceil(retryAfterMs / 1000)} s)` : "";
    super(`Rate limited by ${url}: HTTP ${status} after ${attempts} attempt(s)${hint} — ${reason}`);
    this.name = "RateLimitedError";
    this.url = url;
    this.status = status;
    this.attempts = attempts;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Parse a Retry-After header value into milliseconds from `nowMs`.
 * Accepts delta-seconds ("120") or an HTTP-date. Returns null if absent/unparseable.
 */
export function parseRetryAfter(value: string | null | undefined, nowMs: number): number | null {
  if (value === null || value === undefined) return null;
  const v = value.trim();
  if (v === "") return null;
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v) * 1000);
  const at = Date.parse(v);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - nowMs);
}

/** Exponential backoff with "equal jitter": half fixed, half random. */
export function backoffDelay(attempt: number, cfg: FetchPolicyConfig, random: () => number): number {
  const exp = Math.min(cfg.retryMaxDelayMs, cfg.retryBaseDelayMs * 2 ** attempt);
  return Math.round(exp / 2 + random() * (exp / 2));
}

export interface FetchDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  random: () => number;
}

export const defaultDeps: FetchDeps = {
  fetch: (...args) => globalThis.fetch(...args),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
  random: () => Math.random(),
};

export interface FetchTextResult {
  status: number;
  headers: Headers;
  text: string;
  url: string;
  /** Total attempts made (1 = no retries). */
  attempts: number;
}

/** One attempt: fetch + body read, both bounded by the timeout. */
async function attemptOnce(
  url: string,
  init: RequestInit,
  cfg: FetchPolicyConfig,
  deps: FetchDeps
): Promise<{ res: Response; text: string }> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Race against our own timer too, so a fetch implementation that ignores the
  // abort signal still cannot hang the tool call.
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new FetchTimeoutError(url, cfg.timeoutMs));
    }, cfg.timeoutMs);
  });
  try {
    const work = (async () => {
      const res = await deps.fetch(url, { ...init, signal: controller.signal });
      const text = await res.text();
      return { res, text };
    })();
    work.catch(() => {}); // avoid unhandled rejection if the timeout wins
    return await Promise.race([work, timeout]);
  } catch (err) {
    if (controller.signal.aborted || (err as Error)?.name === "AbortError") {
      throw new FetchTimeoutError(url, cfg.timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch `url` and read the body as text under the given policy.
 * Throws FetchTimeoutError or RateLimitedError; any other network error propagates.
 */
export async function fetchText(
  url: string,
  init: RequestInit = {},
  cfg: FetchPolicyConfig = DEFAULT_FETCH_POLICY,
  deps: FetchDeps = defaultDeps
): Promise<FetchTextResult> {
  for (let attempt = 0; ; attempt++) {
    const { res, text } = await attemptOnce(url, init, cfg, deps);
    if (!RETRYABLE_STATUSES.has(res.status)) {
      return { status: res.status, headers: res.headers, text, url: res.url || url, attempts: attempt + 1 };
    }

    const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"), deps.now());
    if (attempt >= cfg.maxRetries) {
      throw new RateLimitedError(url, res.status, attempt + 1, retryAfterMs, "retries exhausted");
    }
    if (retryAfterMs !== null && retryAfterMs > cfg.retryMaxDelayMs) {
      throw new RateLimitedError(
        url,
        res.status,
        attempt + 1,
        retryAfterMs,
        `requested wait exceeds ${ENV_KEYS.retryMaxDelayMs}=${cfg.retryMaxDelayMs} ms`
      );
    }
    await deps.sleep(retryAfterMs ?? backoffDelay(attempt, cfg, deps.random));
  }
}
