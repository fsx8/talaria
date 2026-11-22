# Talaria

**An unofficial web client for Thunderbird.** A read-only PWA webmail UI on
top of the [commonpost](https://github.com/commonpost/thunderbird-mcp) MCP
addon: your mail, natively rendered in any browser, on desktop and phone.

Talaria is for people who run Thunderbird as their mail hub and want to
triage it from anywhere — the same folders, threads and contacts, but as a
fast web app instead of a remote-desktop session. It reads; it never writes.
Nothing you see here can move, flag, or send a message — the write tools are
disabled server-side, and the UI has no affordances for them at all.

| Desktop (1440×900) | Phone — list | Phone — reader |
| --- | --- | --- |
| ![Desktop](docs/screenshots/desktop.png) | ![Mobile list](docs/screenshots/mobile-list.png) | ![Mobile reader](docs/screenshots/mobile-reader.png) |

*(Screenshots use the built-in demo backend — all data shown is fictional.)*

## How it works

```
browser (Talaria PWA)
   │ HTTPS, behind your authenticating proxy
   ▼
sidecar  (Node 22 + Fastify, this repo: sidecar/)
   │  serves the built SPA + PWA assets
   │  POST /api/tools/call  — JSON-RPC proxy to the addon (token stays here)
   │  GET  /events          — SSE: unread-count changes (polling, 60 s)
   │  POST /push/*          — VAPID web push for new mail
   ▼ HTTP, loopback / private network only
Thunderbird (desktop) + commonpost addon
   │  the addon's experiment-API server: search, threads, contacts, calendar
   ▼
your IMAP / SMTP accounts — exactly as Thunderbird sees them
```

Thunderbird stays the backend: its folders, its filters, its indexes, its
credentials. Talaria renders what the commonpost addon exposes — nothing
more, nothing less. The SPA also ships an in-memory **demo backend** with
fictional data, so you can develop and demo the whole UI without a
Thunderbird anywhere near it (`VITE_BACKEND=mock`).

## Prerequisites

- **Thunderbird 140 ESR or newer** — the addon is an unsigned experiment
  addon; ESR pinning is the supported posture.
- **commonpost v0.26.1 or newer** with the HTTP server enabled and a
  **stable token** configured (addon preference
  `extensions.commonpost-mcp.stableAuthToken`). See the addon's README:
  <https://github.com/commonpost/thunderbird-mcp>
- **Node.js 22** for the sidecar, and for building the SPA.
- An authenticating reverse proxy in front of the sidecar — Cloudflare
  Access, Authelia, oauth2-proxy, or a private network you trust. The
  sidecar has **no application-level authentication** by design.

## Quickstart

```sh
# 1. Build the SPA (writes straight into sidecar/public/)
cd spa
npm ci
npm run build

# 2. Run the sidecar
cd ../sidecar
npm ci
COMMONPOST_MCP_TOKEN=<the addon's stable token> \
TBWEB_VAPID_PUBLIC_KEY=<public key> \
TBWEB_VAPID_PRIVATE_KEY=<private key> \
npm start                                # listens on 0.0.0.0:8942
```

Generate the VAPID keys once with `npx web-push generate-vapid-keys`
(optional — web push is disabled without them). Then put the sidecar behind
your authenticating proxy and open it from a desktop or phone browser.

Environment contract (all sidecar env vars documented in
[`sidecar/README.md`](sidecar/README.md)):

| Var | Meaning |
| --- | --- |
| `COMMONPOST_MCP_TOKEN` | **required** — the addon's stable token; the sidecar refuses to start without it |
| `TBWEB_VAPID_PUBLIC_KEY` / `TBWEB_VAPID_PRIVATE_KEY` | VAPID identity for web push (private key never leaves the process) |
| `PORT` | listen port (default `8942`) |
| `COMMONPOST_PORTS` | addon probe/failover range (default `8780-8789`) |

`sidecar/compose.example.yaml` shows a container-ready shape.

## Features

- **Unified view across accounts** — all accounts in one rail, all folders
  with unread tallies, one live unread folio.
- **Search operators** — `from:`, `to:`, `cc:`, `subject:`,
  `participant:@domain`, plus free text; unread/flagged filter toggles.
- **Threads** — the conversation renders in the reader
  (cross-folder via `threadOf`), with per-message SPF/DKIM/DMARC seal pills.
- **Contacts** — address-book search, paged results, contact cards.
- **Agenda** — docked "next 7 days" rail widget plus a full agenda page
  (calendars, expanded recurring events, open tasks badge).
- **Web push** — self-hosted VAPID notifications on unread-count change; no
  third-party push service configuration beyond the browser vendors'.
- **PWA** — installable, offline app shell, standalone on phone home
  screens.
- **Themes** — light / dark / system with a pre-paint resolver (no flash),
  responsive from 3-pane desktop down to stacked phone layout with bottom
  nav.
- **Virtualized message list** — smooth on five-digit-folder corpora;
  paginate or load more.

## Security notes

- **Expose the sidecar only behind an authenticating proxy.** There is no
  application-level auth; the design assumes the proxy is the gate.
- **The commonpost token never reaches the browser.** It lives in the
  sidecar process and is attached to upstream calls server-side.
- **Read-only posture.** Every write tool is disabled in the addon config;
  the UI shows no compose/send/move/flag/delete affordances. Attachment
  downloads stay in Thunderbird — the reader lists attachments only.
- **Remote images in bodies are stripped** (DOMPurify) — no tracking pixels
  on your readers. A consent-gated loader is future scope.
- Keep the addon's HTTP server off public interfaces; the sidecar should be
  the only reachable hop, and the addon itself refuses public listen
  addresses.

## Roadmap

- **Lower-latency live events** — SSE is currently fed by a 60 s unread
  poll; porting the community change-journal approach would cut delivery to
  seconds without touching the frontend contract (SSE stays).
- **Send support** when/where the addon enables write tools — compose and
  send are deliberately absent until then.
- Attachment downloads, consent-gated remote-image loading, per-row
  attachment flags in list responses, thread grouping in the list pane —
  small, known gaps tracked as the addon surface grows.

## Status: alpha, works on our machine

This is a young single-maintainer project, built against one real
deployment. It works there, on desktop and phone, but treat it as an alpha:
API surface = whatever the commonpost addon exposes, behavior may change,
and there are certainly rough edges. Issues and PRs are welcome — see
[CONTRIBUTING.md](CONTRIBUTING.md).

## Acknowledgements

- **[commonpost/thunderbird-mcp](https://github.com/commonpost/thunderbird-mcp)**
  — the backend addon this whole thing stands on, and the community
  continuation of TKasperczyk's thunderbird-mcp.
- **[thunderbird/stormbox](https://github.com/thunderbird/stormbox)** —
  Mozilla's own Thundermail webmail; a design-language reference (no code
  reused).
- UX and architecture patterns studied (observation, not copying) from
  **Bulwark**, **plMail**, **Gofer** and **root-fr/jmap-webmail** — the
  client/server interface seam in `spa/src/api/` follows the Bulwark
  pattern.

## License & trademark notice

[MPL-2.0](LICENSE) — file-level copyleft, Mozilla-native.

**Talaria is an independent project. It is not affiliated with, endorsed by,
or connected to Mozilla, the Thunderbird project, or the commonpost
project. "Thunderbird" and the Thunderbird logos are trademarks of the
Mozilla Foundation; "Talaria" is an unofficial fan-made client and does not
claim any association with them.**
