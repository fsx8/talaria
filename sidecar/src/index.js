#!/usr/bin/env node
/**
 * tbweb — unofficial Thunderbird web client, Phase 1 sidecar.
 *
 * Runs inside the thunderbird container's network namespace
 * (`network_mode: "service:thunderbird"`), where it can reach the commonpost
 * add-on's loopback-only JSON-RPC server (POST /, ports 8780 with failover
 * 8781–8789) and is itself reachable from the dockflare tunnel as
 * `http://thunderbird:8942`.
 *
 * Responsibilities (Phase 1 + Phase 4 + Round-2 perf):
 *   - GET  /health         — liveness + commonpost reachability probe
 *   - POST /api/tools/call — JSON-RPC `tools/call` proxy (Bearer + bridge header added here);
 *                            cacheable read tools answered from an in-memory TTL cache
 *                            with stale-while-revalidate (see cache.js); W1 write tools
 *                            (updateMessage, createFolder, applyFilters) pass through and
 *                            flush the mail-derived cache keys on success
 *   - POST /api/tools/list — JSON-RPC `tools/list` passthrough
 *   - GET  /api/bootstrap  — accounts + folders + recent first page + global unread in one
 *                            call, assembled from the cache; prewarmed on mail change + every 5 min
 *   - GET  /api/cache      — cache stats (tool names + ages, no payloads)
 *   - GET  /events         — SSE: heartbeat every 15 s, `mail` events on unread-count change
 *   - GET  /push/public-key · POST /push/subscribe|unsubscribe|test — VAPID web-push
 *   - GET  /*              — static files from public/ (index.html fallback for the SPA)
 *
 * SECURITY MODEL: no application-level auth by design — Cloudflare Access
 * (group `sf`) is the authentication gate, exactly like the thunderbird and
 * chromium selkies GUIs. The COMMONPOST token never leaves this process: it
 * is attached server-side to every upstream call and is never exposed to
 * the browser, neither via headers nor responses. The sidecar itself is not
 * published on the host; it is reachable only from the tunnel and from the
 * compose_default network.
 *
 * Upstream protocol facts (verified against commonpost v0.26.1 source):
 *   - Single endpoint `POST /`, JSON-RPC 2.0, `Authorization: Bearer <token>`
 *     on every request (missing/wrong => HTTP 403, body error code -32600).
 *   - The server is stateless: `initialize` is answered per request and
 *     `tools/call` does not require a prior initialize (it is MCP-client
 *     convention). We still initialize on every health probe so /health can
 *     report the real serverInfo.
 *   - `X-Commonpost-Bridge: "<X.Y.Z>; packaging=<mcpb|file>[; profile=<n>]"`:
 *     self-declared client version the add-on compares against its bridge
 *     thresholds (v0.26.1: MIN_BRIDGE_VERSION 0.17.1, CURRENT 0.20.0).
 *     Sending the current bridge version suppresses the "update the bridge"
 *     notice the add-on would otherwise append as a trailing content item.
 *   - `tools/call` results are `{content:[{type:"text",text}, ...], isError?}`
 *     where content[0].text is the JSON-stringified payload. Extra trailing
 *     text items (bridge notices) are ignored by the parser. All other MCP
 *     results (tools/list, initialize) are plain objects, no content wrapper.
 */
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import * as push from './push.js';
import { cacheSnapshot, cachedCallMeta, flushAfterWrite, flushTool, isCacheable, WRITE_TOOLS } from './cache.js';

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LISTEN_PORT = Number(process.env.PORT ?? 8942);
const LISTEN_HOST = process.env.HOST ?? '0.0.0.0';
const TOKEN = process.env.COMMONPOST_MCP_TOKEN ?? '';

/** Loopback ports the commonpost add-on may listen on (8780 stable, rest failover). */
const COMMONPOST_PORTS = parsePortRange(process.env.COMMONPOST_PORTS ?? '8780-8789');

/** Must mirror the current mcp-bridge.cjs release so the add-on stays silent (see file docblock). */
const BRIDGE_HEADER = process.env.TBWEB_BRIDGE_HEADER ?? '0.20.0; packaging=file';

/** MCP protocol version offered in initialize; commonpost v0.26.1 supports 2024-10-07…2025-11-25. */
const MCP_PROTOCOL_VERSION = process.env.TBWEB_MCP_PROTOCOL ?? '2025-06-18';

const SSE_HEARTBEAT_MS = Number(process.env.SSE_HEARTBEAT_MS ?? 15000);
const SSE_POLL_MS = Number(process.env.SSE_POLL_MS ?? 60000);
const HEALTH_CACHE_MS = Number(process.env.HEALTH_CACHE_MS ?? 5000);
const RPC_TIMEOUT_MS = Number(process.env.RPC_TIMEOUT_MS ?? 20000);
const BODY_LIMIT = Number(process.env.BODY_LIMIT ?? 8 * 1024 * 1024);

/**
 * Cheap unread probe used by the SSE poller. `query: ""` matches all messages,
 * countOnly keeps the answer to a single integer. Override with
 * TBWEB_POLL_ARGS (JSON), e.g. to scope to one folderPath.
 * @type {{name: string, arguments: Record<string, unknown>}}
 */
const POLL_CALL = /** @type {{name: string, arguments: Record<string, unknown>}} */ ({
  name: 'searchMessages',
  arguments: {
    query: '',
    unreadOnly: true,
    countOnly: true,
    maxResults: 1,
  },
});

const pollCallOverride = process.env.TBWEB_POLL_CALL;
if (pollCallOverride) {
  try {
    Object.assign(POLL_CALL, JSON.parse(pollCallOverride));
  } catch (err) {
    console.error(`[tbweb] TBWEB_POLL_CALL is not valid JSON: ${err?.message ?? err}`);
    process.exit(1);
  }
}

/** Prewarm interval for the /api/bootstrap cache keys (Round-2 perf). */
const PREWARM_MS = Number(process.env.TBWEB_PREWARM_MS ?? 300000);

// Static root: default is the app's own public/ snapshot; deployments can
// point it at the live bind-mount (TBWEB_PUBLIC_DIR=/app/public) so SPA
// builds go live without recreating the container.
const PUBLIC_DIR = process.env.TBWEB_PUBLIC_DIR
  ? path.resolve(process.env.TBWEB_PUBLIC_DIR)
  : path.join(APP_ROOT, 'public');

if (!TOKEN) {
  console.error('[tbweb] COMMONPOST_MCP_TOKEN is empty — refusing to start (fail-closed)');
  process.exit(1);
}

/** @param {string} spec "8780-8789" -> [8780..8789] */
function parsePortRange(spec) {
  const m = /^(\d+)-(\d+)$/.exec(spec.trim());
  if (!m) return [Number(spec)];
  const [lo, hi] = [Number(m[1]), Number(m[2])];
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
}

/* ------------------------------------------------------------------ */
/* commonpost JSON-RPC client (loopback, with port failover)           */
/* ------------------------------------------------------------------ */

let rpcSeq = 0;
/** Port that answered last; tried first. @type {number|null} */
let preferredPort = null;
/** serverInfo from the last successful initialize. @type {Record<string, unknown>|null} */
let serverInfo = null;

/**
 * One JSON-RPC POST against one candidate port.
 * @param {number} port
 * @param {string} method
 * @param {Record<string, unknown>|undefined} params
 * @returns {Promise<{status: number, body: any}>}
 */
async function rpcOnce(port, method, params) {
  const payload = JSON.stringify({ jsonrpc: '2.0', id: ++rpcSeq, method, params });
  const res = await fetch(`http://127.0.0.1:${port}/`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${TOKEN}`,
      'x-commonpost-bridge': BRIDGE_HEADER,
    },
    body: payload,
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

/**
 * JSON-RPC with failover across COMMONPOST_PORTS. Network errors (addon
 * restarted on another port) and 403s (stale server on the preferred port)
 * walk the whole list; a JSON-RPC *protocol* error (unknown tool, bad args)
 * is a valid answer from a working server and is returned as-is.
 * @param {string} method
 * @param {Record<string, unknown>|undefined} params
 * @returns {Promise<
 *   | {ok: true, result: any, port: number}
 *   | {ok: false, kind: 'down'|'forbidden'|'rpc', error: any, port?: number}>}
 */
async function rpc(method, params) {
  const order = preferredPort !== null && COMMONPOST_PORTS.includes(preferredPort)
    ? [preferredPort, ...COMMONPOST_PORTS.filter((p) => p !== preferredPort)]
    : [...COMMONPOST_PORTS];

  /** @type {{kind:'down'|'forbidden', error:any}|null} */
  let lastFailure = null;

  for (const port of order) {
    let res;
    try {
      res = await rpcOnce(port, method, params);
    } catch {
      lastFailure = { kind: 'down', error: `no JSON-RPC server on 127.0.0.1:${port}` };
      continue; // ECONNREFUSED / timeout -> next port
    }
    if (res.status === 403) {
      lastFailure = { kind: 'forbidden', error: res.body?.error ?? 'invalid auth token' };
      continue; // token rejected -> re-probe the remaining ports
    }
    if (res.status !== 200 || !res.body || typeof res.body !== 'object') {
      lastFailure = { kind: 'down', error: `HTTP ${res.status} from 127.0.0.1:${port}` };
      continue;
    }
    preferredPort = port;
    if (res.body.error !== undefined && res.body.error !== null) {
      return { ok: false, kind: 'rpc', error: res.body.error, port };
    }
    return { ok: true, result: res.body.result, port };
  }
  return { ok: false, kind: lastFailure?.kind ?? 'down', error: lastFailure?.error ?? 'commonpost unreachable' };
}

/**
 * MCP `initialize` against the port range; remembers serverInfo.
 * @param {boolean} force bypass the cache
 * @returns {Promise<{reachable: boolean, port: number|null, serverInfo: Record<string, unknown>|null, error?: string}>}
 */
let healthCache = { at: 0, value: null };
async function probeCommonpost(force = false) {
  const now = Date.now();
  if (!force && healthCache.value && now - healthCache.at < HEALTH_CACHE_MS) {
    return healthCache.value;
  }
  const r = await rpc('initialize', {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'tbweb', version: '0.1.0' },
  });
  let value;
  if (r.ok && r.result && typeof r.result === 'object') {
    serverInfo = /** @type {Record<string, unknown>} */ (r.result.serverInfo ?? null);
    value = { reachable: true, port: r.port, serverInfo };
  } else {
    value = { reachable: false, port: null, serverInfo, error: String(r.error ?? 'unreachable') };
  }
  healthCache = { at: now, value };
  return value;
}

/* ------------------------------------------------------------------ */
/* tools/call response parsing                                         */
/* ------------------------------------------------------------------ */

/**
 * One proxied tool call, parsed: the data payload or a thrown Error whose
 * `kind` mirrors rpc's failure kinds ('rpc' = tool-level failure, i.e. a
 * valid proxied answer that should surface as HTTP 200 ok:false).
 * @param {string} name
 * @param {Record<string, unknown>} args
 * @returns {Promise<any>}
 */
async function callToolData(name, args) {
  const r = await rpc('tools/call', { name, arguments: args });
  if (!r.ok) {
    const err = new Error(r.error?.message ?? String(r.error ?? `${name} failed`));
    /** @type {any} */ (err).kind = r.kind;
    throw err;
  }
  const parsed = parseToolResult(r.result);
  if (!parsed.ok) {
    const err = new Error(JSON.stringify(parsed.error)?.slice(0, 300) ?? `${name} returned an unusable payload`);
    /** @type {any} */ (err).kind = 'rpc'; // tool-level: keep the 200 ok:false envelope
    throw err;
  }
  return parsed.data;
}

/**
 * The SPA's default register query (real-backend.ts `recentQueryArguments`):
 * no text/scope/filter → bounded to the last 14 days, floored to the hour so
 * the arguments — and therefore the cache key — stay stable within the hour.
 * /api/bootstrap's `recent` and the prewarm deliberately use the EXACT
 * arguments the SPA's boot query sends, so one cache entry serves both.
 * KEEP IN SYNC with compose/tbweb/spa/src/api/real-backend.ts.
 * @returns {Record<string, unknown>}
 */
function recentQueryArgs() {
  return {
    query: '',
    maxResults: 50,
    offset: 0,
    fields: ['date', 'author', 'recipients', 'ccList', 'subject', 'read', 'flagged', 'tags', 'preview'],
    startDate: new Date(Math.floor((Date.now() - 14 * 86400000) / 3600000) * 3600000).toISOString(),
  };
}


/**
 * Extract the payload from a JSON-RPC result. tools/call results are
 * `{content:[{type:"text",text},...], isError?}` where content[0].text is the
 * JSON-stringified payload; tolerate a "bridge outdated" notice (extra
 * trailing text items, or a notice glued after the JSON) by taking the first
 * balanced JSON value. Every other MCP result (tools/list, initialize) is a
 * plain object and is passed through as-is.
 * @param {any} result
 * @returns {{ok: true, data: any} | {ok: false, error: any}}
 */
function parseToolResult(result) {
  if (Array.isArray(result?.content)) {
    const texts = result.content.filter((i) => i?.type === 'text').map((i) => String(i.text ?? ''));
    const primary = texts[0] ?? '';
    let data;
    try {
      data = JSON.parse(primary);
    } catch {
      data = tryExtractJson(primary);
      if (data === undefined) data = primary; // plain-text payload
    }
    return result.isError ? { ok: false, error: data } : { ok: true, data };
  }
  if (result && typeof result === 'object') return { ok: true, data: result };
  if (typeof result === 'string') {
    try {
      return { ok: true, data: JSON.parse(result) };
    } catch {/* fall through */}
  }
  return { ok: false, error: `unexpected result shape: ${JSON.stringify(result)?.slice(0, 200)}` };
}

/**
 * Find and parse the first balanced JSON object/array in a string
 * (string-escape aware). Returns undefined when nothing parses.
 * @param {string} s
 * @returns {any}
 */
function tryExtractJson(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '{' && c !== '[') continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < s.length; j++) {
      const ch = s[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(s.slice(i, j + 1));
          } catch {
            break; // not a JSON prefix after all; try the next opener
          }
        }
      }
    }
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* SSE hub + polling MVP                                               */
/* ------------------------------------------------------------------ */

/** @type {Set<import('node:http').ServerResponse>} */
const sseClients = new Set();
let lastUnread = null; // first observation only sets the baseline
let lastPollError = null;

/** @param {import('node:http').ServerResponse} res @param {string} event @param {unknown} data */
function sseSend(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function sseHeartbeat() {
  const ts = new Date().toISOString();
  for (const res of sseClients) {
    try {
      res.write(`: hb ${ts}\n\n`);
    } catch {
      sseClients.delete(res);
    }
  }
}

function broadcastMail(count) {
  const prev = lastUnread;
  lastUnread = count;
  const payload = { unread: count, previous: prev, ts: new Date().toISOString() };
  for (const res of sseClients) {
    try {
      sseSend(res, 'mail', payload);
    } catch {
      sseClients.delete(res);
    }
  }
  // Phase 4: fan the change out to every stored web-push subscription
  // (payload {unread, ts}; gone subscriptions are pruned by the sender).
  void push.notifyAll({ unread: count, ts: payload.ts });
}

async function pollUnread() {
  try {
    // The poll probe goes straight to rpc(), never through the cache: its
    // whole job is to observe the live count (a cached answer would never
    // detect a change).
    const r = await rpc('tools/call', { name: POLL_CALL.name, arguments: POLL_CALL.arguments });
    if (!r.ok) {
      throw new Error(r.kind === 'rpc' ? String(r.error?.message ?? r.error) : `commonpost unreachable (${String(r.error?.message ?? r.error)})`);
    }
    const parsed = parseToolResult(r.result);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
    const d = parsed.data;
    const count = typeof d?.count === 'number' ? d.count : typeof d?.totalMatches === 'number' ? d.totalMatches : null;
    if (count === null) throw new Error(`unexpected poll payload: ${JSON.stringify(d).slice(0, 200)}`);
    lastPollError = null;
    if (lastUnread === null) {
      lastUnread = count; // baseline, no event
      console.log(`[tbweb] unread baseline: ${count}`);
    } else if (count !== lastUnread) {
      console.log(`[tbweb] unread changed: ${lastUnread} -> ${count}`);
      // Mail moved: search results and folder tallies may be stale from
      // here on — flush the mail-derived cache keys BEFORE any client can
      // react, then re-warm them so the next SPA refresh / bootstrap call
      // hits fresh entries.
      flushTool('searchMessages');
      flushTool('listFolders');
      broadcastMail(count);
      prewarmBootstrap();
    }
  } catch (err) {
    lastPollError = String(err?.message ?? err);
    console.warn(`[tbweb] poll failed: ${lastPollError}`);
  }
}

/**
 * Refresh the cached keys /api/bootstrap assembles from, without awaiting:
 * called when a mail change was detected and on a fixed interval, so the
 * bootstrap answer is always warm even hours after the last visitor.
 */
function prewarmBootstrap() {
  const recentArgs = recentQueryArgs();
  void cachedCallMeta('listAccounts', {}, () => callToolData('listAccounts', {})).catch(() => {});
  void cachedCallMeta('listFolders', {}, () => callToolData('listFolders', {})).catch(() => {});
  void cachedCallMeta('searchMessages', recentArgs, () => callToolData('searchMessages', recentArgs)).catch(() => {});
}

/* ------------------------------------------------------------------ */
/* Static file serving (public/, SPA fallback for extension-less GETs) */
/* ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

/**
 * @param {import('fastify').FastifyRequest} req
 * @param {import('fastify').FastifyReply} reply
 */
async function serveStatic(req, reply) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return reply.code(400).send('bad request');
  }
  if (pathname.includes('\0')) return reply.code(400).send('bad request');
  // API namespaces are never served statically (no SPA fallback for /api/* or /push/*)
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    return reply.code(404).send({ ok: false, error: `not found: ${req.method} ${pathname}` });
  }
  if (pathname === '/push' || pathname.startsWith('/push/')) {
    return reply.code(404).send({ ok: false, error: `not found: ${req.method} ${pathname}` });
  }

  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    return reply.code(403).send('forbidden');
  }

  let target = filePath;
  try {
    const st = statSync(target);
    if (st.isDirectory()) target = path.join(target, 'index.html');
  } catch {
    /* not there — maybe SPA fallback below */
  }

  let ext = path.extname(target).toLowerCase();
  if (!ext || !statSyncSafe(target)) {
    // Extension-less route (Vue router arrives in Phase 2) -> SPA fallback
    const fallback = path.join(PUBLIC_DIR, 'index.html');
    if (statSyncSafe(fallback)) {
      target = fallback;
      ext = '.html';
    }
  }
  if (!statSyncSafe(target)) return reply.code(404).send('not found');

  return reply
    .code(200)
    .header('content-type', MIME[ext] ?? 'application/octet-stream')
    .header('cache-control', ext === '.html' ? 'no-cache' : 'public, max-age=3600')
    .send(createReadStream(target));
}

/** @param {string} p */
function statSyncSafe(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Fastify app                                                         */
/* ------------------------------------------------------------------ */

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  bodyLimit: BODY_LIMIT,
  trustProxy: true,
});

app.get('/health', async () => {
  const commonpost = await probeCommonpost();
  return { ok: true, commonpost, uptime: process.uptime() };
});
app.get('/api/health', async () => {
  const commonpost = await probeCommonpost();
  return { ok: true, commonpost, uptime: process.uptime() };
});

app.post('/api/tools/call', async (req, reply) => {
  const body = /** @type {any} */ (req.body ?? {});
  if (typeof body.name !== 'string' || !body.name) {
    return reply.code(400).send({ ok: false, error: 'body must be JSON {name: string, arguments?: object}' });
  }
  const args = body.arguments ?? {};
  try {
    // Cacheable read tools (searchMessages/listFolders/listAccounts/…)
    // answer from the sidecar's TTL cache with stale-while-revalidate;
    // everything else (getMessage(s), contacts, writes, unknown tools)
    // passes straight through. The SSE poll probe never routes through here.
    const { value } = await cachedCallMeta(body.name, args, () => callToolData(body.name, args));
    // W1 organize (Round 3): a successful write changes what the read
    // caches hold (moves change search results + folder tallies, folder
    // creation changes listFolders) — drop those entries before the answer
    // goes out so the client's refetch sees fresh data.
    if (WRITE_TOOLS.has(body.name)) flushAfterWrite();
    return reply.send({ ok: true, data: value });
  } catch (err) {
    const kind = /** @type {any} */ (err)?.kind;
    const code = kind === 'rpc' ? 200 : 502; // tool-level failure is a valid proxied answer
    return reply.code(code).send({ ok: false, error: err?.message ?? String(err) });
  }
});

app.post('/api/tools/list', async (req, reply) => {
  const r = await rpc('tools/list', {});
  if (!r.ok) return reply.code(r.kind === 'rpc' ? 200 : 502).send({ ok: false, error: r.error?.message ?? r.error });
  const parsed = parseToolResult(r.result);
  if (!parsed.ok) return reply.send({ ok: false, error: parsed.error });
  return reply.send({ ok: true, data: parsed.data });
});

app.get('/api/bootstrap', async (req, reply) => {
  // One call for the SPA's boot: accounts + folders + recent first page +
  // the global unread, assembled from the sidecar cache (missing keys are
  // fetched in parallel; single-flight dedupes concurrent bootstraps).
  // generatedAt = freshness of the OLDEST cache ingredient that built this
  // answer, so clients can tell whether the payload predates their snapshot.
  const recentArgs = recentQueryArgs();
  try {
    const [accounts, folders, recent] = await Promise.all([
      cachedCallMeta('listAccounts', {}, () => callToolData('listAccounts', {})),
      cachedCallMeta('listFolders', {}, () => callToolData('listFolders', {})),
      cachedCallMeta('searchMessages', recentArgs, () => callToolData('searchMessages', recentArgs)),
    ]);
    const oldest = Math.min(accounts.at, folders.at, recent.at);
    return {
      ok: true,
      accounts: accounts.value,
      folders: folders.value,
      recent: recent.value,
      unread: lastUnread,
      generatedAt: new Date(oldest).toISOString(),
    };
  } catch (err) {
    return reply.code(502).send({ ok: false, error: err?.message ?? String(err) });
  }
});

app.get('/api/cache', async () => {
  // Ops/stats: which tools are cached and how old — no payloads.
  return { ok: true, ...cacheSnapshot() };
});

app.get('/events', (req, reply) => {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write('retry: 5000\n\n');
  sseSend(res, 'hello', {
    unread: lastUnread,
    pollMs: SSE_POLL_MS,
    heartbeatMs: SSE_HEARTBEAT_MS,
    pollError: lastPollError,
    ts: new Date().toISOString(),
  });
  sseClients.add(res);
  req.raw.on('close', () => sseClients.delete(res));
});

/* ------------------------------------------------------------------ */
/* web-push (Phase 4): public key, subscriptions, test send            */
/* ------------------------------------------------------------------ */

app.get('/push/public-key', async () => {
  return { ok: true, publicKey: push.getPublicKey() };
});

app.post('/push/subscribe', async (req, reply) => {
  const result = push.addSubscription(req.body);
  return reply.code(result.ok ? 200 : 400).send(result.ok ? { ok: true, stored: push.subscriptionCount() } : result);
});

app.post('/push/unsubscribe', async (req, reply) => {
  const body = /** @type {any} */ (req.body ?? {});
  const result = push.removeSubscription(body.endpoint);
  return reply.code(result.ok ? 200 : 400).send(result);
});

app.post('/push/test', async (req, reply) => {
  const result = await push.notifyAll({ unread: lastUnread, ts: new Date().toISOString(), test: true });
  return reply.send({ ok: true, ...result });
});

app.get('/*', serveStatic);
app.setNotFoundHandler((req, reply) => {
  reply.code(404).send({ ok: false, error: `not found: ${req.method} ${req.url}` });
});
app.setErrorHandler((err, req, reply) => {
  const code = err.statusCode ?? 500;
  if (code >= 500) req.log.error(err);
  reply.code(code).send({ ok: false, error: err.message });
});

/* ------------------------------------------------------------------ */

const healthTimer = setInterval(() => void probeCommonpost(true), HEALTH_CACHE_MS);
const heartbeatTimer = setInterval(sseHeartbeat, SSE_HEARTBEAT_MS);
const pollTimer = setInterval(pollUnread, SSE_POLL_MS);
const prewarmTimer = setInterval(prewarmBootstrap, PREWARM_MS);
for (const t of [healthTimer, heartbeatTimer, pollTimer, prewarmTimer]) t.unref?.();

async function main() {
  // Baselines before accepting traffic: health + initial unread count.
  push.initPush();
  const cp = await probeCommonpost(true);
  console.log(
    `[tbweb] commonpost ${cp.reachable ? `reachable on 127.0.0.1:${cp.port}` : 'UNREACHABLE'} serverInfo=${JSON.stringify(cp.serverInfo)}`,
  );
  await pollUnread();
  prewarmBootstrap(); // the first visitor of the day gets a warm bootstrap

  await app.listen({ port: LISTEN_PORT, host: LISTEN_HOST });
  console.log(`[tbweb] listening on ${LISTEN_HOST}:${LISTEN_PORT} (static: ${PUBLIC_DIR})`);
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`[tbweb] ${sig} received, shutting down`);
    app
      .close()
      .catch(() => {})
      .finally(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error('[tbweb] fatal:', err);
  process.exit(1);
});
