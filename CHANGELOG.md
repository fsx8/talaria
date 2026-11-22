# Changelog

## v0.1.0 (2026-11-22)

Initial release — alpha, works on our machine.

- Read-only PWA webmail UI (Vue 3 + TypeScript, MPL-2.0): unified inbox across accounts,
  virtualized list, sanitized reader with SPF/DKIM/DMARC seals, threads, contacts,
  docked agenda, dark/light/system themes.
- Fastify sidecar: commonpost JSON-RPC proxy (port failover, bridge header), SSE
  live events (60 s unread poll), web push (VAPID), static hosting with SPA fallback.
- Backend: the commonpost MCP addon for Thunderbird (stable token, ESR 140+).
  Read-only posture: write tools must stay disabled in the addon config.
