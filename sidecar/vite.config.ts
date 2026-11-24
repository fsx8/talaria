import { defineConfig } from 'vite-plus';

// Vite+ toolchain for the sidecar (`vp lint` / `vp fmt` / `vp check`).
// The sidecar is plain Node JS with JSDoc types — no tsconfig — so the
// type-aware lint layer stays off; `vp check` runs format (Oxfmt) + lint
// (Oxlint). Formatting matches the hand-written style: single quotes,
// ~100 columns, semicolons.
export default defineConfig({
  lint: {
    plugins: ['node', 'unicorn'],
    ignorePatterns: ['public/**', 'data/**'],
    overrides: [
      {
        // The service logs through console by design (no logger for
        // startup/telemetry lines; Fastify handles request logging).
        files: ['src/**'],
        env: { node: true },
        rules: {
          'no-console': 'off',
        },
      },
    ],
  },
  fmt: {
    singleQuote: true,
    printWidth: 100,
    ignorePatterns: ['public/**', 'data/**'],
  },
});
