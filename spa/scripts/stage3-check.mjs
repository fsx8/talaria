/* One-off: Round-3 Stage 3 (W2 drafts composer) — production SPA against the
 * live sidecar. UI flows assert on the composer's own honest signals (the
 * "Draft saved" indicator = the add-on accepted the save); server-side
 * storage was already proven at API level, and IMAP appends on
 * rate-limiting providers can lag ~10 minutes, so the two server read-backs
 * here poll up to 12 minutes. NOTE: this check WRITES — it saves ~4 test
 * drafts to the real mailbox's Drafts folder (clean them up afterwards). */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const BASE = "http://thunderbird:8942";
const SHOTS = "../docs/screenshots/stage3";
const FIELDS = ["date", "author", "recipients", "ccList", "subject", "read", "flagged", "tags", "preview"];
const STAMP = new Date().toISOString().replace(/\.\d+Z$/, "Z");

function findChrome() {
  const cacheRoot = join(process.env.HOME ?? "/root", ".cache", "ms-playwright");
  for (const entry of readdirSync(cacheRoot)) {
    if (!entry.startsWith("chromium-")) continue;
    for (const arch of ["chrome-linux-arm64", "chrome-linux"]) {
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

const result = { steps: {}, errors: [] };
page.on("pageerror", (err) => result.errors.push(String(err).slice(0, 160)));
page.on("console", (msg) => {
  if (msg.type() === "error") result.errors.push(`console: ${msg.text().slice(0, 140)}`);
});

async function shot(name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
  result.steps[name] = "captured";
}

async function api(name, args) {
  // 120 s: draft appends on rate-limiting IMAP can take a minute+; an
  // aborted in-flight save leaves TB's compose queue stuck, so never
  // give up on a write mid-flight.
  const res = await page.request.post(`${BASE}/api/tools/call`, { data: { name, arguments: args }, timeout: 120_000 });
  const payload = await res.json();
  if (!payload.ok) throw new Error(`${name}: ${payload.error}`);
  return payload.data;
}

/* Discover the composing identity + its Drafts/Trash folders at runtime —
 * real account URIs never live in a published harness. Uses the first
 * account (the SPA's default From identity for a fresh session). */
async function discoverMailbox() {
  const accounts = await api("listAccounts");
  const account = accounts.find((a) =>
    Array.isArray(a.identities) &&
    a.identities.some((i) => typeof i?.email === "string" && i.email.includes("@")));
  if (!account) throw new Error("no account with an email identity found");
  const identity = account.identities.find((i) => i.isDefault) ?? account.identities[0];
  const folders = await api("listFolders", { accountId: account.id });
  const kindOf = (f) => f.type ?? f.kind;
  const drafts = folders.find((f) => kindOf(f) === "drafts");
  const trash = folders.find((f) => kindOf(f) === "trash");
  if (!drafts?.path || !trash?.path) throw new Error("Drafts/Trash folder not found");
  return { email: identity.email, draftsPath: drafts.path, trashPath: trash.path };
}
const mailbox = await discoverMailbox();
const DRAFTS = mailbox.draftsPath;
const TRASH = mailbox.trashPath;
const SELF = mailbox.email;

/* Author the two "settled" drafts up front via the API: they settle in the
 * folder while the UI steps below run (the IMAP append is async — the
 * register polls below tolerate the lag). */
const SETTLED_DRAFT_SUBJECT = `Talaria stage-3 settled draft ${STAMP}`;
const SETTLED_DISCARD_SUBJECT = `Talaria stage-3 settled discard ${STAMP}`;
await api("saveDraft", {
  from: SELF,
  to: SELF,
  subject: SETTLED_DRAFT_SUBJECT,
  body: "Draft authored by the stage-3 check for the reopen/edit flow.",
  isHtml: false,
});
await api("saveDraft", {
  from: SELF,
  to: SELF,
  subject: SETTLED_DISCARD_SUBJECT,
  body: "Draft authored by the stage-3 check for the discard-to-Trash flow.",
  isHtml: false,
});

async function rowText(row) {
  return ((await row.textContent()) ?? "").trim();
}

/** Poll until the folder shows a row with this subject (IMAP appends settle
 *  in tens of seconds normally, minutes under provider rate limiting). */
async function waitDraft(subject, folder = DRAFTS, minutes = 12) {
  const deadline = Date.now() + minutes * 60_000;
  while (Date.now() < deadline) {
    try {
      const data = await api("searchMessages", { query: "", folderPath: folder, maxResults: 50, fields: FIELDS });
      const row = data.messages.find((m) => m.subject.trim() === subject);
      if (row) return row;
    } catch { /* transient sidecar hiccup — keep polling */ }
    await page.waitForTimeout(15_000);
  }
  return null;
}

/** A locator for the register row containing this text (auto-re-resolves —
 *  the virtualizer recycles DOM nodes, stale ElementHandles click the wrong
 *  row; learned the hard way). */
const rowLocator = (text) => page.locator('[role=option]', { hasText: text }).first();

/** The subject line of a register row (its second truncate span; the first
 *  is the sender — or "To: …" for draft rows). */
async function rowSubject(row) {
  const spans = await row.$$("span.truncate");
  return ((await spans[1]?.textContent()) ?? "").trim();
}

/** Click a register row and wait until the record sheet shows this subject. */
async function openRecord(subjectPart, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastSeen = "";
  while (Date.now() < deadline) {
    const sheet = await page.isVisible("article.record-sheet");
    const subject = sheet
      ? ((await page.$eval("article h2", (el) => el.textContent?.trim())) ?? "")
      : "";
    if (sheet && subject.includes(subjectPart)) return subject;
    lastSeen = subject;
    await rowLocator(subjectPart).click().catch(() => {});
    await page.waitForTimeout(3_000);
  }
  throw new Error(`record "${subjectPart}" never opened (last sheet: "${lastSeen}")`);
}

const composeSubject = `Talaria stage-3 compose check ${STAMP}`;

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector("[role=option]", { timeout: 40_000 });

/* ---- 1. entry points + posture chip ---- */
result.steps.composeButton = await page.isVisible('header button:has-text("Compose")');
result.steps.postureChip = await page.isVisible('header .badge:has-text("drafts enabled")');

/* ---- 2. keyboard c opens the composer; draft-only contract on show ---- */
await page.keyboard.press("c");
await page.waitForSelector('[aria-label="Drafts composer"]', { timeout: 8_000 });
result.steps.composerOpens = true;
result.steps.fromOptions = await page.$$eval("#compose-from option", (els) => els.length);
result.steps.draftOnlyNotice = await page.isVisible('text=Drafts save to your mailbox — sending happens in Thunderbird or on your phone.');
result.steps.noSendButton = (await page.$$eval(".compose-sheet button", (els) =>
  els.filter((b) => /\bsend\b/i.test(b.textContent ?? "")).length)) === 0;
result.steps.editorPresent = await page.isVisible(".compose-prose");

/* ---- 3. fill + save; the indicator is the honest UI signal ---- */
await page.fill('[aria-label="To recipients"]', SELF);
await page.keyboard.press("Enter");
result.steps.chipAdded = await page.isVisible(".recipient-chip");
await page.fill("#compose-subject", composeSubject);
await page.click(".compose-prose");
await page.keyboard.type("This body was written in the Talaria composer — the draft round-trips to the Drafts folder.");
await page.click('.compose-sheet button:has-text("Save draft")');
await page.waitForSelector('.compose-sheet >> text=Draft saved', { timeout: 60_000 });
result.steps.saveIndicator = true;
await shot("stage3-composer-desktop");
await page.screenshot({ path: `${SHOTS}/stage3-draft-saved.png` });
await page.keyboard.press("Escape");
await page.waitForSelector('[aria-label="Drafts composer"]', { state: "detached", timeout: 15_000 });

/* ---- 4. drafts-folder integration with an ALREADY-SETTLED draft ---- */
await page.keyboard.press("g");
await page.keyboard.press("d");
await page.waitForTimeout(1500);
{
  const deadline = Date.now() + 6 * 60_000;
  while (Date.now() < deadline) {
    if (await rowLocator(SETTLED_DRAFT_SUBJECT).isVisible().catch(() => false)) break;
    await page.keyboard.press("g");
    await page.keyboard.press("d");
    await page.waitForTimeout(8_000);
  }
}
result.steps.draftsRegisterRow = await rowLocator(SETTLED_DRAFT_SUBJECT).isVisible().catch(() => false);
await shot("stage3-drafts-folder");

await openRecord(SETTLED_DRAFT_SUBJECT, 60_000);
await page.waitForSelector('[aria-label="Drafts composer"]', { timeout: 20_000 });
result.steps.draftReopens = await page.isVisible("#compose-subject");
result.steps.draftReopensPrefilled = (await page.$eval("#compose-subject", (el) => el.value)) === SETTLED_DRAFT_SUBJECT;
result.steps.draftReopensWithBody =
  ((await page.$eval(".compose-prose", (el) => el.textContent?.length ?? 0)) ?? 0) > 20;

/* ---- 5. edit the settled draft → draftId rewrite (UI acceptance) ---- */
await page.click(".compose-prose");
await page.keyboard.press("Control+End");
await page.keyboard.type(" Appended in the composer during the edit check.");
await page.click('.compose-sheet button:has-text("Save draft")');
await page.waitForSelector('.compose-sheet >> text=Draft saved', { timeout: 60_000 });
result.steps.editSaveAccepted = true;
await page.keyboard.press("Escape");
await page.waitForSelector('[aria-label="Drafts composer"]', { state: "detached", timeout: 15_000 });

/* ---- 6. reply flow on the first INBOX mail (prefill + save) ---- */
await page.keyboard.press("g");
await page.keyboard.press("i");
await page.waitForTimeout(1500);
await page.waitForSelector("[role=option]", { timeout: 30_000 });
await page.waitForTimeout(1200);
let targetSubject = "";
{
  const rows = await page.$$("[role=option]");
  let target = rows[0];
  for (const row of rows) {
    const t = await rowText(row);
    if (!t.startsWith("Re:") && !t.startsWith("Fwd:") && !t.startsWith("To:")) { target = row; break; }
  }
  targetSubject = await rowSubject(target);
  await target.click();
}
if (!targetSubject) throw new Error("no INBOX row found for the reply flow");
// Open the record (not one of the reply/forward drafts) and verify the
// sheet actually shows it before touching the toolbar. The locator
// re-resolves every attempt (virtualizer node recycling makes stale
// ElementHandles click the wrong row).
await openRecord(targetSubject);
result.steps.replyButtons = await page.isVisible('article button[aria-label="Reply as a draft"]');
await page.click('article button[aria-label="Reply as a draft"]');
await page.waitForSelector('[aria-label="Drafts composer"]', { timeout: 10_000 });
result.steps.replyPrefilled = (await page.$eval("#compose-subject", (el) => el.value)).startsWith("Re: ");
await page.click(".compose-prose");
await page.keyboard.type("Reply drafted in the Talaria Stage-3 browser check.");
await shot("stage3-reply-prefilled");
await page.click('.compose-sheet button:has-text("Save draft")');
// The add-on's compose service can wedge (the documented forwardMessage
// IMAP hang family) — saves then answer 502 after ~60 s and the
// indicator lands on "Not saved". Record that honestly instead of
// crashing: reads stay healthy, only compose-tool saves hang.
const replySaved = await page
  .waitForSelector('.compose-sheet >> text=Draft saved', { timeout: 60_000 })
  .then(() => true)
  .catch(() => false);
result.steps.replySaveAccepted = replySaved;
result.steps.replySaveBlockedByComposeJam = !replySaved;
await shot("stage3-reply-saved");
await page.keyboard.press("Escape");
await page.waitForSelector('[aria-label="Drafts composer"]', { state: "detached", timeout: 15_000 }).catch(() => {});
if (!replySaved) {
  // The forward step uses the same wedged compose service — skip it.
  result.steps.composeJamSkippedForward = true;
}

/* ---- 7. forward flow (client-side quote, editable in the editor) ---- */
await page.waitForTimeout(1000);
await page.click('article button[aria-label="Forward as a draft"]');
await page.waitForSelector('[aria-label="Drafts composer"]', { timeout: 10_000 });
result.steps.forwardPrefilled = (await page.$eval("#compose-subject", (el) => el.value)).startsWith("Fwd: ");
result.steps.forwardQuoteInEditor = await page.isVisible('.compose-sheet >> text=-------- Original Message --------');
result.steps.forwardAttachmentsNote = await page.isVisible("text=Forwarded attachments are not copied");
await page.click(".compose-prose");
await page.keyboard.press("Control+Home");
await page.keyboard.type("Forwarded from the Talaria composer (Stage-3 check). ");
await page.click('.compose-sheet button:has-text("Save draft")');
await page.waitForSelector('.compose-sheet >> text=Draft saved', { timeout: 60_000 });
result.steps.forwardSaveAccepted = true;
await page.keyboard.press("Escape");
await page.waitForSelector('[aria-label="Drafts composer"]', { state: "detached", timeout: 15_000 });

/* ---- 8. discard: the settled discard-check draft moves to Trash ---- */
await page.fill("#talaria-search", "");
await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : null));
await page.waitForTimeout(1200);
await page.keyboard.press("g");
await page.keyboard.press("d");
await page.waitForTimeout(1500);
{
  const deadline = Date.now() + 4 * 60_000;
  while (Date.now() < deadline) {
    if (await rowLocator(SETTLED_DISCARD_SUBJECT).isVisible().catch(() => false)) break;
    const scope = await page.$eval('section[aria-label="Message list"] h2', (el) => el.textContent?.trim()).catch(() => "?");
    const searchVal = await page.$eval("#talaria-search", (el) => el.value).catch(() => "?");
    const first = await page.$$eval("[role=option]", (els) => (els[0]?.textContent ?? "").slice(0, 40).replace(/\s+/g, " "));
    console.log(`[discard-wait] scope=${scope} search=${JSON.stringify(searchVal)} first=${first}`);
    await page.keyboard.press("g");
    await page.keyboard.press("d");
    await page.waitForTimeout(8_000);
  }
}
await rowLocator(SETTLED_DISCARD_SUBJECT).click({ timeout: 30_000 });
await page.waitForSelector('[aria-label="Drafts composer"]', { timeout: 20_000 });
result.steps.discardPrefilled = (await page.$eval("#compose-subject", (el) => el.value)) === SETTLED_DISCARD_SUBJECT;
await page.click('.compose-sheet button:has-text("Discard")');
await page.waitForSelector("text=Discard this draft?", { timeout: 6_000 });
await shot("stage3-discard-confirm");
await page.click('[aria-label="Drafts composer"] button:has-text("Move to Trash")');
await page.waitForSelector('[aria-label="Drafts composer"]', { state: "detached", timeout: 15_000 });
result.steps.discardConfirmShown = true;
result.steps.discardToast = await page
  .$eval(".toast", (el) => el.textContent?.trim().slice(0, 70))
  .catch(() => null);
const trashed = await waitDraft(SETTLED_DISCARD_SUBJECT, TRASH, 10);
result.steps.discardLandsInTrash = trashed !== null;
const stillInDrafts = await waitDraft(SETTLED_DISCARD_SUBJECT, DRAFTS, 0.02).catch(() => null);
result.steps.discardRowLeftDraftsSoon = stillInDrafts === null;

/* ---- 9. shortcuts overlay documents the compose keys ---- */
await page.keyboard.press("?");
await page.waitForSelector("text=Compose (drafts)", { timeout: 5_000 });
result.steps.shortcutsOverlayComposeGroup = true;
result.steps.shortcutsForward = await page.isVisible("text=Forward the record as a draft");
await page.keyboard.press("Escape");

/* ---- 10. settings toggle: the composer can be hidden ---- */
await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("text=Drafts composer", { timeout: 15_000 });
result.steps.settingsTogglePresent = true;
await shot("stage3-settings-composer-toggle");
{
  const label = page.locator("label", { hasText: "Drafts composer" }).first();
  await label.locator("input.toggle").click();
  await page.waitForTimeout(300);
}
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector("[role=option]", { timeout: 40_000 });
result.steps.composeHiddenWhenOff = !(await page.isVisible('header button:has-text("Compose")'));
await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
{
  const label = page.locator("label", { hasText: "Drafts composer" }).first();
  await label.locator("input.toggle").click();
  await page.waitForTimeout(300);
}

/* ---- 11. honest offline failure (READ path only in real mode) ----
 * Aborting an in-flight saveDraft fetch leaves the addon's compose queue
 * stuck (observed 2026-11-24: every later save starves until TB restarts),
 * so the real-mode probe blocks a getMessage read and asserts the reader's
 * honest error state instead. The composer's "Not saved" honest-failure
 * assertion lives in the mock harness (abort-safe there). */
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector("[role=option]", { timeout: 40_000 });
await context.route("**/api/tools/call", async (route) => {
  const body = route.request().postData() ?? "";
  if (body.includes('"getMessage"')) return route.abort();
  return route.continue();
});
await page.locator("[role=option]").first().click();
await page.waitForSelector('section[aria-label="Message reader"] button:has-text("Try again")', { timeout: 30_000 });
result.steps.offlineHonestFailure = true;
await shot("stage3-offline-error");
await context.unroute("**/api/tools/call");
await page.waitForSelector('[aria-label="Drafts composer"]', { state: "detached", timeout: 15_000 });

/* ---- 12. server read-back of THIS run's compose draft (long poll) ---- */
const composeRow = await waitDraft(composeSubject);
result.steps.draftInDraftsFolder = composeRow !== null;
if (composeRow) {
  const detail = await api("getMessage", { messageId: composeRow.id, folderPath: DRAFTS, bodyFormat: "html", maxBodyChars: 50000 });
  result.steps.draftBodyRoundTrip = detail.body.includes("the draft round-trips to the Drafts folder");
  result.steps.draftRecipient = detail.recipients.includes(SELF);
  result.steps.draftFromIdentity = detail.author.includes(SELF);
}

/* ---- 13. phone: full-screen composer sheet ---- */
const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
phone.on("pageerror", (err) => result.errors.push(`phone: ${String(err).slice(0, 140)}`));
await phone.goto(BASE, { waitUntil: "domcontentloaded" });
await phone.waitForSelector("[role=option]", { timeout: 40_000 });
await phone.click('header button:has-text("New")');
await phone.waitForSelector('[aria-label="Drafts composer"]', { timeout: 8_000 });
const sheetBox = await phone.$eval(".compose-sheet", (el) => {
  const r = el.getBoundingClientRect();
  return { w: r.width, h: r.height, x: r.x, y: r.y };
});
result.steps.phoneFullScreen = sheetBox.w >= 385 && sheetBox.y <= 2;
await phone.screenshot({ path: `${SHOTS}/stage3-composer-mobile.png` });
await phone.click(".compose-prose");
await phone.keyboard.type("phone check");
await phone.click('.compose-sheet button:has-text("Save draft")');
// 90 s: compose latency grows through a session on rate-limiting IMAP.
await phone.waitForSelector('.compose-sheet >> text=Draft saved', { timeout: 90_000 });
result.steps.phoneSave = true;
await phone.close();

result.steps.errorsCount = result.errors.length;
console.log(JSON.stringify(result, null, 1));
await browser.close();
