/**
 * Shared helper for the examples: launch research-scope-mcp over stdio exactly
 * the way Claude Desktop, Claude Code and Cursor do (spawn a child process,
 * speak JSON-RPC on stdin/stdout), using the official MCP TypeScript client.
 *
 * Server command:
 *   - default:          node dist/index.js        (this checkout; run `npm run build` first)
 *   - RSM_USE_NPX=1:    npx -y research-scope-mcp (the published npm package — same
 *                                                  command the client configs use)
 *
 * Every run gets a fresh temp data dir (RESEARCH_SCOPE_DATA_DIR), so the repo's
 * own data/ is never touched and runs don't see each other's reports.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function serverCommand() {
  return process.env.RSM_USE_NPX === "1"
    ? { command: "npx", args: ["-y", "research-scope-mcp"] }
    : { command: process.execPath, args: [path.join(ROOT, "dist", "index.js")] };
}

/** Connect a client to a freshly spawned server. Returns { client, dataDir, close }. */
export async function connect(clientName) {
  const dataDir = await mkdtemp(path.join(tmpdir(), "rsm-example-"));
  const { command, args } = serverCommand();
  const transport = new StdioClientTransport({
    command,
    args,
    // pass the parent env through (PATH, proxy settings) plus the isolated data dir
    env: { ...process.env, RESEARCH_SCOPE_DATA_DIR: dataDir },
    stderr: "inherit",
  });
  const client = new Client({ name: clientName, version: "1.0.0" });
  await client.connect(transport);
  const info = client.getServerVersion();
  console.log(`$ ${path.basename(command)} ${args.map((a) => path.relative(ROOT, a) || a).join(" ")}`);
  console.log(`connected: ${info.name} ${info.version} (stdio)`);
  return {
    client,
    dataDir,
    close: async () => {
      await client.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

/** Call a tool and return { isError, text, json } — json is null when the text isn't JSON. */
export async function call(client, name, args) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // build_report and error results are plain text
  }
  return { isError: res.isError === true, text, json };
}

export function step(title) {
  console.log(`\n=== ${title} ===`);
}

export function show(value) {
  console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

/** One line per score: "71/100 (B) url  [flags]" */
export function scoreLine(s) {
  return `${String(s.score).padStart(3)}/100 (${s.grade})  ${s.url}  [${s.flags.length ? s.flags.join(", ") : "no flags"}]`;
}
