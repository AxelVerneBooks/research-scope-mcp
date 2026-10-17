import puppeteer from "/tmp/cut3-tools/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = process.argv[2] ?? "/tmp/cut3-headless/frames";
const ROOT = dirname(fileURLToPath(import.meta.url)) + "/..";
const URL_ = "http://127.0.0.1:8899/marketing/demo-60s/demo-setup-vertical.html?headless=1";
const INTERVAL_MS = 200;
const TOTAL_MS = 34000;
const FRAMES = TOTAL_MS / INTERVAL_MS;
const W = 1080, H = 1920;

if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
  args: ["--no-first-run", "--disable-gpu", "--hide-scrollbars"],
});
const page = await browser.newPage();
await page.goto(URL_, { waitUntil: "networkidle0" });

console.error("capturing…");
for (let i = 0; i < FRAMES; i++) {
  const t0 = Date.now();
  await page.screenshot({ path: `${OUT}/f${String(i + 1).padStart(4, "0")}.png` });
  const spent = Date.now() - t0;
  if (spent < INTERVAL_MS) await sleep(INTERVAL_MS - spent);
  if (i % 25 === 0) console.error(`frame ${i + 1}/${FRAMES}`);
}
await browser.close();
console.error(`done: ${FRAMES} frames → ${OUT}`);

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
