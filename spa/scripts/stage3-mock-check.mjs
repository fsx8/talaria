/* One-off: Round-3 Stage 3 — mock-mode regression (in-memory demo register).
 * The composer works against the mock backend: new draft, drafts-register
 * integration (immediate in-memory settle), draftId edit, reply prefill,
 * forward quote, discard, settings toggle. Zero page errors expected. */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

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
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 140)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 120)}`);
});

const result = { steps: {}, errors };

await page.goto("http://localhost:5173", { waitUntil: "domcontentloaded" });
await page.waitForSelector("[role=option]", { timeout: 20_000 });

/* 1. compose new → chips → save (mock saves instantly) */
await page.keyboard.press("c");
await page.waitForSelector('[aria-label="Drafts composer"]', { timeout: 8_000 });
result.steps.composerOpens = true;
result.steps.draftOnlyNotice = await page.isVisible('text=Drafts save to your mailbox — sending happens in Thunderbird or on your phone.');
result.steps.noSendButton = (await page.$$eval(".compose-sheet button", (els) =>
  els.filter((b) => /\bsend\b/i.test(b.textContent ?? "")).length)) === 0;

await page.fill('[aria-label="To recipients"]', "mareike@sander-bauhaus.de");
await page.keyboard.press("Enter");
await page.fill("#compose-subject", "Mock composer round-trip");
await page.click(".compose-prose");
await page.keyboard.type("Demo register draft — saved in memory.");
await page.click('.compose-sheet button:has-text("Save draft")');
await page.waitForSelector('.compose-sheet >> text=Draft saved', { timeout: 20_000 });
result.steps.saveIndicator = true;
await page.keyboard.press("Escape");
await page.waitForSelector('[aria-label="Drafts composer"]', { state: "detached", timeout: 10_000 });

/* 2. drafts register (g d) shows the draft; click re-opens the composer */
await page.keyboard.press("g");
await page.keyboard.press("d");
await page.waitForTimeout(1200);
result.steps.draftsRow = await page.isVisible('[role=option]:has-text("Mock composer round-trip")');
await page.locator('[role=option]', { hasText: "Mock composer round-trip" }).first().click();
await page.waitForSelector('[aria-label="Drafts composer"]', { timeout: 15_000 });
result.steps.reopenPrefilled = (await page.$eval("#compose-subject", (el) => el.value)) === "Mock composer round-trip";
result.steps.reopenBody = await page.isVisible('.compose-sheet >> text=Demo register draft');
await page.click(".compose-prose");
await page.keyboard.press("Control+End");
await page.keyboard.type(" Edited in the demo register.");
await page.click('.compose-sheet button:has-text("Save draft")');
await page.waitForSelector('.compose-sheet >> text=Draft saved', { timeout: 20_000 });
result.steps.editAccepted = true;
await page.keyboard.press("Escape");
await page.waitForSelector('[aria-label="Drafts composer"]', { state: "detached", timeout: 10_000 });

/* 3. reply prefill on a demo record */
await page.keyboard.press("g");
await page.keyboard.press("i");
await page.waitForTimeout(1200);
await page.fill("#talaria-search", "Logo refresh");
await page.waitForFunction(
  () => [...document.querySelectorAll("[role=option]")].some((r) => (r.textContent ?? "").includes("second round")),
  { timeout: 20_000 },
);
await page.waitForTimeout(1000);
await page.locator('[role=option]', { hasText: "second round of variants" }).first().click();
await page.waitForSelector("article.record-sheet", { timeout: 15_000 });
result.steps.replyButtons = await page.isVisible('article button[aria-label="Reply all as a draft"]');
await page.click('article button[aria-label="Reply all as a draft"]');
await page.waitForSelector('[aria-label="Drafts composer"]', { timeout: 10_000 });
result.steps.replyAllPrefilled = (await page.$eval("#compose-subject", (el) => el.value)).startsWith("Re: ");
result.steps.replyAllChips = await page.isVisible(".recipient-chip");
await page.click(".compose-prose");
await page.keyboard.type("Reply-all drafted in the mock register.");
await page.click('.compose-sheet button:has-text("Save draft")');
await page.waitForSelector('.compose-sheet >> text=Draft saved', { timeout: 20_000 });
result.steps.replySaveAccepted = true;
await page.keyboard.press("Escape");
await page.waitForSelector('[aria-label="Drafts composer"]', { state: "detached", timeout: 10_000 });

/* 4. forward quote in the editor */
await page.waitForTimeout(800);
await page.click('article button[aria-label="Forward as a draft"]');
await page.waitForSelector('[aria-label="Drafts composer"]', { timeout: 10_000 });
result.steps.forwardPrefilled = (await page.$eval("#compose-subject", (el) => el.value)).startsWith("Fwd: ");
result.steps.forwardQuote = await page.isVisible('.compose-sheet >> text=-------- Original Message --------');
await page.click('.compose-sheet button:has-text("Save draft")');
await page.waitForSelector('.compose-sheet >> text=Draft saved', { timeout: 20_000 });
result.steps.forwardSaveAccepted = true;
await page.keyboard.press("Escape");
await page.waitForSelector('[aria-label="Drafts composer"]', { state: "detached", timeout: 10_000 });

/* 5. discard: the mock draft moves to Trash (in-memory move) */
await page.fill("#talaria-search", "");
await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : null));
await page.waitForTimeout(1000);
await page.keyboard.press("g");
await page.keyboard.press("d");
await page.waitForTimeout(1200);
await page.locator('[role=option]', { hasText: "Mock composer round-trip" }).first().click();
await page.waitForSelector('[aria-label="Drafts composer"]', { timeout: 15_000 });
await page.click('.compose-sheet button:has-text("Discard")');
await page.waitForSelector("text=Discard this draft?", { timeout: 6_000 });
await page.click('[aria-label="Drafts composer"] button:has-text("Move to Trash")');
await page.waitForSelector('[aria-label="Drafts composer"]', { state: "detached", timeout: 10_000 });
result.steps.discardToast = await page.$eval(".toast", (el) => el.textContent?.trim().slice(0, 60)).catch(() => null);
await page.waitForTimeout(1000);
result.steps.discardRowGone = !(await page.isVisible('[role=option]:has-text("Mock composer round-trip")'));
await page.screenshot({ path: "../docs/local/screenshots/stage3/stage3-mock-compose.png" });
result.steps["stage3-mock-compose"] = "captured";

/* 6. the close-guard must never lie: type → immediate Close (the blur
 *    autosave races the close path; the draft saves, no failure dialog) */
await page.keyboard.press("g");
await page.keyboard.press("i");
await page.waitForTimeout(1200);
await page.keyboard.press("c");
await page.waitForSelector('[aria-label="Drafts composer"]', { timeout: 8_000 });
await page.fill('[aria-label="To recipients"]', "mareike@sander-bauhaus.de");
await page.keyboard.press("Enter");
await page.fill("#compose-subject", "Close-guard race");
await page.click(".compose-prose");
await page.keyboard.type("Type then close at once.");
await page.click('button[aria-label="Close composer"]');
await page.waitForTimeout(2_000);
result.steps.closeGuardRace = await page.evaluate(() => ({
  guard: document.querySelector('[role="alertdialog"]')?.querySelector("p")?.textContent?.trim() ?? null,
  composerOpen: !!document.querySelector('[aria-label="Drafts composer"]'),
}));
result.steps.closeGuardHonest =
  result.steps.closeGuardRace.guard === null && !result.steps.closeGuardRace.composerOpen;

/* 7. the dirty model: pristine closes silently; typed recipient text that
 *    never became a chip asks first ("Unsaved edits"); a fully typed
 *    address commits on close and saves */
await page.keyboard.press("c");
await page.waitForSelector('[aria-label="Drafts composer"]', { timeout: 8_000 });
await page.waitForTimeout(600);
await page.click('button[aria-label="Close composer"]');
await page.waitForTimeout(1_200);
result.steps.pristineClose = await page.evaluate(() => ({
  guard: !!document.querySelector('[role="alertdialog"]'),
  composerOpen: !!document.querySelector('[aria-label="Drafts composer"]'),
}));
result.steps.pristineClean = !result.steps.pristineClose.guard && !result.steps.pristineClose.composerOpen;

// half-typed recipient → close must ask, with honest copy
await page.keyboard.press("c");
await page.waitForSelector('[aria-label="Drafts composer"]', { timeout: 8_000 });
await page.click('[aria-label="To recipients"]');
await page.keyboard.type("marei");
await page.click('button[aria-label="Close composer"]');
await page.waitForSelector('[role="alertdialog"]', { timeout: 6_000 });
result.steps.recipientGuard = await page.evaluate(() => ({
  h3: document.querySelector('[role="alertdialog"]')?.querySelector("h3")?.textContent?.trim() ?? null,
  p: document.querySelector('[role="alertdialog"]')?.querySelector("p")?.textContent?.trim() ?? null,
}));
result.steps.recipientGuardHonest = result.steps.recipientGuard.h3 === "Unsaved edits";
await page.click('[role="alertdialog"] button:has-text("Keep editing")');
await page.waitForTimeout(300);
// full address without Enter commits on close (blur-commit) and saves
await page.fill('[aria-label="To recipients"]', "jannis@tinteundton.de");
await page.fill("#compose-subject", "Blur-commit on close");
await page.click('button[aria-label="Close composer"]');
await page.waitForTimeout(2_000);
result.steps.recipientCommit = await page.evaluate(() => ({
  guard: !!document.querySelector('[role="alertdialog"]'),
  composerOpen: !!document.querySelector('[aria-label="Drafts composer"]'),
}));
result.steps.recipientCommitCloses = !result.steps.recipientCommit.guard && !result.steps.recipientCommit.composerOpen;

/* 8. the seeded demo draft opens in the composer without raw markdown —
 *    what the reader renders is what the editor shows */
await page.keyboard.press("g");
await page.keyboard.press("d");
await page.waitForTimeout(1_200);
await page.locator('[role=option]', { hasText: "Entwurf: Antwort an Mareike" }).first().click();
await page.waitForSelector('[aria-label="Drafts composer"]', { timeout: 15_000 });
await page.waitForTimeout(600);
result.steps.demoDraftBody = await page.evaluate(() => {
  const prose = document.querySelector(".compose-prose");
  const text = prose?.textContent ?? "";
  return { head: text.slice(0, 80), rawMarkdown: /\*\*|`VITE_BACKEND/.test(text) };
});
result.steps.demoDraftClean = !result.steps.demoDraftBody.rawMarkdown && result.steps.demoDraftBody.head.includes("Liebe Mareike");
await page.keyboard.press("Escape"); // close without touching it
await page.waitForSelector('[aria-label="Drafts composer"]', { state: "detached", timeout: 10_000 });

/* 9. settings: the composer toggle exists and works in mock */
await page.goto("http://localhost:5173/settings", { waitUntil: "domcontentloaded" });
await page.waitForSelector("text=Drafts composer", { timeout: 15_000 });
result.steps.settingsTogglePresent = true;

result.steps.errorsCount = errors.length;
console.log(JSON.stringify(result, null, 1));
await browser.close();
