/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Generates the PWA icon set from the authored favicon mark by rasterizing
 * it with the local Playwright chromium (no system image tools needed).
 * Output: public/pwa-192.png, public/pwa-512.png, public/pwa-512-maskable.png,
 * public/apple-touch-icon.png — provenance: generated from favicon.svg art.
 */

import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "..", "public");
const cacheRoot = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(process.env.HOME ?? "/root", ".cache", "ms-playwright");

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const entry of readdirSync(cacheRoot)) {
    if (!entry.startsWith("chromium-")) continue;
    for (const arch of ["chrome-linux-arm64", "chrome-linux"]) {
      const candidate = join(cacheRoot, entry, arch, "chrome");
      try {
        readdirSync(join(cacheRoot, entry, arch));
        return candidate;
      } catch {
        /* try next */
      }
    }
  }
  throw new Error("No cached Playwright chromium found — install one or set CHROME_PATH.");
}

const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <rect x="0" y="0" width="24" height="24" rx="5" fill="#F3F2EE"/>
  <g stroke="#2D5DA8" stroke-width="1.1" opacity="0.55">
    <line x1="4.5" y1="17" x2="19.5" y2="17"/>
    <line x1="4.5" y1="20" x2="19.5" y2="20"/>
  </g>
  <path d="M4 12.6 C 6.4 6.6, 12.2 3.2, 20.2 3.4 C 16.6 5.2, 14.6 7.4, 13.2 10.4 C 10.4 10.2, 7 11.2, 4 12.6 Z" fill="#1C2430"/>
  <circle cx="17.6" cy="14.6" r="1.5" fill="#A83A32"/>
</svg>`;

const MARK_SQUARE = MARK.replace('rx="5"', 'rx="0"');

function htmlFor(w, h, scale) {
  return `<!doctype html><html><head><style>
    * { margin: 0; padding: 0; }
    body { width: ${w}px; height: ${h}px; background: transparent; }
    .target { width: ${w}px; height: ${h}px; }
    .target svg { width: 100%; height: 100%; display: block; }
  </style></head><body>
    <div class="target" style="transform-origin: 0 0; ${scale ? `transform: scale(${scale});` : ""}"></div>
  </body></html>`;
}

async function shoot(browser, { size, svg, background, padding = 0, out }) {
  const context = await browser.newContext({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.setContent(htmlFor(size, size, 1));
  const holder = await page.$(".target");
  await page.$eval(".target", (el, { svg, background, padding }) => {
    el.style.background = background;
    el.innerHTML = `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;padding:${padding}px;box-sizing:border-box;">${svg}</div>`;
  }, { svg, background, padding });
  await holder.screenshot({ path: join(publicDir, out), omitBackground: background === "transparent" });
  await context.close();
  console.log("wrote", out);
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? findChrome(),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  await shoot(browser, { size: 512, svg: MARK_SQUARE, background: "transparent", padding: 0, out: "pwa-512.png" });
  await shoot(browser, { size: 512, svg: MARK_SQUARE, background: "#10161E", padding: 96, out: "pwa-512-maskable.png" });
  // 192 is the same mark at its own viewport for crispness at size.
  await shoot(browser, { size: 192, svg: MARK_SQUARE, background: "transparent", padding: 0, out: "pwa-192.png" });
  await shoot(browser, { size: 180, svg: MARK, background: "#F3F2EE", padding: 0, out: "apple-touch-icon.png" });
} finally {
  await browser.close();
}
