/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Visual proof: captures the triage surface at desktop (1440×900) and
 * mobile (390×844) sizes, inbox with a message selected, plus supporting
 * states (dark theme, search results, empty result) for the design review.
 *
 * Env:
 *   SHOTS_BASE_URL  default http://localhost:5173 (vite dev, mock backend)
 *   SHOTS_OUT_MAIN  default ../../docs/screenshots  (the deliverable pair)
 *   SHOTS_OUT_REVIEW default ../../../../.impeccable/review  (review extras)
 */

import { mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const base = process.env.SHOTS_BASE_URL ?? "http://localhost:5173";
const outMain = resolve(here, process.env.SHOTS_OUT_MAIN ?? "../../docs/screenshots");
const outReview = resolve(here, process.env.SHOTS_OUT_REVIEW ?? "../../../../.impeccable/review");

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cacheRoot = join(process.env.HOME ?? "/root", ".cache", "ms-playwright");
  for (const entry of readdirSync(cacheRoot)) {
    if (!entry.startsWith("chromium-")) continue;
    for (const arch of ["chrome-linux-arm64", "chrome-linux"]) {
      try {
        readdirSync(join(cacheRoot, entry, arch));
        return join(cacheRoot, entry, arch, "chrome");
      } catch {
        /* next */
      }
    }
  }
  throw new Error("No cached Playwright chromium found.");
}

async function openPage(context, width, height) {
  const page = await context.newPage();
  await page.setViewportSize({ width, height });
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForSelector("main [role=option], section[aria-label='Message list'] [role=option]", { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(600);
  return page;
}

async function selectLogoMessage(page) {
  // Open the authored client thread so the record sheet shows real content.
  const row = page.getByText("Re: Logo refresh — second round of variants", { exact: false }).first();
  await row.click({ timeout: 10_000 });
  await page.waitForTimeout(900);
}

const browser = await chromium.launch({
  executablePath: findChrome(),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

mkdirSync(outMain, { recursive: true });
mkdirSync(outReview, { recursive: true });

try {
  // ---- desktop 1440×900, message selected ----
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const dPage = await openPage(desktop, 1440, 900);
  await selectLogoMessage(dPage);
  await dPage.screenshot({ path: join(outMain, "desktop.png") });
  console.log("wrote", join(outMain, "desktop.png"));

  // review extras: dark theme + search results (the theme control is the
  // "Choose theme" details-dropdown since Round 2 — a summary trigger)
  await dPage.click('summary[aria-label="Choose theme"]');
  await dPage.click('button[aria-label="Talaria Night theme"]');
  await dPage.waitForTimeout(400);
  await dPage.screenshot({ path: join(outReview, "desktop-dark.png") });
  console.log("wrote", join(outReview, "desktop-dark.png"));
  await dPage.click('summary[aria-label="Choose theme"]');
  await dPage.click('button[aria-label="Talaria Day theme"]');
  await dPage.getByRole("searchbox", { name: "Search mail" }).fill("from:sander-bauhaus.de");
  await dPage.waitForTimeout(900);
  await dPage.screenshot({ path: join(outReview, "desktop-search.png") });
  console.log("wrote", join(outReview, "desktop-search.png"));
  await dPage.getByRole("searchbox", { name: "Search mail" }).fill("zzz-no-such-entry");
  await dPage.waitForTimeout(900);
  await dPage.screenshot({ path: join(outReview, "desktop-empty.png") });
  console.log("wrote", join(outReview, "desktop-empty.png"));
  await desktop.close();

  // ---- mobile 390×844, message selected (reader view) ----
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mPage = await openPage(mobile, 390, 844);
  await selectLogoMessage(mPage);
  await mPage.screenshot({ path: join(outMain, "mobile-reader.png") });
  console.log("wrote", join(outMain, "mobile-reader.png"));
  // list view too
  await mPage.getByRole("button", { name: "Back" }).click();
  await mPage.waitForTimeout(400);
  await mPage.screenshot({ path: join(outMain, "mobile-list.png") });
  console.log("wrote", join(outMain, "mobile-list.png"));
  await mobile.close();
} finally {
  await browser.close();
}
