/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * talaria result cache (Round-2 perf).
 *
 * A small in-memory TTL cache with stale-while-revalidate for the MCP tool
 * calls that are safe to reuse: read-only list/search tools whose answers
 * only change when the mailbox does. The SSE poll tick flushes the mail
 * derived keys when it detects a change (index.js broadcastMail), so a
 * cache hit never outlives a known mail movement by more than one poll.
 *
 * Never cached: everything that reads an individual record or a person
 * (getMessage, getMessages, searchContacts, getContact) and every tool not
 * explicitly allowlisted — unknown tools always pass through to Thunderbird.
 * The SSE unread poll probe is deliberately NOT routed through this cache
 * either: its whole job is to observe the live count.
 *
 * Semantics:
 *   - fresh entry (age < TTL)   → answered from cache
 *   - stale entry (age >= TTL)  → answered from cache, refreshed in the
 *     background (stale-while-revalidate; concurrent callers share one
 *     refresh via single-flight)
 *   - no entry                  → fetched, stored, answered
 * Failures never poison the cache: a failed background refresh leaves the
 * stale entry in place; a failed initial fetch propagates to its caller and
 * stores nothing.
 */

/** Cacheable tools and their TTLs (ms). Anything absent = never cached. */
const TTL_MS = {
  searchMessages: 60_000,
  getRecentMessages: 60_000,
  listFolders: 60_000,
  listAccounts: 300_000,
  listCalendars: 300_000,
  listTasks: 300_000,
  listAddressBooks: 300_000,
};

/** Documented never-cache list — kept even though the allowlist above
 *  already excludes them, so the intent is greppable. Round-3 W1 adds the
 *  write tier: mutations must never be answered from a cache, and their
 *  success flushes the mail-derived keys (flushAfterWrite below). */
const NEVER_CACHE = new Set([
  'getMessage',
  'getMessages',
  'searchContacts',
  'getContact',
  'updateMessage',
  'createFolder',
  'applyFilters',
  'saveDraft',
  'replyToMessage',
  'forwardMessage',
]);

/** The write tier (Round 3): W1 organize + W2 drafts — the only write tools
 *  the sidecar will proxy. Server-side, commonpost still gates everything
 *  else off via disabledTools (sendMail stays disabled, as do deletions);
 *  this list exists so a successful write can flush the read caches it
 *  invalidates (a move/mark-read/draft-save changes search results and
 *  folder tallies; filter runs change search results). replyToMessage and
 *  forwardMessage are listed for completeness but can never succeed
 *  through the proxy (blocked upstream-hang guard in index.js). */
export const WRITE_TOOLS = new Set(['updateMessage', 'createFolder', 'applyFilters', 'saveDraft', 'replyToMessage', 'forwardMessage']);

/** @type {Map<string, {at: number, value: any}>} cache key -> entry */
const store = new Map();
/** @type {Map<string, Promise<any>>} cache key -> in-flight fetch */
const inflight = new Map();

/** @param {string} tool */
export function isCacheable(tool) {
  return TTL_MS[tool] !== undefined && !NEVER_CACHE.has(tool);
}

/**
 * Canonical JSON: object keys sorted, array order preserved, undefined
 * fields dropped — so the same logical call from different callers maps to
 * one cache key regardless of property order.
 * @param {any} value
 * @returns {string}
 */
export function canonicalJson(value) {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

/** @param {string} tool @param {Record<string, unknown>} args */
export function cacheKey(tool, args) {
  return `${tool}::${canonicalJson(args ?? {})}`;
}

/**
 * Fetch-through cache with stale-while-revalidate.
 * @param {string} tool
 * @param {Record<string, unknown>} args
 * @param {() => Promise<any>} fetcher resolves the parsed tool payload
 * @returns {Promise<any>} the (possibly stale) cached value
 */
export function cachedCall(tool, args, fetcher) {
  return cachedCallMeta(tool, args, fetcher).then((m) => m.value);
}

/**
 * Like cachedCall, but also reports the freshness of the value that was
 * served (Date.now() when it was fetched upstream) — /api/bootstrap uses it
 * so clients can tell how old the ingredients of an answer are.
 * @param {string} tool
 * @param {Record<string, unknown>} args
 * @param {() => Promise<any>} fetcher
 * @returns {Promise<{value: any, at: number, cached: boolean}>}
 */
export function cachedCallMeta(tool, args, fetcher) {
  if (!isCacheable(tool)) {
    return fetcher().then((value) => ({ value, at: Date.now(), cached: false }));
  }
  const key = cacheKey(tool, args);
  const entry = store.get(key);
  if (entry) {
    if (Date.now() - entry.at < TTL_MS[tool]) {
      return Promise.resolve({ value: entry.value, at: entry.at, cached: true });
    }
    // Stale-while-revalidate: serve the stale value now, refresh silently.
    void refresh(key, fetcher).catch(() => {});
    return Promise.resolve({ value: entry.value, at: entry.at, cached: true });
  }
  return refresh(key, fetcher).then((value) => ({ value, at: Date.now(), cached: false }));
}

/**
 * Single-flight fetch-and-store for one key.
 * @param {string} key
 * @param {() => Promise<any>} fetcher
 * @returns {Promise<any>}
 */
function refresh(key, fetcher) {
  const existing = inflight.get(key);
  if (existing) return existing;
  const promise = (async () => {
    try {
      const value = await fetcher();
      store.set(key, { at: Date.now(), value });
      return value;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, promise);
  return promise;
}

/**
 * Drop every cache entry of one tool (called when the SSE poll detects a
 * mail change — search results and folder tallies may be stale from here on).
 * @param {string} tool
 */
export function flushTool(tool) {
  const prefix = `${tool}::`;
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

/**
 * Flush the mail-derived keys after a successful W1 write: search results,
 * the recent page and folder tallies can all change behind a move, a
 * read/flag change, a new folder or a filter run. Called from the
 * /api/tools/call handler BEFORE the answer is sent, so a client that
 * refetches on the write's heels cannot hit a stale entry.
 */
export function flushAfterWrite() {
  flushTool('searchMessages');
  flushTool('getRecentMessages');
  flushTool('listFolders');
}

/** Entries with tool name and age — no payloads (for /api/cache stats). */
export function cacheSnapshot() {
  const now = Date.now();
  const entries = [];
  for (const [key, entry] of store) {
    const tool = key.slice(0, key.indexOf('::'));
    entries.push({ tool, ageMs: now - entry.at });
  }
  entries.sort((a, b) => a.tool.localeCompare(b.tool) || a.ageMs - b.ageMs);
  return { size: store.size, entries };
}
