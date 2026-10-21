/**
 * Local HTTP fixture server so fetch_and_score can be tested end to end
 * without touching the network (CI runners and sandboxes often have none).
 */
import { createServer } from "node:http";
import { once } from "node:events";

/**
 * Start a server whose routes map a path to { status, headers, body } or to a
 * function (req, res) => void. Returns { baseUrl, url(path), close() }.
 */
export async function startFixtureServer(routes) {
  const server = createServer((req, res) => {
    const path = req.url.split("?")[0];
    const route = routes[path];
    if (!route) {
      res.writeHead(404, { "content-type": "text/html" }).end("<title>Not found</title><p>nope</p>");
      return;
    }
    if (typeof route === "function") return route(req, res);
    res.writeHead(route.status ?? 200, { "content-type": "text/html; charset=utf-8", ...(route.headers ?? {}) });
    res.end(route.body ?? "");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    baseUrl,
    url: (path) => `${baseUrl}${path}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** A substantive HTML article with a metadata publication date. */
export function articleHtml({ title = "Fixture article", published = "2026-10-01", body = "", extraHead = "" } = {}) {
  const filler = "Independent analysis of the regulation with detailed sourcing and quotes from primary documents. ".repeat(40);
  return `<!doctype html><html><head><title>${title}</title>
<meta property="article:published_time" content="${published}T09:00:00Z">${extraHead}
<style>.x{color:red}</style><script>var tracking = "Published Jan 1, 1999";</script></head>
<body><h1>${title}</h1><p>${body}</p><p>${filler}</p></body></html>`;
}
