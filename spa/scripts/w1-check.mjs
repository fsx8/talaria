/* One-off: Round-3 W1 organize check — production SPA against the live
 * sidecar. Exercises mark-as-read-on-open, the reader Move picker, the row
 * quick-actions and the Settings Actions section; restores the test
 * message's state at the end. */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const BASE = process.env.TALARIA_BASE ?? "http://thunderbird:8942";
const SHOTS = "../docs/local/screenshots/round3";

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cacheRoot = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(process.env.HOME ?? "/root", ".cache", "ms-playwright");
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

const result = { steps: {}, folioUnread: { start: null, end: null }, errors: [] };
page.on("pageerror", (err) => result.errors.push(String(err).slice(0, 120)));
page.on("console", (msg) => {
  if (msg.type() === "error") result.errors.push(`console: ${msg.text().slice(0, 100)}`);
});

async function api(name, args) {
  const res = await page.request.post(`${BASE}/api/tools/call`, { data: { name, arguments: args } });
  const payload = await res.json();
  if (!payload.ok) throw new Error(`${name}: ${payload.error}`);
  return payload.data;
}

/* Discover the round-trip test folder at runtime — real account URIs never
 * live in a published harness. Falls back to creating the folder under the
 * first account's root (the same shape the Move picker creates). */
async function discoverTestFolder() {
  const folders = await api("listFolders", {});
  const existing = folders.find((f) => f.name === "Talaria-Test");
  if (existing) return existing.path;
  const anchor = folders.find((f) => f.depth === 0);
  if (!anchor) throw new Error("no depth-0 folder to anchor Talaria-Test under");
  const rootPath = anchor.path.slice(0, anchor.path.lastIndexOf("/"));
  const created = await api("createFolder", { parentFolderPath: rootPath, name: "Talaria-Test" });
  return typeof created.path === "string" ? created.path : `${rootPath}/Talaria-Test`;
}
const TEST_PATH = await discoverTestFolder();
result.steps.testFolder = "discovered";

const folioText = () =>
  page.$eval("header span.tabular", (el) => el.textContent?.trim()).catch(() => null);
const rowHasDot = () =>
  page.$eval("[role=option]", (el) => el.querySelector(".unread-dot") !== null).catch(() => null);

async function shot(name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
  result.steps[name] = "captured";
}

/** Open the reader's Move picker (scoped to the sheet, not the theme menu). */
async function openPicker() {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.click("article details.dropdown summary");
    try {
      await page.waitForSelector("article .dropdown-content:visible", { timeout: 2000 });
      return true;
    } catch { /* re-click */ }
  }
  return false;
}

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector("[role=option]", { timeout: 40_000 });
result.folioUnread.start = await folioText();

// Isolate the labeled round-trip test mail in the register.
await page.fill("#talaria-search", "Talaria round-3 W1 check");
await page.waitForFunction(() => document.querySelectorAll("[role=option]").length > 0, { timeout: 20_000 });
await page.waitForTimeout(1200); // let the virtualizer settle before hitting the row

result.steps.unreadBefore = await rowHasDot();
await shot("w1-mark-as-read-before");

// Hover quick-actions (flag + read toggles, overlay, confirmation-free).
await page.hover("[role=option]");
await page.waitForTimeout(400);
await shot("w1-row-hover-actions");

// Open the record → mark-read-on-open after ~0.9 s. The test subject has
// two identical copies (IMAP copy+expunge ghosts); one of them carries a
// stale message key the add-on can't open — try rows until the sheet opens.
// Locators (nth) re-resolve on every attempt — the virtualizer recycles
// DOM nodes, stale ElementHandles detach mid-click (learned the hard way).
async function openSheet() {
  const count = await page.$$eval("[role=option]", (els) => els.length);
  for (let i = 0; i < Math.min(count, 3); i++) {
    await page.locator("[role=option]").nth(i).click().catch(() => {});
    try {
      await page.waitForSelector("article.record-sheet", { timeout: 20_000 });
      return i;
    } catch { /* next row */ }
    const err = await page.isVisible("article, section >> text=Message not found");
    if (err) await page.keyboard.press("Escape").catch(() => {});
  }
  return -1;
}
result.steps.sheetOpenedForRow = await openSheet();
if (result.steps.sheetOpenedForRow < 0) throw new Error("no row opened the record sheet");
await page.waitForTimeout(2500);
result.steps.unreadAfterOpen = await rowHasDot();
result.steps.toolbarVisible = await page.isVisible('article button[title="Mark unread"], article button[title="Mark read"]');
await shot("w1-mark-as-read-reader");

// Move picker: refetch-on-open lists the fresh folder tree.
result.steps.pickerVisible = await openPicker();
await shot("w1-move-picker");

// File the entry: the picker disables the entry's current folder, so if a
// previous run left the test mail in Talaria-Test, the round-trip move
// goes back to INBOX instead (same proof, opposite direction).
const currentPath = await page
  .$eval('article .dropdown-content button[disabled][data-folder-path]', (el) => el.getAttribute("data-folder-path"))
  .catch(() => null);
const movingBack = currentPath === TEST_PATH;
const targetPath = movingBack ? TEST_PATH.replace(/\/Talaria-Test$/, "/INBOX") : TEST_PATH;
result.steps.movingBackToInbox = movingBack;
result.steps.rowsBeforeMove = await page.$$eval("[role=option]", els => els.length);
await page.click(`[data-folder-path="${targetPath}"]`);
await page.waitForTimeout(1500);
result.steps.toastAfterMove = await page
  .$eval(".toast", (el) => el.textContent?.trim().slice(0, 80))
  .catch(() => null);
// The IMAP move carries copy+expunge semantics — the test mail exists in two
// identical copies, so the assertion is "one row left the register".
const rowsAfterMove = await page.$$eval("[role=option]", els => els.length);
result.steps.rowLeftRegister = rowsAfterMove === result.steps.rowsBeforeMove - 1;
await shot("w1-moved-toast");

// NOTE: the reverse move is exercised naturally on alternating runs (see
// movingBackToInbox above); clicking through IMAP's copy+expunge ghosts
// races the settle, so no extra reverse step is scripted here.

// Restore the unread state via the ROW quick-action (no reader open): if
// the row shows "Mark unread" the copy is read → toggle it back; if it
// shows "Mark read" the copy is already unread → nothing to restore.
await page.waitForSelector("[role=option]", { timeout: 45_000 });
await page.waitForTimeout(1000);
await page.hover("[role=option]");
await page.waitForTimeout(300);
const toggleTitle = await page
  .$eval('[role=option] button[title^="Mark"]', (el) => el.getAttribute("title"))
  .catch(() => null);
if (toggleTitle === "Mark unread") {
  await page.click('[role=option] button[title="Mark unread"]');
  await page.waitForTimeout(1500);
}
result.steps.rowToggleWas = toggleTitle;
result.steps.unreadRestored = await rowHasDot();

// Settings: the Actions section + the show/hide switch round-trip.
await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
result.steps.settingsActionsVisible = await page.isVisible("text=Mark as read on open");
await shot("w1-settings-actions");

await page.click('label:has-text("Show move & organize controls") input');
await page.waitForTimeout(600);
result.steps.chipAfterHide = await page
  .$eval("header .badge", (el) => el.textContent?.trim())
  .catch(() => null);
await shot("w1-settings-actions-hidden");

// Persistence across reload, then switch back on.
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
result.steps.showActionsPersistedOff = await page.$eval(
  'label:has-text("Show move & organize controls") input',
  (el) => el.checked,
);
await page.click('label:has-text("Show move & organize controls") input');
await page.waitForTimeout(400);

result.folioUnread.end = await folioText();
console.log(JSON.stringify(result, null, 1));
await browser.close();
