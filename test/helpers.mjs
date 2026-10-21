/** Shared test helpers: in-process MCP client, local fixture web server, temp dirs. */
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import assert from "node:assert/strict";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { buildServer, createState } from "../dist/server.js";

export function tempDir(prefix = "rsmcp-test-") {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Connect an SDK client to a fresh in-process server sharing `state`. */
export async function connectInProcess(state = createState({ dataDir: tempDir().dir })) {
  const server = buildServer(state);
  const client = new Client({ name: "test-client", version: "0.0.1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    state,
    call: (name, args) => client.callTool({ name, arguments: args }),
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

/** First text payload of a tool result. */
export function text(result) {
  assert.ok(result?.content?.[0]?.text, `no text content in ${JSON.stringify(result)}`);
  return result.content[0].text;
}

export const json = (result) => JSON.parse(text(result));

/**
 * Local web server standing in for the internet. `routes` maps a path to
 * { status?, headers?, body } or to a (req, res) handler.
 */
export async function fixtureServer(routes) {
  const server = createServer((req, res) => {
    const route = routes[req.url];
    if (!route) {
      res.writeHead(404, { "content-type": "text/html" }).end("<title>Not found</title>");
      return;
    }
    if (typeof route === "function") return route(req, res);
    res.writeHead(route.status ?? 200, { "content-type": "text/html; charset=utf-8", ...(route.headers ?? {}) }).end(route.body ?? "");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    url: (p) => base + p,
    close: () => new Promise((r) => server.close(r)),
  };
}

export const longText = (n) => "Substantive sentence about the topic under review. ".repeat(Math.ceil(n / 50)).slice(0, n);
