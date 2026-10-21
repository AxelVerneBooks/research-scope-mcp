import { test } from "node:test";
import assert from "node:assert/strict";

import { parseArgs, USAGE } from "../dist/cli.js";

test("defaults to stdio on loopback port 3001", () => {
  assert.deepEqual(parseArgs([], {}), { mode: "stdio", port: 3001, host: "127.0.0.1" });
});

test("--http with --port and --host", () => {
  assert.deepEqual(parseArgs(["--http", "--port", "8080", "--host", "0.0.0.0"], {}), { mode: "http", port: 8080, host: "0.0.0.0" });
});

test("PORT and HOST environment variables are used when flags are absent", () => {
  assert.deepEqual(parseArgs(["--http"], { PORT: "4000", HOST: "::" }), { mode: "http", port: 4000, host: "::" });
});

test("flags win over environment variables", () => {
  assert.equal(parseArgs(["--http", "--port", "5000"], { PORT: "4000" }).port, 5000);
});

test("invalid ports and missing values are rejected", () => {
  assert.throws(() => parseArgs(["--http", "--port", "abc"], {}), /Invalid port: abc/);
  assert.throws(() => parseArgs(["--http", "--port", "70000"], {}), /Invalid port/);
  assert.throws(() => parseArgs(["--http", "--port"], {}), /--port needs a value/);
  assert.throws(() => parseArgs(["--port", "--http"], {}), /--port needs a value/);
});

test("--help and --version", () => {
  assert.equal(parseArgs(["--help"], {}).mode, "help");
  assert.equal(parseArgs(["-h"], {}).mode, "help");
  assert.equal(parseArgs(["--version"], {}).mode, "version");
  assert.equal(parseArgs(["-v"], {}).mode, "version");
  assert.match(USAGE, /--http/);
  assert.match(USAGE, /RESEARCH_SCOPE_DATA_DIR/);
});
