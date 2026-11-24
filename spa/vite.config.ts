import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// Same-origin deploy: the tbweb sidecar (sidecar) serves the built
// SPA from ../sidecar/public and answers /api/* + /events itself. In dev we proxy
// those to a reachable sidecar (default http://thunderbird:8942, reachable
// from the compose_default network; override with TBWEB_ORIGIN).
const sidecarOrigin = process.env.TBWEB_ORIGIN ?? "http://thunderbird:8942";
const pkgVersion: string = (JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string }).version;

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Talaria",
        short_name: "Talaria",
        description:
          "Register view of your Thunderbird mail — read, search and organize from desk or phone.",
        lang: "en",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "any",
        background_color: "#f2f6fa",
        theme_color: "#f2f6fa",
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "pwa-512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Precache the app shell; never intercept the API or the SSE stream.
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/events$/, /^\/health$/, /^\/push\//],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        // Push + notification-click handlers live outside the generated
        // manifest (public/push-sw.js) so the workbox config stays plain.
        importScripts: ["/push-sw.js"],
      },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkgVersion),
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: sidecarOrigin, changeOrigin: true },
      "/health": { target: sidecarOrigin, changeOrigin: true },
      "/events": { target: sidecarOrigin, changeOrigin: true, timeout: 0 },
    },
  },
  build: {
    // Deployed in place: the sidecar bind-mounts sidecar/public
    // read-only and serves it immediately — no container restart needed.
    outDir: "../sidecar/public",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
  },
});
