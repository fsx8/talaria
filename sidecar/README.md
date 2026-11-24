# talaria — the sidecar

A small Node 22 service (Fastify, two dependencies) that sits between the PWA
and Thunderbird: it serves the built SPA, reverse-proxies the commonpost
add-on's JSON-RPC API, streams live unread events over SSE, and sends web
push notifications. It is deliberately tiny — stateless proxying plus a
subscription file — because Thunderbird itself (via the commonpost addon) is
the backend.

```
browser ──HTTPS──▶ authenticating proxy ──▶ sidecar ──HTTP(loopback)──▶ Thunderbird + commonpost
                                              │
                                              └── data/push-subscriptions.json (web push)
```

## Routes

| Route | Purpose |
| --- | --- |
| `GET /health` (alias `GET /api/health`) | `{ok, commonpost:{reachable, port, serverInfo}, uptime}` — probes the commonpost add-on with an MCP `initialize` |
| `POST /api/tools/call` | body `{name, arguments}` → JSON-RPC `tools/call`; answers `{ok:true, data:<parsed>}` or `{ok:false, error}`. Port failover + re-probe on network errors and 403. Tool-level failures (bad args, disabled tool) are valid proxied answers → HTTP 200 `ok:false`; unreachable upstream → HTTP 502 |
| `POST /api/tools/list` | JSON-RPC `tools/list` passthrough (same envelope) |
| `GET /events` | SSE: `hello` on connect (current unread), heartbeat comment every 15 s, `event: mail` whenever the unread count changes (60 s polling MVP) |
| `GET /push/public-key` | `{ok, publicKey}` — the VAPID **public** key for `pushManager.subscribe`, or `publicKey: null` when push is unconfigured |
| `POST /push/subscribe` | body = a PushSubscription JSON (`{endpoint, keys:{p256dh, auth}}`); stored deduped-by-endpoint in `data/push-subscriptions.json` → `{ok, stored}` |
| `POST /push/unsubscribe` | body `{endpoint}` — drops the record (browser unsubscribes itself first) |
| `POST /push/test` | sends `{unread, ts, test:true}` to every stored subscription, prunes 404/410 → `{ok, sent, pruned, failed}` |
| `GET /*` | static files from `public/` (the SPA build), extension-less paths fall back to `index.html` |

## Web push

Generate VAPID keys once (`npx web-push generate-vapid-keys`) and pass them
via `TALARIA_VAPID_PUBLIC_KEY` / `TALARIA_VAPID_PRIVATE_KEY`. The **private key
lives only in this process**; the SPA fetches the public key from
`/push/public-key`. Every unread-count change (the SSE `mail` poll) also fans
a `{unread, ts}` payload out to all stored subscriptions; gone subscriptions
(push service answers 404/410) are pruned automatically. Subscriptions live
in `data/push-subscriptions.json` (gitignored) — point `TALARIA_PUSH_DB` at a
persistent volume if they should survive container recreation.

## Security model

**No application-level authentication, by design.** Put an authenticating
reverse proxy in front of it — Cloudflare Access, Authelia, oauth2-proxy, a
tailnet-only bind, or whatever your setup uses. The sidecar itself only
speaks HTTP. The `COMMONPOST_MCP_TOKEN` lives in this process only (env), is
attached server-side to every upstream call, and is never sent to the
browser. The sidecar refuses to start when the token env is empty
(fail-closed). Static serving contains traversal/null-byte guards and never
SPA-falls-back for `/api/*` or `/push/*`.

## Upstream protocol notes (why the code looks like this)

- The commonpost addon serves JSON-RPC 2.0 on a **single endpoint**
  `POST /`; Bearer token required on every request (wrong → HTTP 403,
  error code -32600).
- The server is **stateless**: `initialize` is answered per request and does
  not gate `tools/call` (checked against commonpost v0.26.1 source,
  `extension/mcp_server/api.js`). We initialize anyway for `/health`'s
  serverInfo and protocol negotiation.
- `X-Commonpost-Bridge: "<X.Y.Z>; packaging=file"` must mirror the current
  mcp-bridge release (v0.26.1 ships bridge 0.20.0, MIN 0.17.1). Sending the
  current version prevents the add-on from appending a "bridge outdated"
  notice as a trailing `content` item — the response parser tolerates one
  anyway (parses `content[0].text`, ignores trailing text items).
- Unread probe (SSE poller): `searchMessages {query:"", unreadOnly:true,
  countOnly:true, maxResults:1}` — headers only, one integer back. Override
  with `TALARIA_POLL_CALL` (JSON, e.g. to scope to a `folderPath`).

## Environment

| Var | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8942` | listen port |
| `HOST` | `0.0.0.0` | listen host |
| `COMMONPOST_MCP_TOKEN` | — | **required**; Bearer token for the add-on |
| `COMMONPOST_PORTS` | `8780-8789` | probe/failover range |
| `TALARIA_BRIDGE_HEADER` | `0.20.0; packaging=file` | bridge-version header value |
| `TALARIA_MCP_PROTOCOL` | `2025-06-18` | MCP protocolVersion offered |
| `SSE_HEARTBEAT_MS` / `SSE_POLL_MS` | `15000` / `60000` | SSE timers |
| `TALARIA_POLL_CALL` | unread probe above | full `{name, arguments}` override |
| `TALARIA_PUBLIC_DIR` | `./public` | static root (point at a bind-mounted SPA build to deploy by rebuild) |
| `TALARIA_VAPID_PUBLIC_KEY` / `TALARIA_VAPID_PRIVATE_KEY` | — (push disabled without them) | VAPID identity for web-push |
| `TALARIA_PUSH_SUBJECT` | `mailto:admin@example.com` | contact string carried in VAPID claims |
| `TALARIA_PUSH_DB` | `<app dir>/data/push-subscriptions.json` | subscription store (gitignored) |
| `HEALTH_CACHE_MS`, `RPC_TIMEOUT_MS`, `BODY_LIMIT`, `LOG_LEVEL` | `5000`, `20000`, `8 MiB`, `info` | tuning |

## Run

```sh
COMMONPOST_MCP_TOKEN=… npm start          # http://0.0.0.0:8942, serves public/
```

See `compose.example.yaml` for a container-ready example, and the repository
README for the full setup (addon install + SPA build).
