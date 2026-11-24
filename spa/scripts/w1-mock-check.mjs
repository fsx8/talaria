/* One-off: mock-mode regression with the W1 write tier (in-memory demo register).
 * Covers: register + reader + move picker flows (original scope) plus the
 * reviewer regressions: batch bar inside its pane (1440 + 390), reader
 * sheet inside the phone viewport (390), reader toolbar counter/Print
 * visible on narrow desktops (1366), folio ⇄ rail sync, and no ghost Move
 * picker after a scope switch. */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cacheRoot = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(process.env.HOME ?? "/root", ".cache", "ms-playwright");
  for (const entry of readdirSync(cacheRoot)) {
    if (!entry.startsWith("chromium-")) continue;
    for (const arch of ["chrome-linux64", "chrome-linux", "chrome-linux-arm64"]) {
      try { readdirSync(join(cacheRoot, entry, arch)); return join(cacheRoot, entry, arch, "chrome"); } catch {}
    }
  }
  throw new Error("no chrome");
}

const BASE = process.env.MOCK_BASE ?? "http://localhost:5173";
const browser = await chromium.launch({ executablePath: findChrome(), args: ["--no-sandbox"] });
const result = { steps: {}, errors: [] };

/** Fresh page; wires page-error collection. */
async function newPage(width, height) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => result.errors.push(`w${width}: ${String(e).slice(0, 120)}`));
  await p.goto(BASE, { waitUntil: "domcontentloaded" });
  await p.waitForSelector("[role=option]", { timeout: 20_000 });
  return { ctx, p };
}

/** Click the first row that is a mail (rows may lead with a draft entry —
 *  "To: " prefix — which opens the composer, not the reader). */
async function clickMailRow(p) {
  const rows = await p.$$("[role=option]");
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    const label = ((await rows[i].textContent()) ?? "").trim();
    if (label.startsWith("To: ")) continue; // draft row → composer
    await rows[i].click();
    try {
      await p.waitForSelector("article.record-sheet", { timeout: 6_000 });
      return true;
    } catch { /* next row */ }
  }
  return false;
}

const batchButtonsInsidePane = (p) =>
  p.evaluate(() => {
    const section = document.querySelector('section[aria-label="Message list"]');
    const pane = section.getBoundingClientRect();
    const bar = section.querySelector(".min-h-10");
    const els = [
      ...(bar?.querySelectorAll(":scope > div > button, :scope > div > details > summary") ?? []),
    ];
    const rects = els.map((b) => {
      const r = b.getBoundingClientRect();
      return { label: (b.getAttribute("aria-label") ?? b.textContent ?? "").trim().slice(0, 12), left: Math.round(r.left), right: Math.round(r.right) };
    });
    return {
      rects,
      offenders: rects.filter((r) => r.left < pane.left - 0.5 || r.right > pane.right + 0.5),
      paneRight: Math.round(pane.right),
    };
  });

/* ---- desktop 1440×900: reader, move picker, batch bar, folio ---- */
{
  const { ctx, p } = await newPage(1440, 900);
  result.steps.rows = await p.$$eval("[role=option]", (els) => els.length);
  result.steps.selectVisible = await p.isVisible('button:has-text("Select")');

  // open a demo message and use the reader Move picker — NOT the seeded demo
  // draft: since W2 (Stage 3) a drafts-folder row opens the composer, which
  // would block the move-picker flow this check exercises.
  result.steps.openedReader = await clickMailRow(p);

  await p.click("article details.dropdown summary");
  await p.waitForSelector("article .dropdown-content:visible", { timeout: 3000 });
  await p.click('article .dropdown-content button:has-text("Newsletter")');
  await p.waitForTimeout(900);
  result.steps.moveToast = await p.$eval(".toast", (el) => el.textContent?.trim().slice(0, 60)).catch(() => null);

  /* F6: the batch-bar Move picker must not linger open (and disabled) after
   * the scope switch dropped its entries; Escape must close a live one. */
  const ensureSelectMode = async () => {
    if (!(await p.isVisible('button[aria-label="Leave selection mode"]'))) {
      await p.click('button[aria-label="Select entries for batch actions"]');
    }
  };
  await p.waitForSelector('button[aria-label="Select entries for batch actions"]', { timeout: 8000 });
  await ensureSelectMode();
  await p.locator('input[type=checkbox]').first().click();
  await p.click('section[aria-label="Message list"] details.dropdown summary');
  await p.waitForSelector('section[aria-label="Message list"] .dropdown-content:visible', { timeout: 3000 });
  await p.locator("aside button", { hasText: "Newsletter" }).first().click();
  await p.waitForTimeout(1200);
  result.steps.noGhostPicker = await p.evaluate(() => {
    const list = document.querySelector('section[aria-label="Message list"]');
    return [...list.querySelectorAll("details.dropdown")].every((d) => !d.hasAttribute("open"));
  });
  // a live picker closes on Escape
  await ensureSelectMode();
  await p.locator('input[type=checkbox]').first().click();
  await p.click('section[aria-label="Message list"] details.dropdown summary');
  await p.waitForSelector('section[aria-label="Message list"] .dropdown-content:visible', { timeout: 3000 });
  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);
  result.steps.escapeClosesPicker = await p.evaluate(() => {
    const list = document.querySelector('section[aria-label="Message list"]');
    return [...list.querySelectorAll("details.dropdown")].every((d) => !d.hasAttribute("open"));
  });

  /* F2 (desktop): every batch-bar control inside the pane (Done!). */
  await ensureSelectMode();
  await p.locator('input[type=checkbox]').first().click();
  await p.waitForTimeout(300);
  result.steps.batchBarDesktop = await batchButtonsInsidePane(p);
  if (await p.isVisible('button[aria-label="Leave selection mode"]')) {
    await p.click('button[aria-label="Leave selection mode"]');
  }

  /* F5: the folio reads the locally reconciled rail tally — a read toggle
   * moves both together, without waiting on the 60 s poll. */
  const folioText = () =>
    p.$eval('[title*="Unread across all accounts"] span.tabular', (el) => el.textContent?.trim() ?? "");
  const railText = () =>
    p.evaluate(() => {
      const btn = [...document.querySelectorAll("aside button")].find((b) => (b.textContent ?? "").trim().startsWith("All mail"));
      return btn?.querySelector("span.tabular")?.textContent?.trim() ?? "0";
    });
  result.folioUnread = { start: await folioText(), rail: await railText() };
  const unreadRow = p.locator('[role=option]:has(.unread-dot)').filter({ hasNotText: "To: " }).first();
  await unreadRow.hover();
  await unreadRow.locator('button[title="Mark read"], button[aria-label="Mark read"]').first().click();
  await p.waitForFunction(
    (prev) => {
      const folio = document.querySelector('[title*="Unread across all accounts"] span.tabular')?.textContent?.trim() ?? null;
      const btn = [...document.querySelectorAll("aside button")].find((b) => (b.textContent ?? "").trim().startsWith("All mail"));
      const rail = btn?.querySelector("span.tabular")?.textContent?.trim() ?? "0";
      return folio !== prev && folio === rail;
    },
    result.folioUnread.start,
    { timeout: 8_000, polling: 250 },
  ).catch(() => {});
  result.folioUnread.end = await folioText();
  result.folioUnread.endRail = await railText();
  result.steps.folioSyncs = result.folioUnread.end === result.folioUnread.endRail && result.folioUnread.end !== result.folioUnread.start;

  await ctx.close();
}

/* ---- desktop 1366×768: reader toolbar counter + Print in viewport ---- */
{
  const { ctx, p } = await newPage(1366, 768);
  await clickMailRow(p);
  result.steps.toolbar1366 = await p.evaluate(() => {
    const toolbar = document.querySelector("article .flex.flex-wrap.items-center.gap-1");
    const counter = [...(toolbar?.querySelectorAll("span") ?? [])].find((s) => /of \d+ shown/.test(s.textContent ?? ""));
    const printBtn = [...(toolbar?.querySelectorAll("button") ?? [])].find((b) => (b.textContent ?? "").includes("Print"));
    const cr = counter?.getBoundingClientRect();
    const pr = printBtn?.getBoundingClientRect();
    return {
      counterLines: cr ? Math.round(cr.height / 16) : null,
      counterRight: cr ? Math.round(cr.right) : null,
      printRight: pr ? Math.round(pr.right) : null,
      innerWidth: window.innerWidth,
      docScroll: document.documentElement.scrollWidth,
    };
  });
  result.steps.toolbarFits1366 =
    result.steps.toolbar1366.counterLines === 1 &&
    (result.steps.toolbar1366.counterRight ?? 9e9) <= result.steps.toolbar1366.innerWidth &&
    (result.steps.toolbar1366.printRight ?? 9e9) <= result.steps.toolbar1366.innerWidth &&
    result.steps.toolbar1366.docScroll <= result.steps.toolbar1366.innerWidth;
  await ctx.close();
}

/* ---- phone 390×844: the reader sheet never overflows; batch bar wraps ---- */
{
  const { ctx, p } = await newPage(390, 844);
  await clickMailRow(p);
  const readerFit = await p.evaluate(() => ({
    docScroll: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    sectionW: Math.round(document.querySelector('[aria-label="Message reader"]')?.getBoundingClientRect().width ?? 0),
    toolbarOverflow: (() => {
      const t = document.querySelector("article .flex.flex-wrap.items-center.gap-1");
      return t ? t.scrollWidth - t.clientWidth : 0;
    })(),
  }));
  result.steps.reader390 = readerFit;
  result.steps.readerFits390 = readerFit.docScroll <= readerFit.innerWidth && readerFit.sectionW === readerFit.innerWidth;

  // back to the list; select mode on a phone — batch bar must wrap, not clip
  await p.keyboard.press("Escape"); // close reader → back to the list
  await p.waitForTimeout(400);
  await p.click('button[aria-label="Select entries for batch actions"]');
  await p.locator('input[type=checkbox]').first().click();
  await p.waitForTimeout(300);
  result.steps.batchBarPhone = await batchButtonsInsidePane(p);
  result.steps.batchBarFits390 = result.steps.batchBarPhone.offenders.length === 0;
  // leaving selection mode must be reachable (tap Done)
  await p.click('button[aria-label="Leave selection mode"]');
  result.steps.doneTappable = (await p.locator('button[aria-label="Leave selection mode"]').count()) === 0;
  await ctx.close();
}

/* settings still work in mock (kept from the original check) */
{
  const { ctx, p } = await newPage(1440, 900);
  await p.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(800);
  result.steps.actionsCard = await p.isVisible("text=Mark as read on open");
  result.steps.demoNote = await p.isVisible("text=Demo data");
  await p.screenshot({ path: "../docs/local/screenshots/round3/w1-mock-demo.png" });
  result.steps["w1-mock-demo"] = "captured";
  await ctx.close();
}

result.steps.errorsCount = result.errors.length;
console.log(JSON.stringify(result, null, 1));
await browser.close();
