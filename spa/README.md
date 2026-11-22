# Talaria SPA

Vue 3 + Vite + TypeScript (strict) + Tailwind CSS v4 + Pinia PWA — the web
client itself. It talks to the **sidecar** (`../sidecar`, same-origin — no
CORS) and ships with an in-memory demo backend so the whole UI runs without a
Thunderbird behind it.

**License: MPL-2.0** (see `../LICENSE`). Clean-room: no code from Bulwark,
plMail or MailFlow (all AGPL) — interface patterns only.

## Layout

```
src/
  api/          the interface seam
    types.ts               domain types (Account, Folder, MessageSummary, Contact…)
    backend-interface.ts   the MailBackend contract (+ optional PushBackend)
    real-backend.ts        sidecar: POST /api/tools/call + SSE /events + /push/*
    mock-backend.ts        seeded demo register (3 accounts, ~70 messages, threads,
                           contacts, calendars, tasks — all fictional)
    index.ts               factory — VITE_BACKEND=mock|real
  stores/       Pinia: ui (theme/views), accounts (rail), mail (list+reader+threads),
                contacts, agenda (7-day events + open tasks)
  components/   TopBar, SidebarPane (+ docked agenda widget), MessageListPane,
                MessageRow, ReaderPane (+ ThreadSection), ContactsView, AgendaView,
                AgendaWidget, PushControl, PhoneNav, ThemeMenu, IconGlyph
  composables/  format.ts (names, dates, sizes)
  style.css     design tokens (day/night register), shell layout, prose rules
public/         PWA assets + push-sw.js (SW push/notificationclick handlers,
                importScripts'd by the generated workbox sw.js)
scripts/        make-icons.mjs (PWA icons), screenshot.mjs + phase4-check.mjs
                (Playwright functional + visual checks)
```

## Commands

```sh
npm install
npm run dev        # mock backend; proxies /api,/events → http://thunderbird:8942
                   #   (override the proxy target with TBWEB_ORIGIN=http://host:port)
npm run build      # vue-tsc --noEmit && vite build → ../sidecar/public
npm run icons      # regenerate the PWA PNGs from the authored mark
npm run shots      # Playwright screenshots (dev server must be running)
```

`npm run build` writes straight into the sidecar's static root — if your
deployment bind-mounts that directory, the new build is served without
restarting anything.

## Backend modes

- `VITE_BACKEND=mock` (default in dev): the in-memory demo register — three
  accounts, fictional senders/subjects, working search operators, and two
  scheduled "arrivals" that fire the same `mail` event the real sidecar sends,
  so the live folio flip is demoable offline. The UI labels mock sessions
  "Demo data".
- `VITE_BACKEND=real` (default in production builds): the sidecar,
  same-origin. `POST /api/tools/call` for tools, `GET /events` for live
  unread changes, `GET /api/health` for the status dot in the rail footer.

## Honest limitations (read-only by design)

- Every write tool is disabled server-side; the UI shows **no** compose, send,
  move, flag or delete affordances — only the "read-only view" chip.
- Attachment downloads stay in Thunderbird; the reader lists attachments only.
- Remote images in bodies are stripped (DOMPurify) — no tracking pixels. A
  consent-gated loader remains future scope.
- Per-row attachment indicators are **cache-derived**: rows show a paperclip
  once a full record for that message passed through a cache (opened,
  preloaded, or thread batch) — unknown rows show nothing.
- Threads: the list page stays flat (no grouping); the conversation renders
  inside the reader (`searchMessages {threadOf}` + `getMessages` batch).
  `threadOf` needs the message's own folderPath — details always pair with
  their summary.
- Web push needs HTTPS (a secure context): behind an authenticating HTTPS
  proxy it works; on plain http the bell stays inert and tooltips say why.
  Subscriptions are stored server-side under `../sidecar/data/` (gitignored;
  put `TBWEB_PUSH_DB` on a persistent volume to survive recreations).
- Calendar colors are not exposed by the API — agenda chips use a stable
  per-calendar hue from the account palette (legend on the agenda page).
