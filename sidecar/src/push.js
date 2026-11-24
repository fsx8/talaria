#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * tbweb — web-push (VAPID) for the Talaria PWA, Phase 4.
 *
 * Holds the VAPID identity (keys arrive via compose env, never exposed beyond
 * `GET /push/public-key`, which only ever answers with the PUBLIC key), keeps
 * browser push subscriptions in a small JSON file, and fans `event: mail`
 * changes out to every stored subscription via the `web-push` library.
 *
 * Delivery model:
 *   - Subscriptions are stored under `<app dir>/data/push-subscriptions.json`
 *     (gitignored; override with TBWEB_PUSH_DB). In the deployed container the
 *     app runs from its writable /tmp copy, so the default path lands there —
 *     subscriptions are ephemeral across `--force-recreate` recreates, which
 *     is acceptable: the browser keeps its subscription and re-enabling is a
 *     one-click action.
 *   - A push service answering 404/410 means the subscription is gone
 *     (browser expired it, permission revoked, site unregistered) — the
 *     subscription is pruned on sight. Any other failure is logged and kept.
 *   - No keys configured (TBWEB_VAPID_* empty) => every route degrades to an
 *     explicit "not configured" answer and nothing else changes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import webpush from 'web-push';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = process.env.TBWEB_PUSH_DB ?? path.join(APP_ROOT, 'data', 'push-subscriptions.json');
const PUBLIC_KEY = process.env.TBWEB_VAPID_PUBLIC_KEY ?? '';
const PRIVATE_KEY = process.env.TBWEB_VAPID_PRIVATE_KEY ?? '';
/** Contact string push services attach to the VAPID claims. */
const SUBJECT = process.env.TBWEB_PUSH_SUBJECT ?? 'mailto:admin@example.com';

let configured = false;

/** Eagerly called at startup; logs once. */
export function initPush() {
  if (PUBLIC_KEY && PRIVATE_KEY) {
    try {
      webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
      configured = true;
      console.log('[tbweb] web-push configured (VAPID key present)');
    } catch (err) {
      console.error(`[tbweb] web-push setup failed: ${err?.message ?? err}`);
    }
  } else {
    console.warn('[tbweb] web-push disabled — TBWEB_VAPID_PUBLIC_KEY/PRIVATE_KEY not set');
  }
}

export function isConfigured() {
  return configured;
}

export function getPublicKey() {
  return configured ? PUBLIC_KEY : null;
}

/* ------------------------------------------------------------------ */
/* subscription store (small JSON file)                                */
/* ------------------------------------------------------------------ */

/** @returns {Array<{endpoint: string, keys: {p256dh: string, auth: string}, addedAt?: string}>} */
function loadSubscriptions() {
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(validSubscription) : [];
  } catch {
    return []; // missing/corrupt file == empty store; first write recreates it
  }
}

function saveSubscriptions(list) {
  try {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const tmp = `${DB_PATH}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(list, null, 1)}\n`);
    fs.renameSync(tmp, DB_PATH);
  } catch (err) {
    console.error(`[tbweb] push store write failed (${DB_PATH}): ${err?.message ?? err}`);
  }
}

/** @param {any} sub */
function validSubscription(sub) {
  return (
    sub &&
    typeof sub.endpoint === 'string' &&
    sub.endpoint.startsWith('https://') &&
    sub.keys &&
    typeof sub.keys.p256dh === 'string' &&
    typeof sub.keys.auth === 'string'
  );
}

/**
 * Validate + store a subscription (deduped by endpoint; re-subscribes refresh
 * the keys — browsers rotate them).
 * @param {any} body
 * @returns {{ok: true} | {ok: false, error: string}}
 */
export function addSubscription(body) {
  if (!configured) return { ok: false, error: 'web-push is not configured on this sidecar' };
  if (!validSubscription(body)) {
    return { ok: false, error: 'body must be a PushSubscription JSON: {endpoint, keys:{p256dh, auth}}' };
  }
  const list = loadSubscriptions().filter((s) => s.endpoint !== body.endpoint);
  list.push({
    endpoint: body.endpoint,
    keys: { p256dh: body.keys.p256dh, auth: body.keys.auth },
    addedAt: new Date().toISOString(),
  });
  saveSubscriptions(list);
  console.log(`[tbweb] push subscription stored (${list.length} total)`);
  return { ok: true };
}

/** @param {string | undefined} endpoint */
export function removeSubscription(endpoint) {
  if (typeof endpoint !== 'string' || !endpoint) {
    return { ok: false, error: 'body must be {endpoint: string}' };
  }
  const before = loadSubscriptions();
  const after = before.filter((s) => s.endpoint !== endpoint);
  saveSubscriptions(after);
  return { ok: true, removed: before.length - after.length };
}

export function subscriptionCount() {
  return loadSubscriptions().length;
}

/* ------------------------------------------------------------------ */
/* fan-out                                                             */
/* ------------------------------------------------------------------ */

/**
 * Send `payload` to every stored subscription, pruning gone ones (404/410).
 * Never throws — push must not take the SSE path down with it.
 * @param {{unread: number|null, ts: string, test?: boolean}} payload
 * @returns {Promise<{sent: number, pruned: number, failed: number, skipped?: string}>}
 */
export async function notifyAll(payload) {
  if (!configured) return { sent: 0, pruned: 0, failed: 0, skipped: 'not configured' };
  const list = loadSubscriptions();
  if (list.length === 0) return { sent: 0, pruned: 0, failed: 0, skipped: 'no subscriptions' };
  const body = JSON.stringify(payload);
  let sent = 0;
  let pruned = 0;
  let failed = 0;
  /** @type {string[]} */
  const gone = [];
  await Promise.allSettled(
    list.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, body, { TTL: 3600 });
        sent += 1;
      } catch (err) {
        const statusCode = err?.statusCode ?? err?.cause?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          gone.push(sub.endpoint);
          pruned += 1;
        } else {
          failed += 1;
          console.warn(
            `[tbweb] push delivery failed (${statusCode ?? 'no status'}): ${err?.message ?? err}`,
          );
        }
      }
    }),
  );
  if (gone.length > 0) {
    const endpoints = new Set(gone);
    saveSubscriptions(loadSubscriptions().filter((s) => !endpoints.has(s.endpoint)));
    console.log(`[tbweb] pruned ${gone.length} gone push subscription(s)`);
  }
  console.log(`[tbweb] push fan-out: ${sent} sent, ${pruned} pruned, ${failed} failed`);
  return { sent, pruned, failed };
}
