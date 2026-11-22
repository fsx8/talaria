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
  BodyChunk,
  PushBackend,
} from "./backend-interface";
import type {
  Account,
  AddressBook,
  AttachmentInfo,
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
  const bodyFormat = raw.bodyIsHtml === true && typeof raw.body === "string"
    ? "text" // html bodies arrive converted server-side when we ask for markdown
    : "markdown";
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

export function createRealBackend(): MailBackend {
  const listeners = new Set<MailEventCallback>();
  let source: EventSource | null = null;

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
      const data = await call<Record<string, unknown>>("searchMessages", args);
      const rows = Array.isArray(data.messages)
        ? data.messages.filter((m): m is Record<string, unknown> => typeof m === "object" && m !== null)
        : [];
      return {
        messages: rows.map(mapSummary),
        totalMatches: num(data.totalMatches, rows.length),
        offset: num(data.offset),
        limit: num(data.limit, query.maxResults ?? 50),
        hasMore: bool(data.hasMore),
      };
    },

    async getMessage(id, folderPath) {
      const data = await call<Record<string, unknown>>("getMessage", {
        messageId: id,
        folderPath,
        bodyFormat: "markdown",
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
      const rows = Array.isArray(data.messages)
        ? data.messages.filter((m): m is Record<string, unknown> => typeof m === "object" && m !== null)
        : [];
      return {
        messages: rows.map(mapSummary),
        totalMatches: num(data.totalMatches, rows.length),
        offset: num(data.offset),
        limit: num(data.limit, 50),
        hasMore: bool(data.hasMore),
      };
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
      const data = await call<Record<string, unknown>>("getMessage", {
        messageId: id,
        folderPath,
        bodyFormat: "markdown",
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
          // first mail event).
          try {
            const payload = JSON.parse((event as MessageEvent).data) as MailEvent;
            for (const listener of listeners) {
              listener({ unread: payload.unread, previous: payload.unread, ts: payload.ts });
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
