/**
 * Optional live-network smoke test (not part of `npm test`):
 *   npm run test:live
 * Fetches a real, stable primary-host page to catch regressions in real-world
 * HTML handling that fixtures can miss.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createState } from "../dist/server.js";
import { connectInMemory, json } from "./helpers/client.mjs";

const URL = process.env.RESEARCH_SCOPE_LIVE_URL ?? "https://www.nhtsa.gov/";

test("live fetch_and_score against a real primary-host page", { skip: !process.env.RESEARCH_SCOPE_LIVE && "set RESEARCH_SCOPE_LIVE=1" }, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "rsmcp-live-"));
  const conn = await connectInMemory(createState({ dataDir }));
  try {
    const s = json(await conn.client.callTool({ name: "fetch_and_score", arguments: { source_url: URL } }));
    assert.ok(s.score > 0, JSON.stringify(s));
    assert.equal(s.breakdown.length, 5);
  } finally {
    await conn.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
