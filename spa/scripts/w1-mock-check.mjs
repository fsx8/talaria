/* One-off: mock-mode regression with the W1 write tier (in-memory demo). */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
function findChrome() {
  const cacheRoot = join(process.env.HOME ?? "/root", ".cache", "ms-playwright");
  for (const entry of readdirSync(cacheRoot)) {
    if (!entry.startsWith("chromium-")) continue;
    for (const arch of ["chrome-linux-arm64", "chrome-linux"]) {
      try { readdirSync(join(cacheRoot, entry, arch)); return join(cacheRoot, entry, arch, "chrome"); } catch {}
    }
  }
  throw new Error("no chrome");
}
const browser = await chromium.launch({ executablePath: findChrome(), args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", e => errors.push(String(e).slice(0, 120)));
await page.goto("http://localhost:5173", { waitUntil: "domcontentloaded" });
await page.waitForSelector("[role=option]", { timeout: 20_000 });
const rows = await page.$$eval("[role=option]", els => els.length);
const selectVisible = await page.isVisible('button:has-text("Select")');
// open a demo message and use the reader Move picker — NOT the seeded demo
// draft: since W2 (Stage 3) a drafts-folder row opens the composer, which
// would block the move-picker flow this check exercises.
await page.locator('[role=option]', { hasText: "Rechnung 24816" }).first().click();
await page.waitForSelector("article.record-sheet", { timeout: 10_000 });
await page.click("article details.dropdown summary");
await page.waitForSelector("article .dropdown-content:visible", { timeout: 3000 });
await page.click('article .dropdown-content button:has-text("Newsletter")');
await page.waitForTimeout(900);
const toast = await page.$eval(".toast", el => el.textContent?.trim().slice(0, 60)).catch(() => null);
// settings still work in mock
await page.goto("http://localhost:5173/settings", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(800);
const actionsCard = await page.isVisible("text=Mark as read on open");
const demoNote = await page.isVisible("text=Demo data");
await page.screenshot({ path: "../docs/screenshots/round3/w1-mock-demo.png" });
console.log(JSON.stringify({ rows, selectVisible, toast, actionsCard, demoNote, errors }));
await browser.close();
