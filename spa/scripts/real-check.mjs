/* One-off: real-mode check — production SPA against the live sidecar. */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cacheRoot = join(process.env.HOME ?? "/root", ".cache", "ms-playwright");
  for (const entry of readdirSync(cacheRoot)) {
    if (!entry.startsWith("chromium-")) continue;
    for (const arch of ["chrome-linux64", "chrome-linux", "chrome-linux-arm64"]) {
      try {
        readdirSync(join(cacheRoot, entry, arch));
        return join(cacheRoot, entry, arch, "chrome");
      } catch { /* next */ }
    }
  }
  throw new Error("no chrome");
}

const browser = await chromium.launch({ executablePath: findChrome(), args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const BASE = process.env.TALARIA_BASE ?? "http://thunderbird:8942";
const result = { url: BASE, accountsSeen: [], rowsRendered: false, folioUnread: null, errors: [] };
page.on("pageerror", (err) => result.errors.push(String(err).slice(0, 120)));

await page.goto(BASE, { waitUntil: "domcontentloaded" });

// Real accounts render in the rail (first identity name or email).
try {
  await page.waitForFunction(
    () => document.querySelectorAll("aside button").length >= 3,
    { timeout: 20_000 },
  );
  result.accountsSeen = await page.$$eval("aside button span.truncate", (els) =>
    els.map((e) => e.textContent?.trim()).filter(Boolean).slice(0, 8),
  );
} catch (err) {
  result.errors.push("sidebar wait failed: " + String(err).slice(0, 80));
}

// Real message rows arrive (search across ~10k headers can take a while).
try {
  await page.waitForFunction(
    () => document.querySelectorAll("[role=option]").length > 0,
    { timeout: 40_000 },
  );
  result.rowsRendered = true;
  result.rowCount = await page.$$eval("[role=option]", (els) => els.length);
} catch (err) {
  result.errors.push("rows wait failed: " + String(err).slice(0, 80));
}

// The live folio shows the real unread tally (1305 as of deploy).
try {
  const folio = await page.waitForFunction(
    () => {
      const el = document.querySelector("header span.tabular");
      return el && Number(el.textContent?.replace(/\D/g, "")) > 0 ? el.textContent : null;
    },
    { timeout: 15_000 },
  );
  result.folioUnread = await folio.evaluate((el) => el.textContent);
} catch {
  result.folioUnread = null;
}

await page.screenshot({ path: "../docs/local/screenshots/real-desktop.png" });
console.log(JSON.stringify(result, null, 1));
await browser.close();
