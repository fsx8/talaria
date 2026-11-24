# Talaria — the unofficial Thunderbird web client (SPA)

Vue 3 + Vite + TypeScript (strict) + Tailwind CSS v4 + **daisyUI 5** + Pinia PWA.
Phases 2–4 of the build plan (`../tb-webclient-build-plan.md`): the skeleton, the
mail triage surface, and the breadth pass (threads, contacts, docked agenda, real
web push), served by the Phase-1 sidecar (`../app`, same-origin — no CORS).
Round 2 (2026-11-23) added the **theme system** (daisyUI semantic tokens, 37
themes incl. two Talaria identities), a **Settings page** (`/settings`), and the
**account-label mode** (email address / identity name — email is the default).

**License: MPL-2.0** (see `LICENSE`). Clean-room: no code from Bulwark, plMail or
MailFlow (all AGPL) — interface patterns only. daisyUI is MIT.

## Layout

```
src/
  api/          the interface seam (Bulwark pattern)
    types.ts               domain types (Account, Folder, MessageSummary, Contact…)
    backend-interface.ts   the MailBackend contract (+ optional PushBackend)
    real-backend.ts        tbweb sidecar: POST /api/tools/call + SSE /events + /push/*
    mock-backend.ts        seeded demo register (3 accounts, ~75 messages, threads,
                           contacts, calendars, tasks)
    index.ts               factory — VITE_BACKEND=mock|real
  theming.ts    theme registry: the two Talaria identities + all daisyUI built-ins,
                grouped (Talaria / Light / Dark / Colorful) with color-scheme metadata
  stores/       Pinia: settings (theme, account-label mode, density — localStorage),
                ui (views + /settings route sync), accounts (rail), mail
                (list+reader+threads), contacts, agenda (7-day events + open tasks)
  components/   TopBar (+ ThemeMenu dropdown, gear), SidebarPane (+ docked agenda
                widget), MessageListPane, MessageRow, ReaderPane (+ ThreadSection),
                ContactsView, AgendaView, AgendaWidget, PushControl, PhoneNav,
                ThemePicker + SettingsView (Appearance / About & status), IconGlyph
  composables/  format.ts (names, dates, sizes)
  style.css     daisyUI plugin + talaria-light/talaria-dark theme definitions,
                app tokens mapped onto semantic vars, shell layout, prose rules
public/         PWA assets + push-sw.js (SW push/notificationclick handlers,
                importScripts'd by the generated workbox sw.js)
scripts/        make-icons.mjs (PWA icons), screenshot.mjs, phase4-check.mjs,
                settings-check.mjs (Round-2 functional + visual proof)
```

## Theming (Round 2)

- All components speak **daisyUI semantic tokens** (`base-100/200/300`,
  `base-content`, `primary/secondary/accent`, `neutral`,
  `info/success/warning/error`) — no hand-rolled colors left, so every theme
  restyles the whole app with zero component changes.
- `talaria-light` / `talaria-dark` (registered via `@plugin "daisyui/theme"`)
  carry the Thunderbird-adjacent blue identity: primary `#0a6ce0` (light) /
  `#2f8bff` (dark) in the `#0a84ff` family, bright `#0a84ff` as the accent for
  masthead rule + unread marks, cool blue-paper grounds, and the old registrar
  red surviving only as `error`.
- The picker (ThemeMenu dropdown in the top bar + swatch grid on the Settings
  page) offers **system** plus all 37 themes, grouped Talaria / Light / Dark /
  Colorful, each entry annotated with its color-scheme. Selection persists in
  `localStorage["talaria.settings"]`, applies via `data-theme` on `<html>` with
  an anti-FOUC inline script in `index.html`; unset = OS preference onto the
  Talaria identity. The Round-1 `talaria.theme` key is migrated once.
- Unset stores default sensibly: label mode **email address** (identity names
  collide across accounts), density comfortable (`data-density="compact"`
  tightens register rows and hides previews).

## Settings page (`/settings`)

- **Appearance**: theme picker (live swatches render each theme's real tokens
  via nested `data-theme` scopes), account-label mode, list density.
- **About & status**: app version, sidecar/commonpost health (name, version,
  port), SSE/poll cadence, uptime, the read-only notice.
- Routed through history API (`pushState` + `popstate`) — the sidecar's SPA
  fallback serves `/settings` directly; no router dependency.

## Commands

```sh
npm install
npm run dev        # mock backend; proxies /api,/events → http://thunderbird:8942
                   #   (override the proxy target with TBWEB_ORIGIN=http://host:port)
npm run build      # vue-tsc --noEmit && vite build → ../app/public (deployed in place)
npm run icons      # regenerate the PWA PNGs from the authored mark
npm run shots      # Playwright screenshots (dev server must be running)
```

## Backend modes

- `VITE_BACKEND=mock` (default in dev): the in-memory demo register — three
  accounts, realistic senders/subjects, working search operators, and two
  scheduled "arrivals" that fire the same `mail` event the real sidecar sends,
  so the live folio flip is demoable offline. The UI labels mock sessions
  "Demo data".
- `VITE_BACKEND=real` (default in production builds): the tbweb sidecar,
  same-origin. `POST /api/tools/call` for tools, `GET /events` for live
  unread changes, `GET /api/health` for the status dot in the rail footer.

## Honest limitations (drafts, not send)

- The write tiers: **W1 organize** (read/unread, flag, move, folder creation) and
  **W2 drafts** (compose, reply, reply-all, forward — every path saves into the
  identity's Drafts folder). `sendMail` is disabled server-side and the UI has no
  send affordance anywhere; sending happens in Thunderbird or on the phone.
  The add-on's skipReview block additionally refuses direct send behind the
  reply/forward tools. The posture chip in the top bar states the active tier.
- Forward drafts are composed **client-side** (quoted original from the reader's
  sanitized body; attachments are not copied — Thunderbird does that on send).
  The add-on's native `forwardMessage mode:"draft"` hangs on IMAP in this
  environment (observed 2026-11-24; the seam keeps `forwardDraft` for when the
  add-on fixes it upstream).
- Attachment downloads stay in Thunderbird; the reader lists attachments only.
- Remote images in bodies are stripped (DOMPurify) — no tracking pixels over
  Access; per-message "Load images" consent plus the Settings → Privacy switches.
- Per-row attachment indicators are **cache-derived** (Phase 4): rows show a
  paperclip once a full record for that message passed through a cache
  (opened, preloaded, or thread batch) — unknown rows show nothing.
- Threads: the register page stays flat (no grouping); the conversation
  renders inside the reader (`searchMessages {threadOf}` + `getMessages`
  batch). `threadOf` needs the message's own folderPath — details always
  pair with their summary.
- Web push needs HTTPS (secure context): the production origin behind
  Cloudflare Access qualifies; on the plain-http compose hostname the bell
  stays inert and tooltips say why. Subscriptions are stored server-side
  under `../app/data/` (gitignored; reset on `--force-recreate`).
- Calendar colors are not exposed by the API — agenda chips use a stable
  per-calendar hue from the account palette (legend on the agenda page).
