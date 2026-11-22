import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// Same-origin deploy: the sidecar (../sidecar) serves the built SPA from
// sidecar/public and answers /api/* + /events itself. In dev we proxy
// those to a reachable sidecar (default http://thunderbird:8942 — the
// docker service name; override with TBWEB_ORIGIN).
const sidecarOrigin = process.env.TBWEB_ORIGIN ?? "http://thunderbird:8942";

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
          "Read-only register view of your Thunderbird mail — triage from desk or phone.",
        lang: "en",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "any",
        background_color: "#f3f2ee",
        theme_color: "#f3f2ee",
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
  server: {
    port: 5173,
    proxy: {
      "/api": { target: sidecarOrigin, changeOrigin: true },
      "/health": { target: sidecarOrigin, changeOrigin: true },
      "/events": { target: sidecarOrigin, changeOrigin: true, timeout: 0 },
    },
  },
  build: {
    // Built straight into the sidecar's static root, so a plain `npm run
    // build` refreshes a running sidecar that bind-mounts this directory.
    outDir: "../sidecar/public",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
  },
});
