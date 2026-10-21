#!/usr/bin/env node
/**
 * research-scope-mcp — CLI entry point
 *
 * Research-to-report workflow: plan sources with kill criteria, fetch-and-score
 * them, assemble a citation-registry report shell, then verify every claim has a
 * scored source.
 *
 * Transports:
 *   - stdio (default):  `research-scope-mcp`
 *   - Streamable HTTP:  `research-scope-mcp --http --port 3001 [--host 127.0.0.1]`
 *     No auth layer: it binds to loopback by default; put it behind an
 *     authenticating proxy before exposing it.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { parseArgs, USAGE, type CliOptions } from "./cli.js";
import { buildServer, createState, runHttp } from "./server.js";
import { version } from "./version.js";

async function main(): Promise<void> {
  let opts: CliOptions;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`${(err as Error).message}\n\n${USAGE}`);
    process.exit(2);
  }

  if (opts.mode === "help") {
    process.stdout.write(USAGE);
    return;
  }
  if (opts.mode === "version") {
    process.stdout.write(`${version}\n`);
    return;
  }

  const state = createState();
  if (opts.mode === "http") {
    const httpServer = await runHttp({ port: opts.port, host: opts.host, state });
    const shutdown = () => {
      httpServer.close(() => process.exit(0));
      httpServer.closeAllConnections();
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    return;
  }

  // stdio keeps one long-lived server; the process lives until the client closes the pipe.
  await buildServer(state).connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error("research-scope-mcp failed to start:", err);
  process.exit(1);
});
