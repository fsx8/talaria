/* One-off: Round-3 Stage 2 — mock-mode regression. The demo register must
 * carry every Stage-2 affordance honestly: keyboard map, saved searches,
 * .eml export + attachment download (fabricated bytes), per-account
 * visibility (rows actually leave the register), guardrail. Dev server on
 * :5174 (VITE_BACKEND=mock is the dev default). */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const BASE = process.env.MOCK_BASE ?? "http://localhost:5174";

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
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();

const result = { steps: {}, errors: [] };
process.on("uncaughtException", (err) => {
  result.steps.fatal = String(err).slice(0, 200);
  console.log(JSON.stringify(result, null, 1));
  process.exit(1);
});
page.on("pageerror", (err) => result.errors.push(String(err).slice(0, 140)));
page.on("console", (msg) => {
  if (msg.type() === "error") result.errors.push(`console: ${msg.text().slice(0, 110)}`);
});

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector("[role=option]", { timeout: 20_000 });
result.steps.mockRows = await page.$$eval("[role=option]", (els) => els.length);
result.steps.demoLabel = await page.isVisible("text=Demo data");

/* keyboard */
await page.keyboard.press("j");
await page.waitForTimeout(700);
result.steps.kb_selected = await page.$eval('[role=option][aria-selected="true"]', (el) => el.textContent?.trim().slice(0, 40)).catch(() => null);
await page.keyboard.press("Escape");
await page.keyboard.press("?");
await page.waitForTimeout(400);
result.steps.shortcutsOverlay = await page.isVisible("text=Keyboard map");
await page.keyboard.press("Escape");

/* saved search */
await page.fill("#talaria-search", "Rechnung");
await page.waitForTimeout(800);
await page.click('summary[aria-label="Keep this search"]');
// The details' @toggle handler resets the draft name and focuses the
// input — wait for that focus so the fill below can't be wiped by the
// handler landing late (slow CI runners lost this race).
await page.waitForFunction(
  () => document.activeElement?.matches('input[aria-label="Name for the saved search"]'),
  { timeout: 10_000 },
);
await page.fill('input[aria-label="Name for the saved search"]', "Demo Rechnungen");
await page.click('button:has-text("Keep"):visible');
let savedShown = true;
try {
  await page.waitForSelector('button:has-text("Demo Rechnungen")', { timeout: 15_000 });
} catch {
  savedShown = false;
  // Diagnose: what does the page think happened?
  result.steps.savedDebug = {
    toasts: await page.$$eval(".toast", (els) => els.map((e) => e.textContent?.trim().slice(0, 80))),
    asideText: await page.$eval("aside", (el) => el.textContent?.replace(/\s+/g, " ").slice(0, 300)).catch(() => null),
    popoverOpen: await page.$eval('details:has(summary[aria-label="Keep this search"])', (el) => el.open).catch(() => null),
    nameValue: await page.$eval('input[aria-label="Name for the saved search"]', (el) => el.value).catch(() => null),
    stored: await page.evaluate(() => localStorage.getItem("talaria.searches")),
  };
}
result.steps.savedListed = savedShown;
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector("[role=option]", { timeout: 20_000 });
await page.waitForSelector('button:has-text("Demo Rechnungen")', { timeout: 15_000 });
result.steps.savedPersisted = await page.isVisible('button:has-text("Demo Rechnungen")');
await page.click('button:has-text("Demo Rechnungen")', { button: "right" });
await page.waitForSelector('button:has-text("Demo Rechnungen")', { state: "detached", timeout: 15_000 });
result.steps.savedRemoved = true;
await page.fill("#talaria-search", "");
await page.waitForTimeout(600);

/* keyboard-only removal (reviewer regression: the ✕ used to be a hover-only
 * span with no tab stop): create a second search, focus the row, Tab to the
 * ✕ (revealed on focus), Enter removes. */
await page.fill("#talaria-search", "Logo");
await page.waitForTimeout(800);
await page.click('summary[aria-label="Keep this search"]');
await page.waitForFunction(
  () => document.activeElement?.matches('input[aria-label="Name for the saved search"]'),
  { timeout: 10_000 },
);
await page.fill('input[aria-label="Name for the saved search"]', "Tastatur Entfernen");
await page.click('button:has-text("Keep"):visible');
await page.waitForSelector('button:has-text("Tastatur Entfernen")', { timeout: 15_000 });
const kbRow = page.locator("aside div.group\\/entry", { hasText: "Tastatur Entfernen" });
await kbRow.locator("button").first().focus();
await page.keyboard.press("Tab");
result.steps.kbRemoveFocused = await page.evaluate(() => {
  const el = document.activeElement;
  if (!el || el.getAttribute("aria-label") !== "Remove saved search") return { isRemove: false };
  const r = el.getBoundingClientRect();
  return { isRemove: true, revealed: r.width > 0 && r.height > 0 && getComputedStyle(el).opacity !== "0" };
});
await page.keyboard.press("Enter");
await kbRow.waitFor({ state: "detached", timeout: 8_000 });
result.steps.kbRemoveWorks = (await page.locator("aside div.group\\/entry", { hasText: "Tastatur Entfernen" }).count()) === 0;
// reset the rail
const kbEntries = await page.locator("aside div.group\\/entry button[aria-label='Remove saved search']").count();
for (let i = 0; i < kbEntries; i++) {
  await page.locator("aside div.group\\/entry button[aria-label='Remove saved search']").first().click();
  await page.waitForTimeout(300);
}
await page.fill("#talaria-search", "");
await page.waitForTimeout(600);

/* export .eml (mock raw source). Row 1 may be a draft entry — clicking it
 * opens the composer, not the reader — so walk rows until a mail opens. */
const rows = await page.$$("[role=option]");
for (let i = 0; i < Math.min(rows.length, 6); i++) {
  const label = ((await rows[i].textContent()) ?? "").trim();
  if (label.startsWith("To: ")) continue; // draft row
  await rows[i].click();
  try {
    await page.waitForSelector('article.record-sheet button[aria-label="Export as .eml"]', { timeout: 5_000 });
    break;
  } catch { /* next row */ }
}
const dl = page.waitForEvent("download", { timeout: 20_000 });
await page.click('button[aria-label="Export as .eml"]');
const eml = await dl;
const emlPath = join("/tmp/opencode", `mock-${eml.suggestedFilename().replace(/[^\w.-]/g, "_")}`);
await eml.saveAs(emlPath);
const emlText = readFileSync(emlPath).toString("utf-8");
result.steps.mockEml = {
  filename: eml.suggestedFilename(),
  bytes: emlText.length,
  hasHeaders: /^Message-ID:/m.test(emlText) && /Subject:/m.test(emlText),
};

/* attachment download (mock bytes) */
const attButton = 'article.record-sheet li button[aria-label^="Download"]';
const hasAtt = (await page.$$eval(attButton, (els) => els.length)) > 0;
if (!hasAtt) {
  // open further rows until one carries attachments (skip draft rows —
  // they open the composer; Escape closes it if one slipped through)
  const candidates = await page.$$("[role=option]");
  for (let i = 1; i < Math.min(candidates.length, 9); i++) {
    const label = ((await candidates[i].textContent()) ?? "").trim();
    if (label.startsWith("To: ")) continue;
    await candidates[i].click({ timeout: 5_000 }).catch(() => page.keyboard.press("Escape"));
    await page.waitForTimeout(600);
    if ((await page.$$eval(attButton, (els) => els.length)) > 0) break;
  }
}
result.steps.mockAttListed = await page.$$eval("article.record-sheet ul li", (els) => els.length);
const dl2 = page.waitForEvent("download", { timeout: 20_000 });
await page.click(attButton);
const att = await dl2;
const attPath = join("/tmp/opencode", `mock-${att.suggestedFilename().replace(/[^\w.-]/g, "_")}`);
await att.saveAs(attPath);
const attBytes = readFileSync(attPath);
result.steps.mockAtt = { filename: att.suggestedFilename(), bytes: attBytes.length, positive: attBytes.length > 0 };

/* per-account visibility: hide the second account, rows must leave */
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector("[role=option]", { timeout: 20_000 });
await page.waitForTimeout(800);
const rowsBefore = await page.evaluate(() => document.querySelectorAll("[role=option]").length);
await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(900);
const labels = await page.$$eval('.card:has(h3:text("Accounts")) label span.font-medium', (els) => els.map((e) => e.textContent?.trim()));
result.steps.mockAccounts = labels;
// uncheck the FIRST account (uncheck = hide) — it owns most register rows
await page.$$eval('.card:has(h3:text("Accounts")) label input', (els) => els[0]?.click());
await page.waitForTimeout(900);
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector("[role=option]", { timeout: 20_000 });
await page.waitForTimeout(900);
const rowsAfter = await page.evaluate(() => document.querySelectorAll("[role=option]").length);
result.steps.mockVisibility = { firstLabel: labels[0], rowsBefore, rowsAfter, rowsLeft: rowsAfter < rowsBefore };
result.steps.mockRailLacks = await page.evaluate((label) => {
  const rail = document.querySelector("aside");
  return !Array.from(rail.querySelectorAll("button span")).some((s) => s.textContent?.trim() === label);
}, labels[0] ?? "");
// guardrail: hiding the remaining two down to zero must refuse the last one
await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(900);
await page.$$eval('.card:has(h3:text("Accounts")) label input', (els) => els[2]?.click()); // hide 3rd (legal: 1 left)
await page.waitForTimeout(400);
await page.$$eval('.card:has(h3:text("Accounts")) label input', (els) => els[0]?.click()); // try to hide the last → refused
await page.waitForTimeout(400);
const stillChecked = await page.$$eval('.card:has(h3:text("Accounts")) label input:checked', (els) => els.length);
result.steps.mockGuardrail = { stillVisible: stillChecked, refused: stillChecked >= 1 };
// restore: unhide everything
const totalInputs = await page.$$eval('.card:has(h3:text("Accounts")) label input', (els) => els.length);
for (let i = 0; i < totalInputs; i++) {
  await page.$$eval('.card:has(h3:text("Accounts")) label input', (els, idx) => {
    const el = els[idx];
    if (el && !el.checked) el.click();
  }, i);
  await page.waitForTimeout(150);
}
result.steps.restored = await page.$$eval('.card:has(h3:text("Accounts")) label input:checked', (els) => els.length);

console.log(JSON.stringify(result, null, 1));
await browser.close();
