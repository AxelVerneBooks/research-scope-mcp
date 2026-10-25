#!/usr/bin/env node
/**
 * Run every example in order and write each one's real stdout/stderr to
 * examples/output/<name>.txt, with a short header recording when and how it
 * was captured. Nothing in output/ is hand-edited: re-run this to refresh it.
 *
 * Usage:  npm run examples          (builds first)
 *         node examples/run-all.mjs [--only 03]
 */

import { spawnSync } from "node:child_process";
import { readdirSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./_client.mjs";

const DIR = path.join(ROOT, "examples");
const OUT = path.join(DIR, "output");
mkdirSync(OUT, { recursive: true });

const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;
const version = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version;

const scripts = readdirSync(DIR)
  .filter((f) => /^\d\d-.*\.mjs$/.test(f))
  .filter((f) => !only || f.startsWith(only))
  .sort();

let failed = 0;
for (const file of scripts) {
  const name = file.replace(/\.mjs$/, "");
  process.stderr.write(`running ${file} ... `);
  const res = spawnSync(process.execPath, [path.join(DIR, file)], {
    cwd: ROOT,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
    encoding: "utf8",
    timeout: 180_000,
  });
  const header = [
    `# examples/${file} — captured ${new Date().toISOString()}`,
    `# node ${process.version}, research-scope-mcp ${version} (this checkout), exit code ${res.status}`,
    `# real output, unedited; regenerate with: node examples/run-all.mjs --only ${name.slice(0, 2)}`,
    "",
  ].join("\n");
  writeFileSync(path.join(OUT, `${name}.txt`), header + res.stdout + (res.stderr ? `\n[stderr]\n${res.stderr}` : ""), "utf8");
  process.stderr.write(res.status === 0 ? "ok\n" : `exit ${res.status}\n`);
  if (res.status !== 0) failed++;
}
process.exitCode = failed ? 1 : 0;
