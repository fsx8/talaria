/* Round-2 verification: theme system, settings page, account labels,
 * persistence — production build against the live sidecar. */
import { readdirSync } from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const BASE = "http://thunderbird:8942";
const SHOTS = "../docs/screenshots/settings";
mkdirSync(SHOTS, { recursive: true });

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
  throw new Error("no chrome in playwright cache");
}

const result = {
  health: null,
  deepLink: null,
  gearNavigation: null,
  themeSwitch: {},
  labelMode: {},
  persistence: {},
  sseFolio: null,
  screenshots: [],
  errors: [],
};

const browser = await chromium.launch({ executablePath: findChrome(), args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.on("pageerror", (err) => result.errors.push("pageerror: " + String(err).slice(0, 160)));

async function themeColors() {
  return page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      dataTheme: document.documentElement.dataset.theme,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      primary: style.getPropertyValue("--color-primary").trim(),
      base100: style.getPropertyValue("--color-base-100").trim(),
    };
  });
}

async function railLabels() {
  // the real sidecar's account/folder enumeration takes seconds — wait for it
  await page.waitForFunction(
    () => document.querySelectorAll("aside div.mt-3 button span.truncate").length >= 3,
    { timeout: 45_000 },
  );
  return page.$$eval("aside div.mt-3 button span.truncate", (els) =>
    els.map((e) => e.textContent?.trim()).filter(Boolean),
  );
}

function shot(name) {
  result.screenshots.push(`${SHOTS}/${name}`);
  return page.screenshot({ path: join(SHOTS, name) });
}

// ---- 0. sidecar health ----
const healthRes = await fetch(`${BASE}/api/health`);
result.health = { status: healthRes.status, body: await healthRes.json() };

// ---- 1. deep link /settings (SPA fallback + routed view) ----
await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('section[aria-label="Settings"] h2');
result.deepLink = {
  url: page.url(),
  heading: await page.textContent('section[aria-label="Settings"] h2'),
  dataTheme: await page.evaluate(() => document.documentElement.dataset.theme),
};
await shot("settings-desktop-talaria-light.png");

// ---- 2. theme switching: data-theme + visibly different computed colors ----
result.themeSwitch.before = await themeColors();

await page.locator('section[aria-label="Settings"] button', { hasText: 'Talaria Night' }).first().click();
await page.waitForTimeout(250);
result.themeSwitch.talariaDark = await themeColors();
await shot("settings-talaria-dark.png");

await page.locator('section[aria-label="Settings"] button', { hasText: 'Cupcake' }).first().click();
await page.waitForTimeout(250);
result.themeSwitch.builtinCupcake = await themeColors();
await shot("settings-builtin-cupcake.png");

result.themeSwitch.distinct =
  result.themeSwitch.talariaDark.primary !== result.themeSwitch.before.primary &&
  result.themeSwitch.builtinCupcake.primary !== result.themeSwitch.talariaDark.primary &&
  result.themeSwitch.talariaDark.dataTheme === "talaria-dark" &&
  result.themeSwitch.builtinCupcake.dataTheme === "cupcake";

// ---- 3. account label mode (default email → identity), while cupcake is active ----
result.labelMode.emailLabels = await railLabels();
await page.click('input[name="talaria-account-label-mode"][value="identity"]', { force: true });
await page.waitForTimeout(250);
result.labelMode.identityLabels = await railLabels();
result.labelMode.changed =
  JSON.stringify(result.labelMode.emailLabels) !== JSON.stringify(result.labelMode.identityLabels) &&
  result.labelMode.identityLabels.length > 0;
// duplicate detection: identity names collide, emails do not
const dupes = (arr) => arr.length - new Set(arr).size;
result.labelMode.duplicatesEmail = dupes(result.labelMode.emailLabels);
result.labelMode.duplicatesIdentity = dupes(result.labelMode.identityLabels);
await shot("settings-labels-identity.png");

// ---- 4. persistence across reload (cupcake + identity labels still active) ----
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector('section[aria-label="Settings"] h2');
await page.waitForTimeout(300);
result.persistence = {
  dataThemeAfterReload: await page.evaluate(() => document.documentElement.dataset.theme),
  stored: await page.evaluate(() => localStorage.getItem("talaria.settings")),
  labelsAfterReload: await railLabels(),
};
result.persistence.themePersisted = result.persistence.dataThemeAfterReload === "cupcake";
result.persistence.labelsPersisted =
  JSON.stringify(result.persistence.labelsAfterReload) === JSON.stringify(result.labelMode.identityLabels);

// ---- 5. gear navigation + restore defaults ----
await page.click('header button[aria-label="Settings"]');
await page.waitForTimeout(200);
result.gearNavigation = { url: page.url(), heading: await page.textContent('section[aria-label="Settings"] h2') };

// restore: Talaria Day + email labels, then check the sidebar switcher Settings tab works
await page.locator('section[aria-label="Settings"] button', { hasText: 'Talaria Day' }).first().click();
await page.click('input[name="talaria-account-label-mode"][value="email"]', { force: true });
const switcherSettings = page.locator('aside [role="tab"]', { hasText: "Settings" });
result.gearNavigation.switcherTabVisible = (await switcherSettings.count()) > 0;
await switcherSettings.click();
await page.waitForTimeout(200);
result.gearNavigation.backToSettingsViaSwitcher = page.url().endsWith("/settings");

// ---- 6. inbox in talaria-light + talaria-dark (via the TopBar ThemeMenu) ----
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("[role=option]", { timeout: 60_000 });
await page.waitForTimeout(800);
result.sseFolio = await page.evaluate(() => {
  const el = document.querySelector("header span.tabular");
  return el ? Number(el.textContent?.replace(/\D/g, "")) : null;
});
result.themeSwitch.inboxLight = await themeColors();
await shot("inbox-talaria-light.png");

await page.click('summary[aria-label="Choose theme"]');
await page.waitForTimeout(250);
await page.locator('.dropdown-content button', { hasText: "Talaria Night" }).click();
await page.waitForTimeout(300);
result.themeSwitch.inboxDark = await themeColors();
await shot("inbox-talaria-dark.png");

// ---- 7. mobile settings ----
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
const mpage = await mobile.newPage();
mpage.on("pageerror", (err) => result.errors.push("mobile pageerror: " + String(err).slice(0, 160)));
await mpage.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
await mpage.waitForSelector('section[aria-label="Settings"] h2');
await mpage.waitForTimeout(400);
result.screenshots.push(`${SHOTS}/settings-mobile.png`);
await mpage.screenshot({ path: join(SHOTS, "settings-mobile.png"), fullPage: true });
await mobile.close();

console.log(JSON.stringify(result, null, 1));
writeFileSync(join(SHOTS, "result.json"), JSON.stringify(result, null, 1));
await browser.close();
