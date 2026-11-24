/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The seam (Bulwark pattern): everything above this file — Pinia stores,
 * components — talks to a MailBackend and nothing else. Swapping the live
 * sidecar for the seeded demo register is one env var, never a component
 * change.
 */

import type {
  Account,
  AddressBook,
  AttachmentInfo,
  BackendKind,
  BootstrapData,
  CalendarInfo,
  ContactDetail,
  ContactSearchResult,
  EventInfo,
  Folder,
  HealthInfo,
  MailEventCallback,
  MessageDetail,
  MessageQuery,
  SearchResult,
  TaskInfo,
} from "./types";

/** One organized message: the record plus the folder it currently sits in. */
export interface MessageRef {
  id: string;
  folderPath: string;
}

/** What to change about the referenced messages (W1 organize tier). */
export interface MessagePatch {
  /** Set read (true) or unread (false). */
  read?: boolean;
  /** Set flag (true) or clear it (false). */
  flagged?: boolean;
  /** File the messages into this folder URI (from listFolders). */
  moveTo?: string;
}

/** Result of an updateMessage round-trip (addon payload, defensively mapped). */
export interface UpdateResult {
  /** How many of the referenced messages the addon reports touched. */
  updated: number;
  /** IDs the addon could not find (already moved, expunged…). */
  notFound: string[];
  /** Addon warnings (e.g. IMAP tag/move ordering) — surfaced in toasts. */
  warning?: string;
}

/** Result of createFolder — `path` is null while an IMAP server catches up. */
export interface CreateFolderResult {
  name: string;
  path: string | null;
}

/** Where the body of a truncated message continues (`bodyOffset` paging). */
export interface BodyChunk {
  text: string;
  nextBodyOffset?: number;
  bodyTruncated: boolean;
}

/** Exact bytes of the message's raw RFC 2822 source (.eml export). */
export interface MessageSource {
  bytes: Uint8Array;
}

/** Exact bytes of one attachment, ready for a Blob download. */
export interface AttachmentPayload {
  bytes: Uint8Array;
}

/* ---- W2 drafts composer (Round 3, Stage 3) ---- */

/** Result of a draft save (addon payload, defensively mapped). The addon
 *  answers `{success, messageId, folderPath, message?}` — messageId is the
 *  saved draft's id (usable as `draftId` for updates), folderPath the
 *  identity's Drafts folder URI. Reply/forward drafts also carry the
 *  authoritative from/to/cc/bcc/replyTo and subject Thunderbird computed. */
export interface DraftResult {
  success: boolean;
  /** The saved draft's message id — pass as `draftId` to update it. */
  messageId?: string;
  /** The Drafts folder URI the draft was filed under. */
  folderPath?: string;
  /** Authoritative recipients/subject of the saved draft (reply/forward). */
  from?: string;
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  /** Addon warning (e.g. an old draft version that could not be removed). */
  warning?: string;
}

/** One recipient line of the composer, parsed from "Name <addr>". */
export interface Recipient {
  name: string;
  email: string;
}

/** The composer fields a draft save carries. `to`/`cc`/`bcc` are joined
 *  comma-separated on the wire; body HTML passes as-is (isHtml: true) —
 *  what the editor shows is exactly what the draft stores. On the draftId
 *  update path an undefined field is OMITTED from the call, which the addon
 *  reads as "keep what the draft has" (the subject-only rewrite relies on
 *  this: it must not touch Thunderbird's computed recipients or body). */
export interface DraftFields {
  from?: string;
  to?: Recipient[];
  cc?: Recipient[];
  bcc?: Recipient[];
  subject?: string;
  body?: string;
}

/** A reference to the message being replied to / forwarded. */
export interface ComposeTarget {
  id: string;
  folderPath: string;
}

/**
 * Browser web-push plumbing. Only the real backend provides it — in mock
 * mode the UI hides the push control entirely (there is nothing to subscribe
 * to). All methods resolve to `null`/false-y values instead of throwing when
 * the sidecar or the browser lacks the capability.
 */
export interface PushBackend {
  /** The sidecar's VAPID public key, or null when push is unconfigured. */
  getPublicKey(): Promise<string | null>;
  /** Whether this browser can subscribe at all (service worker + pushManager). */
  isSupported(): boolean;
  /** Current permission + subscription state, resolved without prompting. */
  currentState(): Promise<"off" | "subscribed" | "denied">;
  /** Ask permission, subscribe via the SW pushManager, POST to the sidecar. */
  enable(): Promise<"subscribed" | "denied" | "error">;
  /** Unsubscribe in the browser and drop the record server-side. */
  disable(): Promise<void>;
}

export interface MailBackend {
  readonly kind: BackendKind;
  listAccounts(): Promise<Account[]>;
  /** Folders of one account, or every account when `accountId` is null. */
  listFolders(accountId: string | null): Promise<Folder[]>;
  searchMessages(query: MessageQuery): Promise<SearchResult>;
  getMessage(id: string, folderPath: string): Promise<MessageDetail>;
  /** The full conversation a message belongs to (flat, chronological-ready). */
  getThread(id: string, folderPath: string): Promise<SearchResult>;
  /** Batch-read full records; per-item failures are tolerated. */
  getMessages(items: Array<{ id: string; folderPath: string }>): Promise<MessageDetail[]>;
  /** Fetch the continuation of a truncated body (`bodyOffset` paging). */
  getMessageBodyChunk(id: string, folderPath: string, offset: number): Promise<BodyChunk>;
  /* ---- Stage 2: read-for-export tier (no server-side write, no new tools) ----
   * Both methods page the addon's `getMessage rawSource` answer client-side;
   * present only when the backend can serve it (real sidecar + honest mock).
   * Components hide export/download affordances when absent. */
  /** The full raw RFC 2822 source of one message (.eml export). */
  getMessageSource?(id: string, folderPath: string): Promise<MessageSource>;
  /** One attachment's exact bytes (extracted from the raw source). */
  getAttachment?(id: string, folderPath: string, attachment: AttachmentInfo): Promise<AttachmentPayload>;
  listAddressBooks(): Promise<AddressBook[]>;
  searchContacts(query: string, offset?: number): Promise<ContactSearchResult>;
  getContact(id: string): Promise<ContactDetail>;
  listCalendars(): Promise<CalendarInfo[]>;
  /** Events in a start/end ISO range (inclusive), recurring already expanded. */
  listEvents(range: { start: string; end: string }): Promise<EventInfo[]>;
  /** Open (incomplete) tasks; the docked agenda only needs the count. */
  listTasks(): Promise<TaskInfo[]>;
  /**
   * One-call boot (Round-2 perf): accounts + folders + recent first page +
   * global unread from the sidecar's cache. Optional — backends without it
   * boot through the individual calls instead (mock backend, legacy sidecar).
   */
  getBootstrap?(): Promise<BootstrapData>;
  /* ---- W1 organize (Round 3): optional write tier ----
   * Present only when the backend can write; components hide the controls
   * when absent. Every method is reversible by design — no send, no draft,
   * no delete crosses this seam (the server-side disabledTools list is the
   * hard boundary; the mock implements the same three moves in memory). */
  /** Set read/flag on, or move, one or more messages. Batched ≤ 50 ids per call. */
  updateMessages?(items: MessageRef[], patch: MessagePatch): Promise<UpdateResult>;
  /** Create a subfolder under `parentPath`; `path` is null until IMAP confirms. */
  createFolder?(parentPath: string, name: string): Promise<CreateFolderResult>;
  /* ---- W2 drafts composer (Round 3, Stage 3) ----
   * Draft-only: every path files into the identity's Drafts folder. There is
   * deliberately no send — `sendMail` stays disabled server-side, and the
   * addon's own skipReview block refuses mode "send" behind these tools.
   * Present only when the backend can save drafts; components hide the
   * composer when absent. */
  /** Save (or, with draftId, rewrite) a draft in the identity's Drafts folder.
   *  `keepQuote` only applies with draftId: false replaces the whole body
   *  (WYSIWYG), true replaces just the typed text and keeps Thunderbird's
   *  cite line, quote and signature (autosave of reply/forward drafts). */
  saveDraft?(fields: DraftFields, draftId?: string, keepQuote?: boolean): Promise<DraftResult>;
  /** Save a reply to a message as a draft (replyAll widens the recipients). */
  replyDraft?(target: ComposeTarget, fields: DraftFields, replyAll: boolean): Promise<DraftResult>;
  /** Save a forward of a message as a draft (original content + attachments added by Thunderbird). */
  forwardDraft?(target: ComposeTarget, fields: DraftFields): Promise<DraftResult>;
  /** Whether the backend actually serves the draft tier (lazy probe, cached by the caller). */
  hasComposeTools?(): Promise<boolean>;
  getHealth(): Promise<HealthInfo>;
  /** Subscribe to new-mail events; returns an unsubscribe function. */
  onMailEvent(callback: MailEventCallback): () => void;
  /** Present only when the backend can actually deliver browser push. */
  push?: PushBackend;
  dispose?(): void;
}
