/**
 * research-scope-mcp — command-line argument parsing (kept free of side
 * effects so it can be tested without starting a server).
 */

import { version } from "./version.js";

export const USAGE = `research-scope-mcp ${version} — MCP server for research-to-report workflows

Usage:
  research-scope-mcp                       run over stdio (default; for Claude Desktop, Claude Code, Cursor)
  research-scope-mcp --http [options]      run over Streamable HTTP at /mcp

HTTP options:
  --port <n>     port to listen on (default: $PORT or 3001)
  --host <addr>  interface to bind (default: $HOST or 127.0.0.1; use 0.0.0.0 in containers)

Other:
  -h, --help     show this help
  -v, --version  print the version

Environment:
  RESEARCH_SCOPE_DATA_DIR  where report shells are saved (default: ./data)
`;

export interface CliOptions {
  mode: "stdio" | "http" | "help" | "version";
  port: number;
  host: string;
}

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): CliOptions {
  const value = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    if (idx < 0) return undefined;
    const v = argv[idx + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${flag} needs a value`);
    return v;
  };
  if (argv.includes("-h") || argv.includes("--help")) return { mode: "help", port: 0, host: "" };
  if (argv.includes("-v") || argv.includes("--version")) return { mode: "version", port: 0, host: "" };

  const rawPort = value("--port") ?? env.PORT ?? "3001";
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Invalid port: ${rawPort}`);
  const host = value("--host") ?? env.HOST ?? "127.0.0.1";
  return { mode: argv.includes("--http") ? "http" : "stdio", port, host };
}
