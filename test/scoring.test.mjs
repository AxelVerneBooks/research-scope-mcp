/** Unit tests for the source-quality scorer (src/scoring/score.ts). */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { scoreSource, detectPublishedAt, isPrimaryHost } from "../dist/scoring/score.js";
import { longText } from "./helpers.mjs";

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const base = (over = {}) => ({ url: "https://example.com/article", title: "Article", text: longText(3500), status: 200, ...over });
const sumBreakdown = (s) => s.breakdown.reduce((acc, b) => acc + b.points, 0);

describe("isPrimaryHost", () => {
  test("matches suffix classes and named domains with their subdomains", () => {
    for (const h of ["www.nhtsa.gov", "nasa.gov", "data.gov.uk", "army.mil", "mit.edu", "ox.ac.uk", "arxiv.org", "export.arxiv.org", "doi.org", "www.courtlistener.com"]) {
      assert.equal(isPrimaryHost(h), true, h);
    }
  });
  test("rejects look-alikes that merely end with the same letters", () => {
    for (const h of ["example.com", "notarxiv.org", "arxiv.org.evil.com", "fakegov", "medu", "govtrack.us", ""]) {
      assert.equal(isPrimaryHost(h), false, h);
    }
  });
});

describe("detectPublishedAt", () => {
  test("ignores the HTTP Date header (response time, not publication time)", () => {
    const today = new Date().toUTCString();
    assert.equal(detectPublishedAt({ text: "no dates in here", headers: { date: today }, status: 200, url: "https://x.test" }), null);
  });
  test("prefers the page's own meta declaration over Last-Modified and body text", () => {
    const got = detectPublishedAt({
      url: "https://x.test",
      status: 200,
      metaPublished: "2024-03-05T10:00:00.000Z",
      headers: { "last-modified": "Wed, 21 Oct 2015 07:28:00 GMT" },
      text: "Posted on January 2, 2020",
    });
    assert.equal(got, "2024-03-05");
  });
  test("falls back to Last-Modified, then to dates in the text", () => {
    assert.equal(detectPublishedAt({ url: "u", status: 200, headers: { "last-modified": "Wed, 21 Oct 2015 07:28:00 GMT" }, text: "" }), "2015-10-21");
    assert.equal(detectPublishedAt({ url: "u", status: 200, text: "Published on Mar. 14, 2023 by staff" }), "2023-03-14");
    assert.equal(detectPublishedAt({ url: "u", status: 200, text: "release 2022-11-30 notes" }), "2022-11-30");
    assert.equal(detectPublishedAt({ url: "u", status: 200, text: "Updated 7 June 2021" }), "2021-06-07");
  });
  test("invalid meta values fall through instead of throwing", () => {
    assert.equal(detectPublishedAt({ url: "u", status: 200, metaPublished: "not a date", text: "2020-01-01" }), "2020-01-01");
  });
});

describe("scoreSource", () => {
  test("non-200 pages score 0 / D with dead-link flags", () => {
    const s = scoreSource(base({ status: 404 }));
    assert.equal(s.score, 0);
    assert.equal(s.grade, "D");
    assert.deepEqual(s.flags, ["http-404", "dead-link"]);
  });

  test("fresh, open, substantial primary-host page grades A", () => {
    const s = scoreSource(base({ url: "https://www.agency.gov/rule", metaPublished: daysAgo(3) }));
    assert.equal(s.isPrimarySource, true);
    assert.equal(s.grade, "A");
    assert.equal(s.score, 90);
    assert.deepEqual(s.flags, []);
  });

  test("breakdown points always sum to the score (secondary sources included)", () => {
    const cited = Array.from({ length: 6 }, (_, i) => `https://source-number-${i}.example.org/ref`).join(" ");
    const cases = [
      base({ url: "https://www.agency.gov/rule", metaPublished: daysAgo(3) }),
      base({ text: `${longText(1000)} ${cited}` }),
      base({ text: `${longText(400)} https://one-citation.example.org/ref sponsored by Acme` }),
      base({ text: "tiny" }),
      base({ text: `${longText(3500)} Subscribe now to continue reading`, metaPublished: daysAgo(4000) }),
    ];
    for (const c of cases) {
      const s = scoreSource(c);
      assert.equal(sumBreakdown(s), s.score, JSON.stringify(s.breakdown));
      for (const b of s.breakdown) assert.ok(b.points <= b.max, `${b.dimension}: ${b.points} > ${b.max}`);
    }
  });

  test("secondary sources earn points for outbound citations", () => {
    const none = scoreSource(base());
    const many = scoreSource(base({ text: `${longText(3500)} ${Array.from({ length: 5 }, (_, i) => `https://cited-${i}.example.org/path/x`).join(" ")}` }));
    assert.equal(many.score - none.score, 14);
    assert.equal(many.breakdown.find((b) => b.dimension === "primary-source").verdict, "secondary");
  });

  test("self-published press paths count as primary", () => {
    const s = scoreSource(base({ url: "https://vendor.com/press/2025-launch" }));
    assert.equal(s.isPrimarySource, true);
  });

  test("freshness decays and flags stale / undated pages", () => {
    const pts = (d) => scoreSource(base({ metaPublished: daysAgo(d) })).breakdown.find((b) => b.dimension === "freshness").points;
    assert.deepEqual([pts(10), pts(100), pts(400), pts(1000), pts(3000)], [24, 18, 12, 6, 2]);
    assert.ok(scoreSource(base({ metaPublished: daysAgo(3000) })).flags.includes("stale:>5y"));
    assert.ok(scoreSource(base()).flags.includes("no-date"));
  });

  test("paywall, conflict-of-interest, thin-content and vendor-page flags", () => {
    assert.ok(scoreSource(base({ text: "Please log in to continue " + longText(1000) })).flags.includes("paywall"));
    assert.ok(scoreSource(base({ text: longText(1000) + " This post is sponsored by Acme." })).flags.includes("conflict-of-interest:sponsored"));
    assert.ok(scoreSource(base({ text: "We may earn a commission " + longText(1000) })).flags.includes("conflict-of-interest:affiliate"));
    assert.ok(scoreSource(base({ text: "short" })).flags.includes("thin-content"));
    assert.ok(scoreSource(base({ url: "https://shop.example.com/products/widget" })).flags.includes("vendor-page"));
  });

  test("grade thresholds", () => {
    for (const s of [scoreSource(base()), scoreSource(base({ text: "x" })), scoreSource(base({ url: "https://a.gov/", metaPublished: daysAgo(1) }))]) {
      const expected = s.score >= 80 ? "A" : s.score >= 65 ? "B" : s.score >= 45 ? "C" : "D";
      assert.equal(s.grade, expected);
    }
  });

  test("uses fetchedAt as scoredAt when given", () => {
    assert.equal(scoreSource(base({ fetchedAt: "2026-01-01T00:00:00.000Z" })).scoredAt, "2026-01-01T00:00:00.000Z");
  });
});
