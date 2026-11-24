import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

// Unit + component tests: the logic-level layer of the regression net.
// (The Playwright harnesses in scripts/ cover what a DOM emulation cannot:
// real layout numerics, downloads, full keyboard cascades — see
// CONTRIBUTING.md "Verification discipline".)
export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "happy-dom",
    include: ["tests/**/*.spec.ts"],
    setupFiles: ["tests/setup.ts"],
  },
});
