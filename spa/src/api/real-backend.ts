/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Real backend: the tbweb sidecar, same-origin. Every MCP tool call goes
 * through POST /api/tools/call ({ name, arguments }) which answers
 * { ok: true, data } or { ok: false, error }; live changes arrive over
 * GET /events (SSE: hello / mail { unread, previous, ts } / heartbeats).
 * The COMMONPOST token never leaves the sidecar process — nothing here
 * authenticates, Cloudflare Access is the gate.
 */

import type {
  MailBackend,
  AttachmentPayload,
  BodyChunk,
  ComposeTarget,
  CreateFolderResult,
  DraftFields,
  DraftResult,
  MessagePatch,
  MessageRef,
  MessageSource,
  PushBackend,
  Recipient,
  UpdateResult,
} from "./backend-interface";
import type {
  Account,
  AddressBook,
  AttachmentInfo,
  BootstrapData,
  CalendarInfo,
  ContactDetail,
  ContactLine,
  ContactSearchResult,
  ContactSummary,
  EventInfo,
  Folder,
  FolderKind,
  HealthInfo,
  MailEvent,
  MailEventCallback,
  MessageAuthentication,
  MessageDetail,
  MessageQuery,
  MessageSummary,
  SearchResult,
  TaskInfo,
} from "./types";
import { base64ToBytes, bytesToText, extractAttachment } from "./mime";

/** Every column the register page needs; the sidecar lets us ask for them. */
const ROW_FIELDS = [
  "date",
  "author",
  "recipients",
  "ccList",
  "subject",
  "read",
  "flagged",
  "tags",
  "preview",
] as const;

export class BackendError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable = false) {
    super(message);
    this.name = "BackendError";
    this.retryable = retryable;
  }
}

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

async function call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/api/tools/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: tool, arguments: args }),
    });
  } catch (cause) {
    throw new BackendError("The sidecar is unreachable from here.", true);
  }
  if (response.status === 502) {
    throw new BackendError("The sidecar cannot reach Thunderbird right now.", true);
  }
  let envelope: Envelope<T>;
  try {
    envelope = (await response.json()) as Envelope<T>;
  } catch {
    throw new BackendError(`The sidecar answered HTTP ${response.status} with no JSON.`, true);
  }
  if (!envelope.ok) {
    const reason = envelope.error;
    throw new BackendError(
      typeof reason === "string" && reason ? reason : JSON.stringify(reason) || `The "${tool}" call failed on the sidecar.`,
    );
  }
  if (envelope.data === undefined || envelope.data === null) {
    throw new BackendError(`The "${tool}" call returned nothing.`);
  }
  return envelope.data;
}

/* ---- mappers: wire shapes → domain types (defensive, never trusting) ---- */

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

const FOLDER_KINDS: ReadonlySet<string> = new Set([
  "inbox",
  "sent",
  "drafts",
  "trash",
  "junk",
  "archive",
  "outbox",
  "folder",
  "savedsearch",
]);

function asFolderKind(value: unknown): FolderKind {
  const raw = str(value, "folder");
  return FOLDER_KINDS.has(raw) ? (raw as FolderKind) : "folder";
}

function mapAccount(raw: Record<string, unknown>, index: number): Account {
  const identities = Array.isArray(raw.identities)
    ? raw.identities
        .filter((i): i is Record<string, unknown> => typeof i === "object" && i !== null)
        .map((i) => ({
          id: str(i.id),
          email: str(i.email),
          name: str(i.name),
          isDefault: bool(i.isDefault),
        }))
    : [];
  const email =
    identities.find((i) => i.isDefault)?.email ?? identities[0]?.email ?? str(raw.name);
  const displayName = identities.find((i) => i.isDefault)?.name ?? identities[0]?.name ?? "";
  return {
    id: str(raw.id),
    label: displayName || email || str(raw.name, "Account"),
    email,
    type: str(raw.type, "unknown"),
    colorIndex: index % ACCOUNT_PALETTE_SIZE,
    identities,
  };
}

function mapFolder(raw: Record<string, unknown>): Folder {
  return {
    path: str(raw.path),
    name: str(raw.name, "Folder"),
    kind: asFolderKind(raw.type),
    accountId: str(raw.accountId),
    total: num(raw.totalMessages),
    unread: num(raw.unreadMessages),
    depth: num(raw.depth),
    favorite: bool(raw.isFavorite),
  };
}

function mapSummary(raw: Record<string, unknown>): MessageSummary {
  return {
    id: str(raw.id),
    folderPath: str(raw.folderPath),
    subject: str(raw.subject, "(no subject)"),
    author: str(raw.author),
    recipients: str(raw.recipients),
    ccList: str(raw.ccList),
    date: str(raw.date),
    read: bool(raw.read),
    flagged: bool(raw.flagged),
    tags: strArray(raw.tags),
    preview: stripContentMarkers(str(raw.preview)),
    hasAttachments: typeof raw.hasAttachments === "boolean" ? raw.hasAttachments : undefined,
  };
}

/**
 * The addon wraps free text (bodies, event titles, notes) in
 * `<email-content id="…">` markers. DOMPurify strips the tag for bodies, but
 * text rendered as plain text (agenda titles, contact notes) must be cleaned
 * at the mapper: unwrap the markers and trim the padding newlines.
 */
export function stripContentMarkers(text: string): string {
  return text
    .replace(/<email-content[^>]*>([\s\S]*?)<\/email-content[^>]*>/gi, "$1")
    .replace(/^\s*\n/, "")
    .replace(/\n\s*$/, "");
}

function mapAuthentication(raw: Record<string, unknown> | undefined): MessageAuthentication | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const auth: MessageAuthentication = {};
  if (raw.authservId !== undefined) auth.authservId = str(raw.authservId);
  if (raw.spf && typeof raw.spf === "object") {
    const spf = raw.spf as Record<string, unknown>;
    auth.spf = { result: str(spf.result, "unknown"), domain: str(spf.domain) || undefined };
  }
  if (Array.isArray(raw.dkim)) {
    auth.dkim = raw.dkim
      .filter((d): d is Record<string, unknown> => typeof d === "object" && d !== null)
      .map((d) => ({
        result: str(d.result, "unknown"),
        domain: str(d.domain) || undefined,
      }));
  }
  if (raw.dmarc && typeof raw.dmarc === "object") {
    const dmarc = raw.dmarc as Record<string, unknown>;
    auth.dmarc = { result: str(dmarc.result, "unknown"), domain: str(dmarc.domain) || undefined };
  }
  return auth;
}

function mapAttachments(raw: unknown): AttachmentInfo[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a): a is Record<string, unknown> => typeof a === "object" && a !== null)
    .map((a) => ({
      name: str(a.name ?? a.fileName ?? a.filename, "attachment"),
      size: typeof a.size === "number" && a.size > 0 ? a.size : undefined,
      contentType: str(a.contentType ?? a.mimeType) || undefined,
      part: str(a.part) || undefined,
    }));
}

function mapDetail(raw: Record<string, unknown>): MessageDetail {
  // HTML mail arrives as raw HTML (bodyIsHtml) and is sanitized client-side;
  // plain mail arrives as text and renders through the markdown pipeline.
  const bodyFormat: MessageDetail["bodyFormat"] =
    raw.bodyIsHtml === true && typeof raw.body === "string" ? "html" : "markdown";
  return {
    id: str(raw.id),
    folderPath: str(raw.folderPath),
    subject: str(raw.subject, "(no subject)"),
    author: str(raw.author),
    recipients: str(raw.recipients),
    ccList: str(raw.ccList),
    date: str(raw.date),
    tags: strArray(raw.tags),
    body: stripContentMarkers(str(raw.body)),
    bodyFormat,
    attachments: mapAttachments(raw.attachments),
    authentication: mapAuthentication(raw.authentication as Record<string, unknown> | undefined),
    bodyTruncated: bool(raw.bodyTruncated),
    nextBodyOffset:
      typeof raw.nextBodyOffset === "number" && raw.nextBodyOffset > 0
        ? raw.nextBodyOffset
        : undefined,
    bodyTotalChars: typeof raw.bodyTotalChars === "number" ? raw.bodyTotalChars : undefined,
  };
}

/* ---- W2 drafts (Round 3, Stage 3): the addon's draft-save answer ---- */

function mapDraftResult(data: Record<string, unknown>): DraftResult {
  const result: DraftResult = { success: bool(data.success) };
  if (!result.success) {
    throw new BackendError(str(data.error) || "The draft could not be saved.");
  }
  if (typeof data.messageId === "string" && data.messageId) result.messageId = data.messageId;
  if (typeof data.folderPath === "string" && data.folderPath) result.folderPath = data.folderPath;
  for (const field of ["from", "to", "cc", "bcc", "subject", "warning"] as const) {
    const value = data[field];
    if (typeof value === "string" && value) result[field] = value;
  }
  return result;
}

/* The account color palette lives here so mock and real agree. */
export const ACCOUNT_PALETTE_SIZE = 6;

/* ---- Phase 4 mappers ---- */

function mapAddressBook(raw: Record<string, unknown>): AddressBook {
  return {
    id: str(raw.addressBookId),
    name: str(raw.name, "Address book"),
    readOnly: bool(raw.readOnly),
    isDefault: bool(raw.default),
  };
}

function mapContactLine(value: unknown, typeFallback: string): ContactLine[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null)
    .map((v) => ({
      type: str(v.type, typeFallback),
      value: str(v.value ?? v.number ?? v.address ?? [v.street, v.city, v.postalCode, v.country].filter(Boolean).join(", ")),
    }))
    .filter((line) => line.value !== "");
}

function mapContactSummary(raw: Record<string, unknown>): ContactSummary {
  const emails = mapContactLine(raw.emails, "email");
  return {
    id: str(raw.id),
    addressBookId: str(raw.addressBookId),
    displayName: str(raw.displayName ?? [raw.firstName, raw.lastName].filter(Boolean).join(" "), "(unnamed)"),
    email: str(raw.email) || emails[0]?.value || "",
    organization: str(raw.organization),
  };
}

function mapContactDetail(raw: Record<string, unknown>): ContactDetail {
  const base = mapContactSummary(raw);
  return {
    ...base,
    firstName: str(raw.firstName),
    lastName: str(raw.lastName),
    emails: mapContactLine(raw.emails, "email"),
    phones: mapContactLine(raw.phones, "phone"),
    addresses: mapContactLine(raw.addresses, "address"),
    title: str(raw.title),
    note: stripContentMarkers(str(raw.note)),
    birthday: str(raw.birthday),
    addressBookName: str(raw.addressBook, "Address book"),
  };
}

function mapCalendar(raw: Record<string, unknown>, index: number): CalendarInfo {
  return {
    id: str(raw.id),
    name: str(raw.name, "Calendar"),
    readOnly: bool(raw.readOnly),
    disabled: bool(raw.disabled),
    supportsEvents: raw.supportsEvents === undefined ? true : bool(raw.supportsEvents),
    supportsTasks: bool(raw.supportsTasks),
    colorIndex: index % ACCOUNT_PALETTE_SIZE,
  };
}

function mapEvent(raw: Record<string, unknown>): EventInfo {
  const start = str(raw.startDate ?? raw.start);
  const end = str(raw.endDate ?? raw.end);
  return {
    id: str(raw.id),
    calendarId: str(raw.calendarId),
    calendarName: str(raw.calendarName),
    title: stripContentMarkers(str(raw.title, "(untitled)")),
    startDate: start,
    endDate: end || start,
    // date-only (or midnight-to-midnight UTC) rows are all-day
    allDay: raw.allDay === undefined ? /T00:00:00/.test(start) && start === end : bool(raw.allDay),
    location: stripContentMarkers(str(raw.location)),
    isRecurring: bool(raw.isRecurring),
  };
}

function mapTask(raw: Record<string, unknown>): TaskInfo {
  return {
    id: str(raw.id),
    calendarId: str(raw.calendarId),
    title: stripContentMarkers(str(raw.title, "(untitled)")),
    dueDate: str(raw.dueDate),
    completed: bool(raw.completed),
    priority: typeof raw.priority === "number" ? raw.priority : undefined,
  };
}

/**
 * The default register view (no text, no scope, no filter) is bounded to the
 * last 14 days — an unbounded all-account search walks the whole ~10k-message
 * corpus (~2.5 s of header enumeration + per-row MIME decode on TB's main
 * thread, Round-2 deep-dive), while the date filter rejects rows before they
 * are built (~0.2 s). Explicit text/scope/filter queries keep full-corpus
 * behavior.
 *
 * The timestamp is floored to the hour so that identical arguments — and
 * therefore identical sidecar cache keys and /api/bootstrap `recent`
 * prewarm coverage — stay stable within the hour. KEEP THIS FORMULA IN SYNC
 * with `recentQueryArguments` in compose/tbweb/app/src/index.js.
 */
function recentQueryArguments(): string {
  return new Date(Math.floor((Date.now() - 14 * 86_400_000) / 3_600_000) * 3_600_000).toISOString();
}

/** Rows/envelope shared by searchMessages, getThread and bootstrap.recent. */
function mapSearchEnvelope(data: Record<string, unknown>, fallbackLimit: number): SearchResult {
  const rows = Array.isArray(data.messages)
    ? data.messages.filter((m): m is Record<string, unknown> => typeof m === "object" && m !== null)
    : [];
  return {
    messages: rows.map(mapSummary),
    totalMatches: num(data.totalMatches, rows.length),
    offset: num(data.offset),
    limit: num(data.limit, fallbackLimit),
    hasMore: bool(data.hasMore),
  };
}

/* ---- W1 organize (Round 3): the write tier ---- */

/** updateMessage takes one folderPath per call — group by source folder,
 *  and never more than 50 ids per call (addon + IMAP comfort limit). */
function groupByFolder(items: MessageRef[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const item of items) {
    const ids = groups.get(item.folderPath) ?? [];
    if (ids.length === 0) groups.set(item.folderPath, ids);
    if (!ids.includes(item.id)) ids.push(item.id);
  }
  return groups;
}

/** A moved+tagged single call can drop tags on IMAP copies; our UI never
 *  mixes the two, but keep the guard honest for future callers. */
function patchOf(patch: MessagePatch): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  if (patch.read !== undefined) args.read = patch.read;
  if (patch.flagged !== undefined) args.flagged = patch.flagged;
  if (patch.moveTo !== undefined) args.moveTo = patch.moveTo;
  return args;
}

/** Single-call per chunk limit; the addon handles up to a folder's worth,
 *  50 keeps each round-trip snappy on slow IMAP links. */
const UPDATE_CHUNK = 50;

/* ---- W2 drafts composer (Round 3, Stage 3) ----
 * All three calls file into the identity's Drafts folder — never sent.
 * Bodies pass as HTML (isHtml: true): the editor's output is the draft's
 * content. saveDraft keeps its format once created, so a plain-text draft
 * edited here would keep text format — Talaria drafts are HTML from the
 * first save, and updates carry keepQuote per call site (see below). */

/** Recipient header for a field — undefined fields are omitted entirely
 *  (the addon keeps omitted fields on the draftId update path). */
function recipientsHeader(recipients?: Recipient[]): string | undefined {
  if (recipients === undefined) return undefined;
  return recipients
    .filter((r) => r.email)
    .map((r) => (r.name && r.name !== r.email ? `${r.name} <${r.email}>` : r.email))
    .join(", ");
}

async function saveDraftCall(fields: DraftFields, draftId: string | undefined, keepQuote: boolean): Promise<DraftResult> {
  const to = recipientsHeader(fields.to);
  const cc = recipientsHeader(fields.cc);
  const bcc = recipientsHeader(fields.bcc);
  const data = await call<Record<string, unknown>>("saveDraft", {
    ...(to !== undefined ? { to } : {}),
    ...(cc !== undefined ? { cc } : {}),
    ...(bcc !== undefined ? { bcc } : {}),
    ...(fields.subject !== undefined ? { subject: fields.subject } : {}),
    ...(fields.body !== undefined ? { body: fields.body, isHtml: true } : {}),
    ...(fields.from ? { from: fields.from } : {}),
    // keepQuote true (default): with draftId the addon replaces only the
    // typed text and keeps cite line, quote and signature — the autosave
    // of a reply/forward draft. false: full body replace (WYSIWYG).
    ...(draftId ? { draftId, keepQuote } : {}),
  });
  return mapDraftResult(data);
}

async function replyDraftCall(target: ComposeTarget, fields: DraftFields, replyAll: boolean): Promise<DraftResult> {
  const data = await call<Record<string, unknown>>("replyToMessage", {
    messageId: target.id,
    folderPath: target.folderPath,
    body: fields.body ?? "",
    replyAll: replyAll || undefined,
    mode: "draft",
    isHtml: true,
    from: fields.from || undefined,
    to: recipientsHeader(fields.to) || undefined,
    cc: recipientsHeader(fields.cc) || undefined,
    bcc: recipientsHeader(fields.bcc) || undefined,
  });
  return mapDraftResult(data);
}

async function forwardDraftCall(target: ComposeTarget, fields: DraftFields): Promise<DraftResult> {
  const data = await call<Record<string, unknown>>("forwardMessage", {
    messageId: target.id,
    folderPath: target.folderPath,
    body: fields.body ?? "",
    mode: "draft",
    isHtml: true,
    from: fields.from || undefined,
    to: recipientsHeader(fields.to) || undefined,
    cc: recipientsHeader(fields.cc) || undefined,
    bcc: recipientsHeader(fields.bcc) || undefined,
  });
  return mapDraftResult(data);
}

export function createRealBackend(): MailBackend {
  const listeners = new Set<MailEventCallback>();
  let source: EventSource | null = null;

  /* ---- Stage 2: read-for-export (.eml source, attachment bytes) ---- */

  /** One-entry cache of the paged raw source: a mail with several
   *  attachments pages the source once, not once per attachment. */
  let rawCache: { key: string; bytes: Uint8Array } | null = null;

  /**
   * Page the message's raw RFC 2822 source (`getMessage rawSource`,
   * `rawEncoding: "base64"` for exact bytes — 200 000 chars max per call,
   * `bodyOffset` advances; with base64 every page starts and ends on a
   * 4-character group, so pages concatenate before one decode).
   */
  async function pagedRawSource(id: string, folderPath: string): Promise<Uint8Array> {
    const key = `${folderPath}\n${id}`;
    if (rawCache && rawCache.key === key) return rawCache.bytes;
    const chunks: string[] = [];
    let offset = 0;
    let guard = 0;
    while (guard++ < 250) {
      const data = await call<Record<string, unknown>>("getMessage", {
        messageId: id,
        folderPath,
        rawSource: true,
        rawEncoding: "base64",
        maxBodyChars: 200_000,
        ...(offset > 0 ? { bodyOffset: offset } : {}),
      });
      // The addon wraps free text — the raw source too — in <email-content>
      // markers; their TAG LETTERS are valid base64 alphabet, so they must be
      // unwrapped per page before stripping whitespace (learned live).
      chunks.push(
        stripContentMarkers(str(data.rawSource ?? data.body)).replace(/\s+/g, ""),
      );
      const next = typeof data.nextBodyOffset === "number" ? data.nextBodyOffset : undefined;
      if (!bool(data.bodyTruncated) || next === undefined || next <= offset) break;
      offset = next;
    }
    let joined = chunks.join("");
    // A trailing group of 1 can only come from a corrupt page — drop it.
    const overhang = joined.length % 4;
    if (overhang === 1) joined = joined.slice(0, -1);
    const bytes = base64ToBytes(joined);
    rawCache = { key, bytes };
    return bytes;
  }

  /* ---- browser web-push (Phase 4) ---- */

  function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
    const padding = "=".repeat((4 - (base64.length % 4)) % 4);
    const base64Url = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64Url);
    const output = new Uint8Array(new ArrayBuffer(raw.length));
    for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
    return output;
  }

  const push: PushBackend = {
    isSupported() {
      return (
        typeof window !== "undefined" &&
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window
      );
    },

    async getPublicKey() {
      try {
        const response = await fetch("/push/public-key");
        const payload = (await response.json()) as { ok?: boolean; publicKey?: string | null };
        return payload.ok ? (payload.publicKey ?? null) : null;
      } catch {
        return null;
      }
    },

    async currentState() {
      if (!push.isSupported() || Notification.permission === "denied") {
        return Notification.permission === "denied" ? "denied" : "off";
      }
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        return subscription ? "subscribed" : "off";
      } catch {
        return "off";
      }
    },

    async enable() {
      if (!push.isSupported()) return "error";
      const key = await push.getPublicKey();
      if (!key) return "error";
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return permission === "denied" ? "denied" : "error";
      try {
        const registration = await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();
        const subscription =
          existing ??
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(key),
          }));
        const response = await fetch("/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(subscription.toJSON()),
        });
        if (!response.ok) return "error";
        return "subscribed";
      } catch {
        return "error";
      }
    },

    async disable() {
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        if (subscription) {
          await fetch("/push/unsubscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: subscription.endpoint }),
          });
          await subscription.unsubscribe();
        }
      } catch {
        /* a failed unsubscribe leaves the UI state as-is; the next toggle retries */
      }
    },
  };

  return {
    kind: "real",

    async listAccounts() {
      const data = await call<unknown>("listAccounts");
      const list = Array.isArray(data)
        ? data.filter((a): a is Record<string, unknown> => typeof a === "object" && a !== null)
        : [];
      return list.map((a, i) => mapAccount(a, i));
    },

    async listFolders(accountId) {
      const args: Record<string, unknown> = {};
      if (accountId) args.accountId = accountId;
      const data = await call<unknown>("listFolders", args);
      const list = Array.isArray(data)
        ? data.filter((f): f is Record<string, unknown> => typeof f === "object" && f !== null)
        : [];
      return list.map(mapFolder);
    },

    async searchMessages(query: MessageQuery): Promise<SearchResult> {
      const args: Record<string, unknown> = {
        query: query.text ?? "",
        maxResults: query.maxResults ?? 50,
        offset: query.offset ?? 0,
        fields: [...ROW_FIELDS],
      };
      if (query.scopeFolder) args.folderPath = query.scopeFolder;
      if (query.unreadOnly) args.unreadOnly = true;
      if (query.flaggedOnly) args.flaggedOnly = true;
      const isDefaultView = !query.text && !query.scopeFolder && !query.unreadOnly && !query.flaggedOnly;
      if (isDefaultView) args.startDate = recentQueryArguments();
      const data = await call<Record<string, unknown>>("searchMessages", args);
      return mapSearchEnvelope(data, query.maxResults ?? 50);
    },

    /**
     * One call for the whole boot (Round-2 perf): GET /api/bootstrap
     * assembles accounts + folders + the recent first page + the global
     * unread from the sidecar's TTL cache — mapped here with the exact
     * mappers the individual calls use, so stores can't tell the paths
     * apart.
     */
    async getBootstrap(): Promise<BootstrapData> {
      let response: Response;
      try {
        response = await fetch("/api/bootstrap");
      } catch {
        throw new BackendError("The sidecar is unreachable from here.", true);
      }
      if (response.status === 502 || response.status === 503) {
        throw new BackendError("The sidecar cannot reach Thunderbird right now.", true);
      }
      let payload: Record<string, unknown>;
      try {
        payload = (await response.json()) as Record<string, unknown>;
      } catch {
        throw new BackendError(`Bootstrap answered HTTP ${response.status} with no JSON.`, true);
      }
      if (!payload.ok) {
        throw new BackendError(str(payload.error) || "The bootstrap call failed on the sidecar.");
      }
      const list = (value: unknown): Record<string, unknown>[] =>
        Array.isArray(value)
          ? value.filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null)
          : [];
      const recent = payload.recent && typeof payload.recent === "object"
        ? mapSearchEnvelope(payload.recent as Record<string, unknown>, 50)
        : { messages: [], totalMatches: 0, offset: 0, limit: 50, hasMore: false };
      return {
        accounts: list(payload.accounts).map((a, i) => mapAccount(a, i)),
        folders: list(payload.folders).map(mapFolder),
        recent,
        unread: typeof payload.unread === "number" && Number.isFinite(payload.unread) ? payload.unread : null,
        generatedAt: str(payload.generatedAt, new Date().toISOString()),
      };
    },

    async getMessage(id, folderPath) {
      // HTML bodies come through raw (bodyIsHtml → bodyFormat "html") so the
      // reader's sanitizer can see remote images for the consent gate — the
      // server-side markdown conversion silently drops them.
      const data = await call<Record<string, unknown>>("getMessage", {
        messageId: id,
        folderPath,
        bodyFormat: "html",
        maxBodyChars: 200_000,
      });
      return mapDetail(data);
    },

    async getThread(id, folderPath): Promise<SearchResult> {
      // threadOf is cross-folder: the answer carries rows from INBOX and Sent
      // alike. The query is required by the tool even for a pure thread read.
      const data = await call<Record<string, unknown>>("searchMessages", {
        query: "",
        threadOf: { messageId: id, folderPath },
        maxResults: 50,
        fields: [...ROW_FIELDS],
      });
      return mapSearchEnvelope(data, 50);
    },

    async getMessages(items): Promise<MessageDetail[]> {
      // getMessages reads up to 10 records per call; chunk the list.
      const details: MessageDetail[] = [];
      for (let i = 0; i < items.length; i += 10) {
        const slice = items.slice(i, i + 10);
        const data = await call<Record<string, unknown>>("getMessages", {
          messages: slice.map((item) => ({ messageId: item.id, folderPath: item.folderPath })),
          bodyFormat: "markdown",
          maxBodyChars: 60_000,
        });
        const rows = Array.isArray(data?.messages) ? data.messages : [];
        for (const row of rows) {
          if (typeof row === "object" && row !== null && !("error" in row)) {
            details.push(mapDetail(row as Record<string, unknown>));
          }
        }
      }
      return details;
    },

    async getMessageBodyChunk(id, folderPath, offset): Promise<BodyChunk> {
      // Same format as getMessage (html) so continuation chunks splice into
      // the cached body without a format seam.
      const data = await call<Record<string, unknown>>("getMessage", {
        messageId: id,
        folderPath,
        bodyFormat: "html",
        maxBodyChars: 200_000,
        bodyOffset: offset,
      });
      return {
        text: stripContentMarkers(str(data.body)),
        nextBodyOffset:
          typeof data.nextBodyOffset === "number" && data.nextBodyOffset > offset
            ? data.nextBodyOffset
            : undefined,
        bodyTruncated: bool(data.bodyTruncated),
      };
    },

    async getMessageSource(id, folderPath): Promise<MessageSource> {
      return { bytes: await pagedRawSource(id, folderPath) };
    },

    async getAttachment(id, folderPath, attachment): Promise<AttachmentPayload> {
      const raw = bytesToText(await pagedRawSource(id, folderPath));
      const bytes = extractAttachment(raw, attachment.name);
      if (!bytes) {
        throw new BackendError(
          `The attachment “${attachment.name}” could not be extracted from this message — open it in Thunderbird.`,
        );
      }
      return { bytes };
    },

    /* ---- W1 organize (Round 3) ---- */

    async updateMessages(items, patch): Promise<UpdateResult> {
      const patchArgs = patchOf(patch);
      if (Object.keys(patchArgs).length === 0) return { updated: 0, notFound: [] };
      let updated = 0;
      const notFound: string[] = [];
      let warning: string | undefined;
      for (const [folderPath, ids] of groupByFolder(items)) {
        for (let i = 0; i < ids.length; i += UPDATE_CHUNK) {
          const chunk = ids.slice(i, i + UPDATE_CHUNK);
          const data = await call<Record<string, unknown>>("updateMessage", {
            folderPath,
            messageIds: chunk,
            ...patchArgs,
          });
          if (bool(data.success)) {
            updated += num(data.updated);
            if (Array.isArray(data.notFound)) {
              notFound.push(...data.notFound.filter((n): n is string => typeof n === "string"));
            }
            const warn = str(data.warning);
            if (warn) warning = warning ? `${warning} ${warn}` : warn;
          } else {
            throw new BackendError(str(data.error) || `The update of ${chunk.length} message(s) failed.`);
          }
        }
      }
      return { updated, notFound, warning: warning || undefined };
    },

    async createFolder(parentPath, name): Promise<CreateFolderResult> {
      const data = await call<Record<string, unknown>>("createFolder", {
        parentFolderPath: parentPath,
        name,
      });
      if (!bool(data.success)) {
        throw new BackendError(str(data.error) || "The folder could not be created.");
      }
      return { name, path: typeof data.path === "string" ? data.path : null };
    },

    /* ---- W2 drafts composer (Round 3, Stage 3) ---- */

    async saveDraft(fields: DraftFields, draftId?: string, keepQuote = true): Promise<DraftResult> {
      return saveDraftCall(fields, draftId, keepQuote);
    },

    async replyDraft(target: ComposeTarget, fields: DraftFields, replyAll: boolean): Promise<DraftResult> {
      return replyDraftCall(target, fields, replyAll);
    },

    async forwardDraft(target: ComposeTarget, fields: DraftFields): Promise<DraftResult> {
      return forwardDraftCall(target, fields);
    },

    /**
     * Whether the add-on actually serves the draft tier (saveDraft +
     * replyToMessage + forwardMessage enabled). One POST /api/tools/list,
     * asked lazily once per session — the honest gate for the composer
     * entry points (a rolled-back add-on hides them instead of erroring).
     */
    async hasComposeTools(): Promise<boolean> {
      let response: Response;
      try {
        response = await fetch("/api/tools/list", { method: "POST" });
      } catch {
        return false;
      }
      try {
        const payload = (await response.json()) as { ok?: boolean; data?: { tools?: Array<{ name?: unknown }> } };
        const names = (payload.data?.tools ?? [])
          .map((t) => (typeof t?.name === "string" ? t.name : ""))
          .filter(Boolean);
        return ["saveDraft", "replyToMessage", "forwardMessage"].every((name) => names.includes(name));
      } catch {
        return false;
      }
    },

    async listAddressBooks() {
      const data = await call<unknown>("listAddressBooks");
      const list = Array.isArray(data)
        ? data.filter((b): b is Record<string, unknown> => typeof b === "object" && b !== null)
        : [];
      return list.map(mapAddressBook);
    },

    async searchContacts(query, offset = 0): Promise<ContactSearchResult> {
      const args: Record<string, unknown> = { query: query ?? "", maxResults: 50 };
      if (offset > 0) args.offset = offset;
      const data = await call<Record<string, unknown>>("searchContacts", args);
      const rows = Array.isArray(data.contacts)
        ? data.contacts.filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
        : [];
      return {
        contacts: rows.map(mapContactSummary),
        hasMore: bool(data.hasMore),
        nextOffset: typeof data.nextOffset === "number" ? data.nextOffset : undefined,
      };
    },

    async getContact(id) {
      const data = await call<Record<string, unknown>>("getContact", { contactId: id });
      return mapContactDetail(data);
    },

    async listCalendars() {
      const data = await call<unknown>("listCalendars");
      const list = Array.isArray(data)
        ? data.filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
        : [];
      return list.map((c, i) => mapCalendar(c, i));
    },

    async listEvents(range): Promise<EventInfo[]> {
      const data = await call<unknown>("listEvents", {
        startDate: range.start,
        endDate: range.end,
        maxResults: 100,
      });
      const list = Array.isArray(data)
        ? data.filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null)
        : [];
      return list.map(mapEvent);
    },

    async listTasks(): Promise<TaskInfo[]> {
      const data = await call<unknown>("listTasks", { maxResults: 200 });
      const list = Array.isArray(data)
        ? data.filter((t): t is Record<string, unknown> => typeof t === "object" && t !== null)
        : [];
      return list.filter((t) => !bool(t.completed)).map(mapTask);
    },

    async getHealth(): Promise<HealthInfo> {
      const response = await fetch("/api/health");
      if (!response.ok) {
        return { ok: false };
      }
      return (await response.json()) as HealthInfo;
    },

    onMailEvent(callback: MailEventCallback) {
      listeners.add(callback);
      if (!source) {
        source = new EventSource("/events");
        source.addEventListener("hello", (event) => {
          // The sidecar's authoritative global unread seeds the folio at
          // connect time (folder tallies alone would undercount until the
          // first mail event). `isHello` lets the store skip the refresh
          // burst — a hello is not a change (Round-2 perf).
          try {
            const payload = JSON.parse((event as MessageEvent).data) as MailEvent;
            for (const listener of listeners) {
              listener({
                unread: payload.unread,
                previous: payload.unread,
                ts: payload.ts,
                isHello: true,
              });
            }
          } catch {
            /* malformed hello — the next mail event re-syncs us */
          }
        });
        source.addEventListener("mail", (event) => {
          try {
            const payload = JSON.parse((event as MessageEvent).data) as MailEvent;
            for (const listener of listeners) listener(payload);
          } catch {
            /* a malformed event is dropped; the next one re-syncs us */
          }
        });
        // The server sends `retry:` and reconnects automatically.
      }
      return () => {
        listeners.delete(callback);
        if (listeners.size === 0 && source) {
          source.close();
          source = null;
        }
      };
    },

    push,

    dispose() {
      source?.close();
      source = null;
      listeners.clear();
    },
  };
}
