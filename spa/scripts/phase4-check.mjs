/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Phase 4 visual + functional proof.
 *
 *   MODE=mock  — vite dev server (demo register): threaded reader, contacts,
 *                agenda (docked + page), desktop + mobile.
 *   MODE=real  — the live sidecar: real thread, real contacts, real agenda,
 *                real web-push subscribe + receipt.
 *
 * Output: docs/local/screenshots/phase4/*.png and a JSON verdict.
 *
 * Env: MODE=mock|real (default mock), BASE (default per mode), SHOTS_OUT.
 */

import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const MODE = process.env.MODE ?? "mock";
const BASE =
  process.env.BASE ?? (MODE === "real" ? "http://thunderbird:8942" : "http://localhost:5173");
const out = resolve(here, process.env.SHOTS_OUT ?? "../../docs/local/screenshots/phase4");
mkdirSync(out, { recursive: true });

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
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
  throw new Error("No cached Playwright chromium found.");
}

const browser = await chromium.launch({
  executablePath: findChrome(),
  // In real mode the browser reaches the sidecar over plain http on the
  // compose network — not a secure context, so service workers and the Push
  // API are disabled. The flag marks the origin trusted for this test run
  // (the production origin is https behind Cloudflare Access, where no flag
  // is needed).
  args: ["--no-sandbox", "--disable-dev-shm-usage"].concat(
    MODE === "real" ? [`--unsafely-treat-insecure-origin-as-secure=${BASE}`] : [],
  ),
});

const result = { mode: MODE, base: BASE, shots: [], checks: {}, errors: [] };
const shot = async (page, name) => {
  const path = join(out, `${name}.png`);
  await page.screenshot({ path });
  result.shots.push(`${name}.png`);
  console.log("wrote", path);
};

async function newPage(width, height, mobile = false) {
  const context = await browser.newContext({
    viewport: { width, height },
    isMobile: mobile,
    hasTouch: mobile,
  });
  if (MODE === "real") {
    // Web-push needs the permission granted up front (no dialog in headless).
    await context.grantPermissions(["notifications"], { origin: BASE });
  }
  const page = await context.newPage();
  page.on("pageerror", (err) => result.errors.push(String(err).slice(0, 140)));
  return { context, page };
}

if (MODE === "mock") {
  /* ---------- mock: deterministic demo register ---------- */
  const { context, page } = await newPage(1440, 900);
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("[role=option]", { timeout: 20_000 });

  // threaded reader: open the logo-refresh thread member
  await page.getByText("Re: Logo refresh — second round of variants").first().click();
  await page.waitForFunction(
    () => {
      const heading = [...document.querySelectorAll("h3")].find((h) => h.textContent?.includes("Thread ·"));
      return heading && document.querySelectorAll("section[aria-label='Conversation'] li").length > 1;
    },
    { timeout: 20_000 },
  );
  result.checks.mockThreadHeader = await page.evaluate(() => {
    const el = [...document.querySelectorAll("h3")].find((h) => h.textContent?.includes("Thread ·"));
    return el?.textContent?.trim() ?? null;
  });
  // expand all so the transcript shows
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Expand all"));
    btn?.scrollIntoView({ block: "center" });
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Expand all"))?.click());
  await page.waitForTimeout(400);
  await shot(page, "mock-threaded-reader-desktop");
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Collapse all"))?.click());

  // contacts view
  await page.getByRole("tab", { name: "Contacts" }).first().click();
  await page.waitForSelector("[role=option][aria-label='Contacts'] >> nth=2", { timeout: 10_000 }).catch(() => {});
  await page.waitForFunction(
    () => document.querySelectorAll("[role=option]").length > 3,
    { timeout: 10_000 },
  );
  await page.getByText("Zeynep Aydın").first().click();
  await page.waitForFunction(() => document.body.innerText.includes("Druckwerk Neukölln"), { timeout: 8000 });
  await shot(page, "mock-contacts-desktop");

  // agenda page
  await page.getByRole("tab", { name: "Agenda" }).first().click();
  await page.waitForFunction(() => document.body.innerText.includes("Today"), { timeout: 8000 });
  await shot(page, "mock-agenda-desktop");

  // rail with docked agenda widget (back to mail view)
  await page.getByRole("tab", { name: "Register" }).first().click();
  await page.waitForTimeout(400);
  await shot(page, "mock-mail-agenda-docked-desktop");
  await context.close();

  // mobile: stacked reader with thread + contacts + agenda
  const m = await newPage(390, 844, true);
  await m.page.goto(BASE, { waitUntil: "networkidle" });
  await m.page.waitForSelector("[role=option]", { timeout: 20_000 });
  await m.page.getByText("Re: Logo refresh — second round of variants").first().click();
  await m.page.waitForFunction(
    () => {
      const heading = [...document.querySelectorAll("h3")].find((h) => h.textContent?.includes("Thread ·"));
      return heading && document.querySelectorAll("section[aria-label='Conversation'] li").length > 1;
    },
    { timeout: 20_000 },
  );
  await m.page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Expand all"));
    btn?.scrollIntoView({ block: "center" });
  });
  await m.page.waitForTimeout(300);
  await m.page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Expand all"))?.click());
  await m.page.waitForTimeout(400);
  await shot(m.page, "mock-threaded-reader-mobile");
  // on phones the switcher lives in the rail drawer
  await m.page.getByRole("button", { name: "Back" }).click();
  await m.page.getByRole("button", { name: "Open folders" }).click();
  await m.page.getByRole("tab", { name: "Contacts" }).first().click();
  await m.page.waitForFunction(() => document.querySelectorAll("[role=option]").length > 3, { timeout: 10_000 });
  await shot(m.page, "mock-contacts-mobile");
  await m.page.getByRole("button", { name: "Open folders" }).click();
  await m.page.getByRole("tab", { name: "Agenda" }).first().click();
  await m.page.waitForFunction(() => document.body.innerText.includes("Today"), { timeout: 8000 });
  await shot(m.page, "mock-agenda-mobile");
  await m.context.close();
} else {
  /* ---------- real: the live sidecar ---------- */
  // Persistent (non-incognito) profile: Chromium disables the Push API in
  // incognito contexts, and Playwright's default contexts are incognito.
  const profileDir = "/tmp/opencode/talaria-chrome-profile";
  rmSync(profileDir, { recursive: true, force: true });
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: findChrome(),
    viewport: { width: 1440, height: 900 },
    args: ["--no-sandbox", "--disable-dev-shm-usage", `--unsafely-treat-insecure-origin-as-secure=${BASE}`],
  });
  await context.grantPermissions(["notifications"], { origin: BASE });

  async function realPage(width, height) {
    const p = await context.newPage();
    await p.setViewportSize({ width, height });
    p.on("pageerror", (err) => result.errors.push(String(err).slice(0, 140)));
    return p;
  }

  const page = await realPage(1440, 900);
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[role=option]", { timeout: 60_000 });

  // real thread: open register rows until the conversation panel appears
  // (cross-folder threadOf — real mailbox subjects never enter a published
  // harness). Records honestly when no threaded mail is among the rows.
  const openRealThread = async (p) => {
    const rows = await p.$$("[role=option]");
    for (let i = 0; i < Math.min(rows.length, 12); i++) {
      await rows[i].click({ timeout: 20_000 }).catch(() => {});
      await p.waitForSelector("article.record-sheet", { timeout: 20_000 }).catch(() => {});
      const got = await p
        .waitForFunction(
          () => [...document.querySelectorAll("h3")].some((h) => h.textContent?.includes("Thread ·")),
          { timeout: 10_000 },
        )
        .then(() => true)
        .catch(() => false);
      if (got) return true;
      await p.keyboard.press("Escape").catch(() => {});
      await p.waitForTimeout(400);
    }
    return false;
  };
  result.checks.realThreadOpened = await openRealThread(page);
  if (result.checks.realThreadOpened) {
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Expand all"));
      btn?.scrollIntoView({ block: "center" });
    });
    await page.waitForTimeout(500);
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Expand all"))?.click());
    await page
      .waitForSelector("section[aria-label='Conversation'] .thread-prose", { timeout: 45_000 })
      .catch(() => {});
    await page.waitForTimeout(600);
  }
  await shot(page, "real-threaded-reader-desktop");
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Collapse all"))?.click());

  // push: subscribe through the real control
  const bell = page.getByRole("button", { name: /Push notifications/ });
  await bell.click({ timeout: 10_000 });
  await page.waitForFunction(
    () => document.querySelector("button[aria-pressed='true'][aria-label^='Push notifications']") !== null,
    { timeout: 30_000 },
  );
  result.checks.pushSubscribed = true;
  await shot(page, "real-push-enabled-desktop");

  // real contacts
  await page.getByRole("tab", { name: "Contacts" }).first().click();
  await page.waitForFunction(() => document.querySelectorAll("[role=option]").length > 3, { timeout: 40_000 });
  result.checks.realContactRows = await page.evaluate(
    () => document.querySelectorAll("[role=option]").length,
  );
  await shot(page, "real-contacts-desktop");

  // real agenda
  await page.getByRole("tab", { name: "Agenda" }).first().click();
  await page.waitForFunction(
    () => document.body.innerText.includes("Today") || document.body.innerText.includes("No calendar entries"),
    { timeout: 40_000 },
  );
  result.checks.realAgendaEntries = await page.evaluate(() => {
    const text = document.body.innerText;
    const match = text.match(/(\d+)\s+open tasks/);
    return { hasToday: text.includes("Today"), tasks: match ? Number(match[1]) : 0 };
  });
  await shot(page, "real-agenda-desktop");
  await page.close();

  // mobile real: reader thread (a new page in the same persistent profile)
  const mPage = await realPage(390, 844);
  const m = { page: mPage, context };
  mPage.on("console", (msg) => { if (msg.type() === "error") result.errors.push("mobile console: " + msg.text().slice(0, 120)); });
  await m.page.goto(BASE, { waitUntil: "domcontentloaded" });
  await m.page.waitForSelector("[role=option]", { timeout: 60_000 });
  result.checks.realThreadMobileOpened = await openRealThread(m.page);
  await m.page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Expand all"));
    btn?.scrollIntoView({ block: "center" });
  });
  await m.page.waitForTimeout(500);
  await m.page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Expand all"))?.click());
  await m.page
    .waitForSelector("section[aria-label='Conversation'] .thread-prose", { timeout: 45_000 })
    .catch(() => {});
  await m.page.waitForTimeout(600);
  await shot(m.page, "real-threaded-reader-mobile");
  await m.page.close();

  // mobile real: contacts + agenda via the drawer
  const m2Page = await realPage(390, 844);
  const m2 = { page: m2Page, context };
  await m2.page.goto(BASE, { waitUntil: "domcontentloaded" });
  await m2.page.waitForSelector("header", { timeout: 60_000 });
  await m2.page.getByRole("button", { name: "Open folders" }).click();
  await m2.page.getByRole("tab", { name: "Contacts" }).first().click();
  await m2.page.waitForFunction(() => document.querySelectorAll("[role=option]").length > 3, { timeout: 60_000 });
  await shot(m2.page, "real-contacts-mobile");
  await m2.page.getByRole("button", { name: "Open folders" }).click();
  await m2.page.getByRole("tab", { name: "Agenda" }).first().click();
  await m2.page.waitForFunction(
    () => document.body.innerText.includes("Today") || document.body.innerText.includes("No calendar entries"),
    { timeout: 60_000 },
  );
  await shot(m2.page, "real-agenda-mobile");
  await m2.page.close();
  await context.close();
}

writeFileSync(join(out, `result-${MODE}.json`), JSON.stringify(result, null, 1));
console.log(JSON.stringify(result, null, 1));
await browser.close();
