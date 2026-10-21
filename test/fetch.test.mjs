import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { fetchSource, htmlToText, extractTitle, extractPublishedHint, decodeEntities, isHttpUrl } from "../dist/fetch.js";
import { startFixtureServer, articleHtml } from "./helpers/fixtures.mjs";

describe("HTML helpers", () => {
  test("htmlToText strips scripts, styles, comments and tags and collapses whitespace", () => {
    const html = `<html><head><style>p{}</style><script>alert("x")</script></head>
      <body><!-- hidden --><noscript>enable js</noscript><p>Hello&nbsp;<b>world</b></p>\n\n<p>A &amp; B</p></body></html>`;
    assert.equal(htmlToText(html), "Hello world A & B");
  });

  test("decodeEntities handles named, decimal and hex entities and leaves unknown ones", () => {
    assert.equal(decodeEntities("it&#8217;s &#x27;ok&#x27; &mdash; &lt;b&gt; &bogus;"), "it’s 'ok' — <b> &bogus;");
  });

  test("extractTitle decodes and collapses the <title>", () => {
    assert.equal(extractTitle("<title>\n  Tom &amp; Jerry\n</title>"), "Tom & Jerry");
    assert.equal(extractTitle("<p>no title</p>"), "");
  });

  test("extractPublishedHint reads meta tags in any attribute order", () => {
    assert.equal(extractPublishedHint(`<meta content="2025-01-02" property="article:published_time">`), "2025-01-02");
    assert.equal(extractPublishedHint(`<meta name='citation_publication_date' content='2020/05/06'>`), "2020/05/06");
    assert.equal(extractPublishedHint(`<meta name="description" content="2025-01-02"><meta itemprop="datePublished" content="2024-12-31">`), "2024-12-31");
  });

  test("extractPublishedHint falls back to JSON-LD, then <time datetime>", () => {
    assert.equal(extractPublishedHint(`<script type="application/ld+json">{"datePublished": "2023-04-05"}</script>`), "2023-04-05");
    assert.equal(extractPublishedHint(`<time class="x" datetime="2022-02-02T00:00Z">Feb 2</time>`), "2022-02-02T00:00Z");
    assert.equal(extractPublishedHint("<p>nothing</p>"), undefined);
  });

  test("isHttpUrl only accepts http and https", () => {
    assert.equal(isHttpUrl("https://a.example/"), true);
    assert.equal(isHttpUrl("http://a.example/"), true);
    for (const u of ["file:///etc/passwd", "data:text/html,hi", "ftp://a.example/", "not a url"]) assert.equal(isHttpUrl(u), false, u);
  });
});

describe("fetchSource", () => {
  let fx;
  before(async () => {
    fx = await startFixtureServer({
      "/article": { body: articleHtml({ title: "Tom &amp; Jerry", published: "2026-09-30" }), headers: { "last-modified": "Mon, 05 Jan 2026 00:00:00 GMT" } },
      "/json": { body: '{"hello":"world"}', headers: { "content-type": "application/json" } },
      "/gone": { status: 410, body: "<title>Gone</title>" },
      "/redirect": (_req, res) => res.writeHead(302, { location: "/article" }).end(),
      "/slow": (_req, res) => setTimeout(() => res.writeHead(200).end("late"), 2000),
      "/big": (_req, res) => {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("x".repeat(64 * 1024));
      },
      "/ua": (req, res) => res.writeHead(200, { "content-type": "text/plain" }).end(req.headers["user-agent"]),
    });
  });
  after(() => fx.close());

  test("fetches HTML: title, flattened text, headers, publication hint", async () => {
    const got = await fetchSource(fx.url("/article"));
    assert.equal(got.status, 200);
    assert.equal(got.title, "Tom & Jerry");
    assert.equal(got.publishedHint, "2026-09-30T09:00:00Z");
    assert.equal(got.headers["last-modified"], "Mon, 05 Jan 2026 00:00:00 GMT");
    assert.ok(!got.text.includes("tracking"), "script content must be stripped");
    assert.ok(got.text.length > 3000);
    assert.equal(got.truncated, false);
  });

  test("returns non-HTML bodies as raw text", async () => {
    const got = await fetchSource(fx.url("/json"));
    assert.equal(got.text, '{"hello":"world"}');
    assert.equal(got.title, "");
    assert.equal(got.publishedHint, undefined);
  });

  test("reports non-2xx statuses instead of throwing", async () => {
    assert.equal((await fetchSource(fx.url("/gone"))).status, 410);
  });

  test("follows redirects and reports the final URL", async () => {
    const got = await fetchSource(fx.url("/redirect"));
    assert.equal(got.finalUrl, fx.url("/article"));
  });

  test("times out with a clear error", async () => {
    await assert.rejects(fetchSource(fx.url("/slow"), { timeoutMs: 100 }), /Timed out after 100ms/);
  });

  test("caps the body at maxBytes and marks it truncated", async () => {
    const got = await fetchSource(fx.url("/big"), { maxBytes: 1000 });
    assert.equal(got.text.length, 1000);
    assert.equal(got.truncated, true);
  });

  test("sends a versioned user-agent", async () => {
    const got = await fetchSource(fx.url("/ua"));
    assert.match(got.text, /^research-scope-mcp\/\d+\.\d+\.\d+/);
  });

  test("rejects non-http(s) URLs before fetching", async () => {
    await assert.rejects(fetchSource("file:///etc/passwd"), /Only http\(s\) URLs/);
  });

  test("wraps connection failures with the URL", async () => {
    await assert.rejects(fetchSource("http://127.0.0.1:1/"), /Could not fetch http:\/\/127\.0\.0\.1:1\//);
  });
});
