import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { scoreSource, detectPublishedAt, isPrimaryHost } from "../dist/scoring/score.js";

const FETCHED_AT = "2026-10-21T12:00:00.000Z";
const LONG = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(80); // > 3000 chars

function score(overrides = {}) {
  return scoreSource({ url: "https://example.com/article", title: "", text: LONG, status: 200, fetchedAt: FETCHED_AT, ...overrides });
}

const sumOf = (s) => s.breakdown.reduce((n, b) => n + b.points, 0);

describe("isPrimaryHost", () => {
  test("matches public suffixes and their subdomains", () => {
    for (const h of ["nhtsa.gov", "www.nhtsa.gov", "army.mil", "mit.edu", "ox.ac.uk", "www.gov.uk", "arxiv.org", "export.arxiv.org", "doi.org", "www.courtlistener.com"]) {
      assert.equal(isPrimaryHost(h), true, h);
    }
  });

  test("does not match lookalike hosts (label-aware suffix matching)", () => {
    for (const h of ["cardiac.uk", "notarxiv.org", "arxiv.org.evil.com", "gov.example.com", "example.com", "governance.io", ""]) {
      assert.equal(isPrimaryHost(h), false, h);
    }
  });

  test("is case-insensitive and tolerates a trailing dot", () => {
    assert.equal(isPrimaryHost("WWW.NHTSA.GOV."), true);
  });
});

describe("detectPublishedAt", () => {
  const base = { url: "https://example.com", text: "", status: 200, fetchedAt: FETCHED_AT };

  test("ignores the HTTP Date header (response time, not publication time)", () => {
    assert.equal(detectPublishedAt({ ...base, headers: { date: "Wed, 21 Oct 2026 12:00:00 GMT" } }), null);
  });

  test("prefers page metadata over body text and Last-Modified", () => {
    const got = detectPublishedAt({
      ...base,
      publishedHint: "2024-03-05T10:00:00Z",
      text: "Published on June 1, 2025",
      headers: { "last-modified": "Tue, 20 Oct 2026 00:00:00 GMT" },
    });
    assert.equal(got, "2024-03-05");
  });

  test("prefers a labelled date in the text over Last-Modified", () => {
    const got = detectPublishedAt({ ...base, text: "Posted on Sept. 3, 2025 by staff", headers: { "last-modified": "Tue, 20 Oct 2026 00:00:00 GMT" } });
    assert.equal(got, "2025-09-03");
  });

  test("falls back to Last-Modified, then loose dates", () => {
    assert.equal(detectPublishedAt({ ...base, headers: { "last-modified": "Mon, 05 Jan 2026 00:00:00 GMT" } }), "2026-01-05");
    assert.equal(detectPublishedAt({ ...base, text: "Data as of 2023-07-14 from the registry" }), "2023-07-14");
    assert.equal(detectPublishedAt({ ...base, text: "Meeting held 14 March 2022" }), "2022-03-14");
  });

  test("rejects unparseable and far-future dates", () => {
    assert.equal(detectPublishedAt({ ...base, publishedHint: "not a date" }), null);
    assert.equal(detectPublishedAt({ ...base, text: "Conference on Dec 1, 2030" }), null);
  });

  test("returns null when nothing looks like a date", () => {
    assert.equal(detectPublishedAt({ ...base, text: "no dates here" }), null);
  });
});

describe("scoreSource", () => {
  test("non-2xx responses score 0/D with dead-link and http-<status> flags", () => {
    for (const status of [404, 500, 301, 199]) {
      const s = score({ status });
      assert.equal(s.score, 0);
      assert.equal(s.grade, "D");
      assert.deepEqual(s.flags, [`http-${status}`, "dead-link"]);
    }
  });

  test("any 2xx status is scored", () => {
    assert.ok(score({ status: 203 }).score > 0);
  });

  test("the score always equals the sum of the breakdown", () => {
    const cases = [
      {},
      { url: "https://www.nhtsa.gov/x", publishedHint: "2026-10-10" },
      { text: `See https://example.org/aaaaaaaaaaaaaaaaaaaa and https://example.net/bbbbbbbbbbbbbbbbbbbb ${LONG}` },
      { text: "short", title: "Subscribe now to read" },
      { text: `Sponsored by Acme. ${LONG}` },
    ];
    for (const c of cases) {
      const s = score(c);
      assert.equal(s.score, sumOf(s), JSON.stringify(c));
      assert.equal(s.breakdown.length, 5);
      for (const b of s.breakdown) assert.ok(b.points >= 0 && b.points <= b.max, `${b.dimension} ${b.points}/${b.max}`);
    }
  });

  test("a fresh, open, substantive .gov page grades A", () => {
    const s = score({ url: "https://www.nhtsa.gov/press", publishedHint: "2026-10-15" });
    assert.equal(s.isPrimarySource, true);
    assert.equal(s.freshnessDays, 6);
    assert.equal(s.score, 16 + 26 + 24 + 12 + 12);
    assert.equal(s.grade, "A");
    assert.deepEqual(s.flags, []);
  });

  test("self-published press/release paths count as primary; the host alone does not", () => {
    assert.equal(score({ url: "https://vendor.example/press-release/new-thing" }).isPrimarySource, true);
    assert.equal(score({ url: "https://vendor.example/releases/v2" }).isPrimarySource, true);
    assert.equal(score({ url: "https://vendor.example/blog?ref=changelog-digest" }).isPrimarySource, false);
  });

  test("secondary sources earn primary-source points for outbound citations (and the breakdown shows it)", () => {
    const links = Array.from({ length: 5 }, (_, i) => `https://source${i}.example.org/report/2026/finding`).join(" ");
    const s = score({ text: `${links} ${LONG}` });
    const primary = s.breakdown.find((b) => b.dimension === "primary-source");
    assert.equal(primary.points, 14);
    assert.equal(primary.verdict, "secondary");
    assert.match(primary.notes, /5 outbound citation/);
  });

  test("freshness decays with age and flags >5y as stale", () => {
    const fresh = (date) => score({ publishedHint: date }).breakdown.find((b) => b.dimension === "freshness").points;
    assert.equal(fresh("2026-10-01"), 24);
    assert.equal(fresh("2026-06-01"), 18);
    assert.equal(fresh("2025-06-01"), 12);
    assert.equal(fresh("2022-06-01"), 6);
    assert.equal(fresh("2019-01-01"), 2);
    assert.ok(score({ publishedHint: "2019-01-01" }).flags.includes("stale:>5y"));
    assert.ok(score({}).flags.includes("no-date"));
  });

  test("paywall phrases are flagged; merely mentioning paywalls is not", () => {
    assert.ok(score({ text: `Subscribe to continue reading. ${LONG}` }).flags.includes("paywall"));
    assert.ok(score({ text: `This article is for members only. ${LONG}` }).flags.includes("paywall"));
    assert.ok(score({ title: "Premium content", text: LONG }).flags.includes("paywall"));
    assert.ok(!score({ text: `Why newspapers adopted the paywall model in 2012. ${LONG}` }).flags.includes("paywall"));
  });

  test("conflict-of-interest markers are flagged and cost independence points", () => {
    const cases = [
      ["Sponsored by Acme Corp.", "conflict-of-interest:sponsored"],
      ["Content in partnership with Acme Corp", "conflict-of-interest:partnership"],
      ["We may earn a commission from links.", "conflict-of-interest:affiliate"],
      ["Affiliate disclosure: links pay us.", "conflict-of-interest:affiliate"],
    ];
    for (const [text, flag] of cases) {
      const s = score({ text: `${text} ${LONG}` });
      assert.ok(s.flags.includes(flag), `${text} -> ${s.flags}`);
      assert.equal(s.breakdown.find((b) => b.dimension === "independence").points, 4);
    }
  });

  test("unmarked vendor product pages get a vendor-page flag", () => {
    assert.ok(score({ url: "https://vendor.example/products/widget" }).flags.includes("vendor-page"));
    assert.ok(!score({ url: "https://vendor.example/blog/widget" }).flags.includes("vendor-page"));
  });

  test("thin content is flagged", () => {
    assert.ok(score({ text: "tiny" }).flags.includes("thin-content"));
  });

  test("grades follow the documented thresholds", () => {
    for (const s of [score({}), score({ text: "x" }), score({ url: "https://mit.edu/a", publishedHint: "2026-10-20" })]) {
      const expected = s.score >= 80 ? "A" : s.score >= 65 ? "B" : s.score >= 45 ? "C" : "D";
      assert.equal(s.grade, expected);
    }
  });

  test("scoredAt uses fetchedAt when given", () => {
    assert.equal(score({}).scoredAt, FETCHED_AT);
  });
});
