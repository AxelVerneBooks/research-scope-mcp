/**
 * Unit tests for the outbound fetch policy (timeouts + rate-limit handling).
 * Everything is mocked: fetch, sleep, clock and jitter. No network, no real waits
 * (except the few-millisecond timeouts used to exercise the abort path).
 * Run: npm run test:unit
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  fetchText,
  loadFetchPolicy,
  parseRetryAfter,
  backoffDelay,
  DEFAULT_FETCH_POLICY,
  FetchTimeoutError,
  RateLimitedError,
} from "../dist/http/fetchPolicy.js";

const URL_ = "https://example.test/page";
const NOW = Date.parse("2026-11-05T12:00:00Z");

/** Build a fetch mock that replies with the queued responses in order. */
function queuedFetch(...responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("mock fetch: no more queued responses");
    return typeof next === "function" ? next(url, init) : next;
  };
  fn.calls = calls;
  return fn;
}

function deps(fetchImpl, extra = {}) {
  const sleeps = [];
  return {
    sleeps,
    deps: {
      fetch: fetchImpl,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      now: () => NOW,
      random: () => 0.5,
      ...extra,
    },
  };
}

const cfg = (over = {}) => ({ ...DEFAULT_FETCH_POLICY, ...over });
const resp = (status, headers = {}, body = "ok") => new Response(body, { status, headers });

/** A fetch that never resolves unless aborted (then rejects like real fetch). */
function hangingFetch({ honourSignal = true } = {}) {
  return (_url, init) =>
    new Promise((_, reject) => {
      if (!honourSignal) return;
      init.signal.addEventListener("abort", () => {
        const e = new Error("This operation was aborted");
        e.name = "AbortError";
        reject(e);
      });
    });
}

/* --- config ------------------------------------------------------ */

test("loadFetchPolicy: defaults when env is empty", () => {
  assert.deepEqual(loadFetchPolicy({}), DEFAULT_FETCH_POLICY);
});

test("loadFetchPolicy: reads env overrides and rejects invalid values", () => {
  const p = loadFetchPolicy({
    RESEARCH_SCOPE_FETCH_TIMEOUT_MS: "2500",
    RESEARCH_SCOPE_FETCH_MAX_RETRIES: "0",
    RESEARCH_SCOPE_FETCH_RETRY_BASE_MS: "abc",
    RESEARCH_SCOPE_FETCH_RETRY_MAX_DELAY_MS: "-1",
  });
  assert.equal(p.timeoutMs, 2500);
  assert.equal(p.maxRetries, 0);
  assert.equal(p.retryBaseDelayMs, DEFAULT_FETCH_POLICY.retryBaseDelayMs);
  assert.equal(p.retryMaxDelayMs, DEFAULT_FETCH_POLICY.retryMaxDelayMs);
  assert.equal(loadFetchPolicy({ RESEARCH_SCOPE_FETCH_TIMEOUT_MS: "0" }).timeoutMs, DEFAULT_FETCH_POLICY.timeoutMs);
});

/* --- happy path -------------------------------------------------- */

test("fetchText: 200 returns body on first attempt without sleeping", async () => {
  const f = queuedFetch(resp(200, { "content-type": "text/html" }, "<title>x</title>"));
  const { deps: d, sleeps } = deps(f);
  const r = await fetchText(URL_, {}, cfg(), d);
  assert.equal(r.status, 200);
  assert.equal(r.text, "<title>x</title>");
  assert.equal(r.attempts, 1);
  assert.equal(r.url, URL_);
  assert.deepEqual(sleeps, []);
  assert.ok(f.calls[0].init.signal instanceof AbortSignal, "an abort signal is always passed");
});

test("fetchText: non-retryable error statuses (404, 500) are returned, not retried", async () => {
  for (const status of [404, 500]) {
    const f = queuedFetch(resp(status));
    const { deps: d, sleeps } = deps(f);
    const r = await fetchText(URL_, {}, cfg(), d);
    assert.equal(r.status, status);
    assert.equal(f.calls.length, 1);
    assert.deepEqual(sleeps, []);
  }
});

/* --- timeout branch ---------------------------------------------- */

test("timeout: aborts the request and throws FetchTimeoutError", async () => {
  let seenSignal;
  const f = (url, init) => {
    seenSignal = init.signal;
    return hangingFetch()(url, init);
  };
  const { deps: d } = deps(f);
  await assert.rejects(fetchText(URL_, {}, cfg({ timeoutMs: 20 }), d), (err) => {
    assert.ok(err instanceof FetchTimeoutError);
    assert.equal(err.timeoutMs, 20);
    assert.match(err.message, /timed out after 20 ms/);
    return true;
  });
  assert.equal(seenSignal.aborted, true, "the underlying request is aborted");
});

test("timeout: still fires when the fetch implementation ignores the abort signal", async () => {
  const { deps: d } = deps(hangingFetch({ honourSignal: false }));
  await assert.rejects(fetchText(URL_, {}, cfg({ timeoutMs: 20 }), d), FetchTimeoutError);
});

test("timeout: covers a stalled body read, not just headers", async () => {
  const stalledBody = { status: 200, url: URL_, headers: new Headers(), text: () => new Promise(() => {}) };
  const { deps: d } = deps(queuedFetch(stalledBody));
  await assert.rejects(fetchText(URL_, {}, cfg({ timeoutMs: 20 }), d), FetchTimeoutError);
});

test("timeout: is not retried (one attempt only)", async () => {
  let calls = 0;
  const f = (url, init) => {
    calls++;
    return hangingFetch()(url, init);
  };
  const { deps: d } = deps(f);
  await assert.rejects(fetchText(URL_, {}, cfg({ timeoutMs: 10, maxRetries: 3 }), d), FetchTimeoutError);
  assert.equal(calls, 1);
});

test("non-timeout network errors propagate unchanged", async () => {
  const { deps: d } = deps(async () => {
    throw new TypeError("fetch failed");
  });
  await assert.rejects(fetchText(URL_, {}, cfg(), d), (err) => err instanceof TypeError && !(err instanceof FetchTimeoutError));
});

/* --- rate-limit branch ------------------------------------------- */

test("429 with Retry-After seconds: waits exactly that long, then succeeds", async () => {
  const f = queuedFetch(resp(429, { "retry-after": "3" }), resp(200, {}, "done"));
  const { deps: d, sleeps } = deps(f);
  const r = await fetchText(URL_, {}, cfg(), d);
  assert.equal(r.status, 200);
  assert.equal(r.text, "done");
  assert.equal(r.attempts, 2);
  assert.deepEqual(sleeps, [3000]);
});

test("429 with Retry-After HTTP-date: waits until that date", async () => {
  const at = new Date(NOW + 5000).toUTCString();
  const f = queuedFetch(resp(429, { "retry-after": at }), resp(200));
  const { deps: d, sleeps } = deps(f);
  await fetchText(URL_, {}, cfg(), d);
  assert.deepEqual(sleeps, [5000]);
});

test("503 without Retry-After: exponential backoff with jitter", async () => {
  const f = queuedFetch(resp(503), resp(503), resp(200));
  const { deps: d, sleeps } = deps(f);
  const r = await fetchText(URL_, {}, cfg({ retryBaseDelayMs: 100, maxRetries: 2 }), d);
  assert.equal(r.status, 200);
  assert.equal(r.attempts, 3);
  // random() = 0.5 → exp/2 + 0.25*exp = 0.75*exp; exp = 100, 200
  assert.deepEqual(sleeps, [75, 150]);
});

test("rate limited past maxRetries: throws RateLimitedError carrying Retry-After", async () => {
  const f = queuedFetch(resp(429, { "retry-after": "1" }), resp(429, { "retry-after": "2" }));
  const { deps: d, sleeps } = deps(f);
  await assert.rejects(fetchText(URL_, {}, cfg({ maxRetries: 1 }), d), (err) => {
    assert.ok(err instanceof RateLimitedError);
    assert.equal(err.status, 429);
    assert.equal(err.attempts, 2);
    assert.equal(err.retryAfterMs, 2000);
    assert.match(err.message, /retries exhausted/);
    return true;
  });
  assert.deepEqual(sleeps, [1000]);
  assert.equal(f.calls.length, 2);
});

test("maxRetries = 0: a 429 fails immediately without sleeping", async () => {
  const f = queuedFetch(resp(429));
  const { deps: d, sleeps } = deps(f);
  await assert.rejects(fetchText(URL_, {}, cfg({ maxRetries: 0 }), d), RateLimitedError);
  assert.deepEqual(sleeps, []);
  assert.equal(f.calls.length, 1);
});

test("Retry-After longer than retryMaxDelayMs: fails fast instead of waiting it out", async () => {
  const f = queuedFetch(resp(429, { "retry-after": "3600" }));
  const { deps: d, sleeps } = deps(f);
  await assert.rejects(fetchText(URL_, {}, cfg({ retryMaxDelayMs: 10_000 }), d), (err) => {
    assert.ok(err instanceof RateLimitedError);
    assert.equal(err.retryAfterMs, 3_600_000);
    assert.match(err.message, /exceeds RESEARCH_SCOPE_FETCH_RETRY_MAX_DELAY_MS/);
    return true;
  });
  assert.deepEqual(sleeps, []);
});

/* --- helpers ----------------------------------------------------- */

test("parseRetryAfter: seconds, dates, past dates and garbage", () => {
  assert.equal(parseRetryAfter("120", NOW), 120_000);
  assert.equal(parseRetryAfter("0", NOW), 0);
  assert.equal(parseRetryAfter(new Date(NOW + 10_000).toUTCString(), NOW), 10_000);
  assert.equal(parseRetryAfter(new Date(NOW - 10_000).toUTCString(), NOW), 0);
  assert.equal(parseRetryAfter("soon", NOW), null);
  assert.equal(parseRetryAfter("", NOW), null);
  assert.equal(parseRetryAfter(null, NOW), null);
});

test("backoffDelay: grows exponentially and is capped by retryMaxDelayMs", () => {
  const c = cfg({ retryBaseDelayMs: 1000, retryMaxDelayMs: 3000 });
  const lo = () => 0;
  const hi = () => 1;
  assert.equal(backoffDelay(0, c, lo), 500);
  assert.equal(backoffDelay(0, c, hi), 1000);
  assert.equal(backoffDelay(1, c, hi), 2000);
  assert.equal(backoffDelay(5, c, hi), 3000);
});
