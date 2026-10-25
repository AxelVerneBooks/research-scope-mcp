#!/usr/bin/env node
/**
 * Example 1 — verify the install, the way a client does on startup.
 *
 * What Claude Desktop / Claude Code / Cursor do when they load the server:
 *   initialize → tools/list → (you ask for something) → tools/call
 *
 * Then the same smoke test clients/llms-install.md recommends: call
 * plan_research with scope "verify install" and expect primarySourceTargets,
 * corroboratingTargets and killCriteria back. No network needed.
 *
 * Agent prompt equivalent (paste into any client once the server is configured):
 *   "Call plan_research with scope 'verify install' and show me the kill criteria."
 *
 * Run:  node examples/01-verify-install.mjs
 *       RSM_USE_NPX=1 node examples/01-verify-install.mjs   # test the published npm package
 */

import { connect, call, step, show } from "./_client.mjs";

const { client, close } = await connect("example-01-verify-install");
try {
  step("tools/list — what the client shows in its tool picker");
  const { tools } = await client.listTools();
  for (const t of tools) {
    const params = Object.entries(t.inputSchema.properties ?? {})
      .map(([k]) => (t.inputSchema.required?.includes(k) ? k : `${k}?`))
      .join(", ");
    console.log(`- ${t.name}(${params}) — ${t.title}`);
  }

  step("server instructions — sent to the model at initialize");
  show(client.getInstructions());

  step('tools/call plan_research { scope: "verify install" }');
  const plan = await call(client, "plan_research", { scope: "verify install" });
  if (plan.isError || !plan.json) throw new Error(`plan_research failed: ${plan.text}`);
  show(plan.json);

  const ok = ["primarySourceTargets", "corroboratingTargets", "killCriteria"].every((k) => Array.isArray(plan.json[k]) && plan.json[k].length > 0);
  step("result");
  console.log(ok ? `OK — ${tools.length} tools exposed, plan_research returned a complete plan` : "FAILED — plan is missing fields");
  if (!ok) process.exitCode = 1;
} finally {
  await close();
}
