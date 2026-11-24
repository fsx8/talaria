# AGENTS.md — Talaria (unofficial Thunderbird web client)

Working rules for agents and humans in this repo. Companion docs: `README.md`
(project + self-hosting), `DESIGN.md` (the design contract), `CONTRIBUTING.md`
(conventions + clean-room rule). A local, untracked `HANDOVER.md` may hold
private ops notes for the maintainer's own deployment — it is intentionally
**not** part of the repository.

## What this is

A webmail UI for Thunderbird, built on the
[commonpost/thunderbird-mcp](https://github.com/commonpost/thunderbird-mcp)
experiment-API addon: browser SPA (`spa/`, Vue 3 + TS strict + Tailwind v4 +
daisyUI 5 + Pinia) → `sidecar/` (Fastify: static hosting, JSON-RPC proxy with
port failover + Bearer + bridge header, SSE hub with 60 s unread poll, VAPID
web push) → commonpost addon inside the Thunderbird container (loopback
:8780, stable token) → the user's IMAP accounts. Email credentials never
leave Thunderbird.

## Deployment model

- The sidecar is a small Node 22 service that shares the Thunderbird
  container's network namespace (`network_mode: service:thunderbird` in
  compose) so the addon stays loopback-only. See
  `sidecar/compose.example.yaml` for the shape.
- The SPA build target is `spa/vite.config.ts` → `outDir: ../sidecar/public`;
  the sidecar serves that dir. **Deploy SPA = `npm run build` in `spa/`**
  (no container action). **Deploy sidecar source = recreate the container**
  (it copies `/app` → `/tmp/app` at boot, so source changes need the
  recreate; `public/` changes go live immediately when bind-mounted).
- After any **Thunderbird container restart**: recreate the addon sidecar
  AND the tbweb sidecar — a plain container `restart` re-attaches the TB
  netns and the shared-netns services die.

## Verification discipline (every change)

`npx vue-tsc --noEmit` → `vite build` → deploy → real-mode checks against
your sidecar (accounts render, list + reader work) → regression harnesses in
`spa/scripts/`:

- **Mock (offline, authored demo data, `VITE_BACKEND=mock`, dev server on
  :5173 / :5174):** `settings-check.mjs`, `stage2-mock-check.mjs`,
  `w1-mock-check.mjs`, `stage3-mock-check.mjs`, `phase4-check.mjs MODE=mock`.
- **Real (against the live sidecar):** `real-check.mjs` (read-only smoke),
  `settings-check.mjs`, `w1-check.mjs`, `stage2-check.mjs`,
  `stage3-check.mjs` (writes drafts — slow on rate-limiting providers),
  `phase4-check.mjs MODE=real`.

Playwright screenshots go to `docs/screenshots/<phase>/` — **never commit
`real-*` screenshots or anything showing your real mailbox** (gitignored,
kept that way). Mock-mode shots are the only publishable ones.

## Security posture — do not weaken

- The addon's write-tool gate lives in the TB profile's `user.js`
  (`extensions.commonpost-mcp.disabledTools`, JSON array with `\"` escaping;
  applies at TB start). **Enabled: `updateMessage`, `createFolder`,
  `applyFilters`, `saveDraft`, `replyToMessage`, `forwardMessage`. Disabled:
  `sendMail`, all deletions (`deleteMessages`/`emptyTrash`/`emptyJunk`/
  `deleteFolder`), folder rename/move, filter/contact/calendar/task writes,
  `displayMessage`.**
- **`sendMail` must never be enabled** — Talaria composes drafts only;
  sending happens in Thunderbird or on the phone. The composer has no Send
  button (asserted in tests).
- `COMMONPOST_MCP_TOKEN` (stable token, 64-hex) lives in your compose
  `.env` + the TB profile pref — **never print, never commit, never embed in
  the SPA**. Real account URIs/addresses never get committed either — the
  real-mode harnesses discover them at runtime.
- The sidecar has no user auth: your authenticating proxy is the gate. Keep
  it that way (or add explicit auth as a deliberate feature), never bind it
  to a public interface.
- Remote images in bodies are stripped by default; per-message "Load images"
  consent only.
- Clean-room rule: **no AGPL code** from Bulwark/plMail/MailFlow (patterns +
  screenshots-as-inspiration are fine). MPL-2.0 project license (stormbox
  component reuse is MPL-clean).

## Design language

"The Registrar" — the mailbox as a bound register you consult, never amend
(that's why read-only was the natural first posture). Light = day register
(cool paper, iron ink, blue rulings only between data rows, red reserved for
masthead rule + unread); dark = night register. Agate tabular meta columns,
record-sheet reader/composer sheets, per-account hue chips. Contract:
`DESIGN.md`; tokens and rules live in `spa/src/style.css`. Use the
`impeccable` skill for any UI work.

## Known gotchas (verified — don't rediscover)

- **No change feed** in the addon: SSE is 60 s poll-based. The change
  journal (`getChangesSince`/`waitForNewMail`, MIT, from
  StefanoSalsano/thunderbird-mcp-rag) is the planned upgrade — port it
  addon-side, wrap as SSE in the sidecar, keep the SPA contract.
- **`forwardMessage mode:"draft"` hangs on IMAP** (commonpost v0.26.1) and
  then jams TB's compose service — Talaria composes forwards client-side via
  `saveDraft`; do not call it.
- **Addon is stateless**: `initialize` does not gate `tools/call`; treat
  `success:true` as "accepted", never durable — read back before trusting
  (IMAP moves settle async under new message ids; drafts APPEND slowly,
  rate-limiting providers need minutes).
- `searchMessages` rows carry no `folderPath`-safe `getMessage` pairing:
  details always need the summary's folderPath (`threadOf` is
  folder-anchored). The `fields` param is load-bearing; `bodyFormat:"html"`
  is required to keep images in bodies (markdown mode silently drops them);
  `<email-content>` wrappers must be stripped in mappers.
- Typed queries walk the full corpus (~2.5 s) — debounce 300 ms and prefer
  scoped/date-bounded queries (the 14-day `startDate` boot query is
  ~145 ms). The sidecar cache key depends on **hour-floored** `startDate` —
  keep `real-backend.ts` and sidecar `recentQueryArgs()` in sync.
- The first register row may be a draft entry: clicking it opens the
  composer, not the reader (by design — harnesses must not assume row 1 is
  a mail).
- `sidebarPane`'s account entries show email addresses per the
  `accountLabel` setting ("identity" is opt-in) — with many accounts on one
  identity name, email mode is the disambiguator.

## Repo conventions

- MPL-2.0; clean-room rule above; `real-*` screenshots and real mailbox
  data never leave the machine (gitignored).
- `origin` is the **public** repository. Anything committed here is
  published: no real hostnames, account addresses, tokens, or mailbox
  content. Private ops notes belong in untracked local files.
- `docs/screenshots/` subdirectories are harness output (gitignored); the
  curated public shots live directly in `docs/screenshots/`.
- If you also keep a private infrastructure/compose repo, cross-repo facts
  are duplicated intentionally — update both sides when they change.
