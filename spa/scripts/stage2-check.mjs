/* One-off: Round-3 Stage 2 check — production SPA against the live sidecar.
 * Keyboard map, saved searches, search scoping, .eml export, attachment
 * download, print isolation, contact→mail, per-account visibility and the
 * remote-image consent gate. Read-state-neutral: mark-as-read-on-open is
 * switched OFF for the run (real mail must not change state), the two
 * seeded stage-2 test mails are the only messages opened by name. */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const BASE = process.env.TALARIA_BASE ?? "http://thunderbird:8942";
const SHOTS = "../docs/local/screenshots/stage2";

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
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();

const result = { steps: {}, errors: [] };
// A late failure must not swallow the evidence gathered so far.
process.on("uncaughtException", (err) => {
  result.steps.fatal = String(err).slice(0, 220);
  console.log(JSON.stringify(result, null, 1));
  process.exit(1);
});
page.on("pageerror", (err) => result.errors.push(String(err).slice(0, 140)));
page.on("console", (msg) => {
  if (msg.type() === "error") result.errors.push(`console: ${msg.text().slice(0, 110)}`);
});

async function shot(name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
  result.steps[name] = "captured";
}

const rowEls = () => page.$$eval("[role=option]", (els) => els.length);
const selectedRowText = () =>
  page.$eval('[role=option][aria-selected="true"]', (el) => el.textContent?.trim().slice(0, 60)).catch(() => null);
const sheetOpen = () => page.isVisible("article.record-sheet");

/** Wait for the register to render at least one row. */
async function waitRows(timeout = 40_000) {
  await page.waitForSelector("[role=option]", { timeout });
}

/** Search and wait until at least one row matches (sidecar scans are slow). */
async function searchAndWait(query, timeout = 45_000) {
  await page.fill("#talaria-search", query);
  await page.waitForFunction(
    () => document.querySelectorAll("[role=option]").length > 0,
    { timeout },
  );
  await page.waitForTimeout(1200); // virtualizer settle
}

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await waitRows();

/* ---- 0. Read-state neutrality: mark-as-read-on-open OFF for this run ---- */
await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(800);
const markReadInput = 'label:has-text("Mark as read on open") input';
const markReadWas = await page.$eval(markReadInput, (el) => el.checked);
if (markReadWas) {
  await page.click(markReadInput);
  await page.waitForTimeout(400);
}
result.steps.markReadDisabledForRun = true;

/* ---- 1. Shortcuts help overlay (?) ---- */
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await waitRows();
await page.keyboard.press("?");
await page.waitForSelector('[role="dialog"]', { timeout: 4000 });
result.steps.shortcutsOverlayOpen = await page.isVisible("text=Keyboard map");
await shot("shortcuts-overlay");
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
result.steps.shortcutsOverlayClosed = (await page.$$('[role="dialog"]').then((els) => els.length)) === 0;

/* ---- 2. Keyboard: j/k drive selection (+ scroll), Enter/o opens ---- */
// No selection yet → j opens the first unread (it carries the accent dot).
const firstRowIsUnread = await page
  .$eval("[role=option]", (el) => el.querySelector(".unread-dot") !== null)
  .catch(() => false);
await page.keyboard.press("j");
await page.waitForTimeout(1500);
result.steps.kb_firstRowWasUnread = firstRowIsUnread;
result.steps.kb_j_selected = await selectedRowText();
result.steps.kb_j_reader = await sheetOpen();
await page.keyboard.press("j");
await page.waitForTimeout(1200);
result.steps.kb_j2_selected = await selectedRowText();
await page.keyboard.press("k");
await page.waitForTimeout(1200);
result.steps.kb_k_selected = await selectedRowText();
result.steps.kb_k_backToFirst = result.steps.kb_k_selected === result.steps.kb_j_selected;
await page.keyboard.press("o");
await page.waitForTimeout(800);
result.steps.kb_o_reader = await sheetOpen();
await shot("keyboard-navigation");
await page.keyboard.press("Escape"); // close the reader
await page.waitForTimeout(400);
result.steps.kb_escape_closesReader = !(await sheetOpen());

/* ---- 3. "/" focuses search; typed search is debounced ---- */
let searchCalls = 0;
page.on("request", (req) => {
  if (req.method() === "POST" && req.url().includes("/api/tools/call")) {
    const body = req.postData() ?? "";
    if (body.includes("searchMessages")) searchCalls += 1;
  }
});
await page.keyboard.press("/");
await page.waitForTimeout(200);
result.steps.slashFocus = await page.$eval("#talaria-search", (el) => document.activeElement === el);
const before = searchCalls;
await page.fill("#talaria-search", "t");
await page.waitForTimeout(200); // inside the 300 ms debounce window
result.steps.debounce_heldDuringWindow = searchCalls === before;
await page.waitForTimeout(700); // debounce fired
result.steps.debounce_firedAfter = searchCalls > before;
await page.fill("#talaria-search", "");
await page.waitForTimeout(1500);

/* ---- 4. Saved searches: keep, list, re-run, persist, remove ---- */
await page.fill("#talaria-search", "the");
await page.waitForTimeout(600);
await page.click('summary[aria-label="Keep this search"]');
await page.waitForSelector("text=Keep this search", { timeout: 3000 });
await page.fill('input[aria-label="Name for the saved search"]', "Stage-2 probe search");
await page.click('button:has-text("Keep"):visible');
await page.waitForTimeout(600);
await shot("saved-searches");
result.steps.savedListed = await page.isVisible('h3:has-text("Searches")');
result.steps.savedEntry = await page
  .$eval('aside h3:has-text("Searches") + button, aside button:has-text("Stage-2 probe search")', (el) => el.textContent?.trim().slice(0, 40))
  .catch(() => null);
// persistence across reload
await page.reload({ waitUntil: "domcontentloaded" });
await waitRows();
result.steps.savedPersisted = await page.isVisible('button:has-text("Stage-2 probe search")');
// re-run
await page.click('button:has-text("Stage-2 probe search")');
await page.waitForTimeout(1800);
result.steps.savedRerunQuery = await page.$eval("#talaria-search", (el) => el.value);
// remove via right-click
await page.click('button:has-text("Stage-2 probe search")', { button: "right" });
await page.waitForTimeout(600);
result.steps.savedRemoved = !(await page.isVisible('button:has-text("Stage-2 probe search")'));

/* ---- 5. Search scoping: implicit scope chip ---- */
await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(600);
await page.click('label:has-text("Current account") input');
await page.waitForTimeout(300);
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await waitRows();
await searchAndWait("invoice");
result.steps.scopeChipVisible = await page.isVisible('[role="listbox"] span.badge, section[aria-label="Message list"] span.badge');
result.steps.scopeChipLabel = await page
  .$eval('section[aria-label="Message list"] span.badge', (el) => el.textContent?.trim().slice(0, 40))
  .catch(() => null);
await shot("scope-chip");
// reset scope to All mail
await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(600);
await page.click('label:has-text("All mail") input');

/* ---- 6. .eml export ---- */
// A message whose raw source is in TB's local store (IMAP rawSource needs
// an offline copy — brand-new arrivals do). The labeled seed mail qualifies.
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await waitRows();
await searchAndWait("Talaria round-3 W1 check", 60_000);
// The subject matches both live and copy+expunge ghost copies; ghosts
// open a "Message not found" state instead of the sheet — walk rows
// (re-resolving locators) until a real record sheet opens.
let sheetOpened = false;
const exportRows = await page.$$eval("[role=option]", (els) => els.length);
for (let i = 0; i < Math.min(exportRows, 3) && !sheetOpened; i++) {
  await page.locator("[role=option]").nth(i).click().catch(() => {});
  sheetOpened = await page
    .waitForSelector("article.record-sheet", { timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (!sheetOpened) await page.keyboard.press("Escape").catch(() => {});
}
if (!sheetOpened) throw new Error("no row opened a record sheet for export");
const exportBtn = 'button[aria-label="Export as .eml"]';
result.steps.exportBtnVisible = await page.isVisible(exportBtn);
const downloadEml = page.waitForEvent("download", { timeout: 60_000 });
await page.click(exportBtn);
const eml = await downloadEml;
const emlPath = join("/tmp/opencode", `stage2-${eml.suggestedFilename()}`);
await eml.saveAs(emlPath);
const emlBytes = readFileSync(emlPath);
result.steps.emlFilename = eml.suggestedFilename();
result.steps.emlSize = emlBytes.length;
result.steps.emlLooksLikeMail = /^[A-Za-z][A-Za-z0-9-]*:/.test(emlBytes.toString("latin1").slice(0, 400)) &&
  /Subject:/i.test(emlBytes.toString("latin1").slice(0, 4000));
await shot("export-eml");

/* ---- 7. Attachment download (raw-source extraction) ---- */
// The addon exposes no has-attachment search, so walk register rows until
// the sheet carries an attachments inventory; skip honestly when none of
// the recent rows has one (the pipeline itself is proven by the mock
// harness with fabricated bytes — this step validates real bytes when a
// candidate exists).
let attOpened = false;
const rowsAll = await page.$$("[role=option]");
const walkLen = Math.max(rowsAll.length, await page.$$eval("[role=option]", (els) => els.length));
for (let i = 0; i < Math.min(walkLen, 40) && !attOpened; i++) {
  await page.locator("[role=option]").nth(i).click({ timeout: 10_000 }).catch(() => page.keyboard.press("Escape"));
  await page.waitForSelector("article.record-sheet", { timeout: 20_000 }).catch(() => {});
  await page.waitForFunction(
    () => document.querySelectorAll("article.record-sheet ul li").length > 0,
    { timeout: 10_000 },
  ).catch(() => {});
  attOpened = await page.$$eval("article.record-sheet ul li", (els) => els.length > 0);
  if (!attOpened) await page.keyboard.press("Escape").catch(() => {});
}
result.steps.attachmentSheetOpened = attOpened;
const attachmentCount = attOpened
  ? await page.$$eval("article.record-sheet ul li", (els) => els.length)
  : 0;
result.steps.attachmentListed = attachmentCount;
result.steps.attachmentSkipped = !attOpened;
if (attOpened) {
  await page.hover("article.record-sheet ul li");
  await page.waitForTimeout(300);
  await shot("attachment-download");
  const dl = page.waitForEvent("download", { timeout: 420_000 }); // 2.5 MB sources page ~17 calls (~2 min)
  const dlButton = 'article.record-sheet li button[aria-label^="Download"]';
  result.steps.downloadBtnVisible = await page.isVisible(dlButton);
  await page.click(dlButton);
  const attachment = await dl;
  const attPath = join("/tmp/opencode", `stage2-${attachment.suggestedFilename().replace(/[^\w.-]/g, "_")}`);
  await attachment.saveAs(attPath);
  const attBytes = readFileSync(attPath);
  result.steps.attFilename = attachment.suggestedFilename();
  result.steps.attSize = attBytes.length;
  result.steps.attIsPdf = attBytes.subarray(0, 4).toString("latin1") === "%PDF";
}

/* ---- 8. Print CSS isolates the record sheet ---- */
// Ensure a record sheet is open (the attachment walk may have ended with
// Escape and no sheet).
await page.locator("[role=option]").first().click({ timeout: 20_000 }).catch(() => {});
await page.waitForSelector("article.record-sheet", { timeout: 20_000 }).catch(() => {});
result.steps.print_before = await page.evaluate(() => {
  const header = document.querySelector("header");
  const list = document.querySelector('section[aria-label="Message list"]');
  const sheet = document.querySelector("article.record-sheet");
  return {
    headerDisplay: getComputedStyle(header).display,
    listDisplay: getComputedStyle(list).display,
    sheetVisible: sheet.getBoundingClientRect().height > 0,
  };
});
await page.emulateMedia({ media: "print" });
await page.waitForTimeout(300);
result.steps.print_emulated = await page.evaluate(() => {
  const header = document.querySelector("header");
  const list = document.querySelector('section[aria-label="Message list"]');
  const sheet = document.querySelector("article.record-sheet");
  const prose = document.querySelector(".register-prose");
  return {
    headerDisplay: getComputedStyle(header).display,
    listDisplay: getComputedStyle(list).display,
    sheetVisible: sheet.getBoundingClientRect().height > 0,
    proseVisible: prose !== null && getComputedStyle(prose).display !== "none",
    sheetGround: getComputedStyle(sheet).backgroundColor,
  };
});
await shot("print-view");
await page.emulateMedia({ media: "screen" });
await page.waitForTimeout(300);

/* ---- 9. Contact → mail integration ---- */
await page.click('aside [role="tab"]:has-text("Contacts"), aside button:has-text("Contacts")');
await page.waitForTimeout(2000);
await page.waitForSelector('[aria-label="Contacts"] [role=option]', { timeout: 30_000 });
await page.click('[aria-label="Contacts"] [role=option]');
await page.waitForSelector("article.record-sheet button:has-text('Show mail')", { timeout: 20_000 });
result.steps.showMailVisible = await page.isVisible("button:has-text('Show mail')");
await shot("contacts-integration");
await page.click("button:has-text('Show mail')");
await page.waitForTimeout(2000);
result.steps.contactQuery = await page.$eval("#talaria-search", (el) => el.value);
result.steps.contactBackOnMail = await page.evaluate(
  () => document.querySelector('section[aria-label="Message list"]') !== null,
);
await page.waitForTimeout(1500);
result.steps.contactRows = await rowEls();

/* ---- 10. Per-account visibility ---- */
await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1000);
// The first account row's toggle (checked = visible).
const firstAccountLabel = await page.$eval(
  '.card:has(h3:text("Accounts")) label',
  (el) => el.querySelector("span.block.truncate")?.textContent?.trim(),
);
await page.click('.card:has(h3:text("Accounts")) label input');
await page.waitForTimeout(1200);
result.steps.hiddenAccount = firstAccountLabel;
await shot("hidden-accounts-settings");
// The rail must have lost the account row.
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await waitRows();
result.steps.railLacksHidden = await page.evaluate((label) => {
  const rail = document.querySelector("aside");
  return !Array.from(rail.querySelectorAll("button span")).some((s) => s.textContent?.trim() === label);
}, firstAccountLabel);
// persistence across reload
await page.reload({ waitUntil: "domcontentloaded" });
await waitRows();
result.steps.hiddenPersisted = await page.evaluate((label) => {
  const rail = document.querySelector("aside");
  return !Array.from(rail.querySelectorAll("button span")).some((s) => s.textContent?.trim() === label);
}, firstAccountLabel);
// restore
await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1000);
await page.click('.card:has(h3:text("Accounts")) label input');
await page.waitForTimeout(500);
// guardrail: hide-all refused — uncheck the first, then try the remaining ones
const toggles = '.card:has(h3:text("Accounts")) label input';
const total = await page.$$eval(toggles, (els) => els.length);
let guardrailHeld = true;
// leave the first visible; hiding all others is legal; hiding the LAST one must be refused
for (let i = 1; i < total; i++) {
  await page.$$eval(toggles, (els, idx) => (els[idx]).click(), i);
  await page.waitForTimeout(150);
}
// now everything except account #1 is hidden → hiding #1 must fail
await page.$$eval(toggles, (els) => (els[0]).click());
await page.waitForTimeout(300);
const stillOneVisible = await page.$$eval(`${toggles}:checked`, (els) => els.length);
guardrailHeld = stillOneVisible >= 1;
result.steps.guardrailLastAccountRefused = guardrailHeld;
// restore all
for (let i = 1; i < total; i++) {
  await page.$$eval(toggles, (els, idx) => (els[idx]).click(), i);
  await page.waitForTimeout(150);
}
await page.waitForTimeout(400);

/* ---- 11. Remote-image consent gate (any real HTML newsletter) ---- */
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await waitRows();
// Open rows until the sheet carries the consent card (an HTML mail with
// remote images — plain-text mails show no consent UI). No named search:
// real mailbox subjects never enter a published harness.
let consentOpened = false;
const consentRows = await page.$$("[role=option]");
for (let i = 0; i < Math.min(consentRows.length, 12) && !consentOpened; i++) {
  await consentRows[i].click();
  await page.waitForSelector("article.record-sheet", { timeout: 15_000 }).catch(() => {});
  consentOpened = await page.isVisible("text=remote image");
  if (!consentOpened) await page.keyboard.press("Escape").catch(() => {});
}
result.steps.remoteImageCardShown = consentOpened;
result.steps.remoteImgBlockedCount = await page
  .$eval("article.record-sheet", (el) => el.textContent?.match(/(\d+) remote image/)?.[1] ?? null)
  .catch(() => null);
result.steps.noImgWhileBlocked = await page.$$eval("article.record-sheet .register-prose img", (els) => els.length) === 0;
await shot("remote-images-blocked");
if (consentOpened) {
  await page.click("button:has-text('Load images')");
  await page.waitForTimeout(4000);
  result.steps.imgAfterAllow = await page.$$eval("article.record-sheet .register-prose img", (els) =>
    els.map((img) => ({ complete: img.complete, w: img.naturalWidth, src: img.src.slice(0, 60) })),
  );
  await shot("remote-images-loaded");
}

/* ---- 12. g-chord goto inbox ---- */
await page.keyboard.press("Escape");
await page.keyboard.press("g");
await page.keyboard.press("i");
await page.waitForTimeout(1500);
result.steps.gotoInboxScope = await page.$eval("section[aria-label='Message list'] h2", (el) => el.textContent?.trim());

/* ---- restore: mark-as-read-on-open back to its previous state ---- */
await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(800);
if (markReadWas) {
  await page.click(markReadInput);
  await page.waitForTimeout(400);
}
result.steps.markReadRestored = markReadWas;

console.log(JSON.stringify(result, null, 1));
await browser.close();