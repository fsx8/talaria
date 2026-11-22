/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Push + notification-click handlers for Talaria's service worker.
 *
 * This file is importScripts'd by the workbox-generated sw.js (see
 * vite.config.ts → workbox.importScripts), keeping push concerns apart from
 * the precache manifest. Payload contract (tbweb sidecar, POST /push/subscribe
 * store + SSE fan-out): `{ unread: number, ts: string, test?: boolean }`.
 */

self.addEventListener("push", (event) => {
  let payload = { unread: null, ts: "", test: false };
  try {
    payload = event.data ? event.data.json() : payload;
  } catch {
    /* a malformed payload still deserves a visible notification */
  }
  const unread = typeof payload.unread === "number" ? payload.unread : null;
  const title = unread !== null && unread > 0 ? `Talaria — ${unread} unread` : "Talaria";
  const body =
    unread !== null && unread > 0
      ? payload.test
        ? `${unread} unread in the register — test notification`
        : "New mail arrived in the register"
      : payload.test
        ? "Test notification — the register is current"
        : "The register was updated";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: "talaria-mail",
      renotify: true,
      data: { unread: payload.unread, ts: payload.ts, test: !!payload.test },
      // Icon paths are served from the app root (same directory as sw.js).
      icon: "pwa-192.png",
      badge: "pwa-192.png",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow("/");
    })(),
  );
});
