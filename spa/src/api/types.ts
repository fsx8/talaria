/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Talaria domain types — the vocabulary of the UI, deliberately independent
 * of the wire format the sidecar speaks. `api/real-backend.ts` maps the
 * sidecar's tool payloads onto these; `api/mock-backend.ts` fabricates them
 * directly. Stores and components only ever see this file.
 */

export type BackendKind = "mock" | "real";

export interface AccountIdentity {
  id: string;
  email: string;
  name: string;
  isDefault: boolean;
}

export interface Account {
  /** Stable backend id (sidecar accountId, e.g. "account1"). */
  id: string;
  /** Human label shown in the register rail. */
  label: string;
  /** Primary address (first default identity, falling back to account name). */
  email: string;
  /** Backend account type — "imap", "pop3", "local", … informational only. */
  type: string;
  /** Stable color index for the account chip (from a fixed palette). */
  colorIndex: number;
  identities: AccountIdentity[];
}

export type FolderKind =
  | "inbox"
  | "sent"
  | "drafts"
  | "trash"
  | "junk"
  | "archive"
  | "outbox"
  | "folder"
  | "savedsearch";

export interface Folder {
  /** The sidecar's folder URI — the stable key used by every folder-scoped call. */
  path: string;
  name: string;
  kind: FolderKind;
  accountId: string;
  total: number;
  unread: number;
  depth: number;
  favorite: boolean;
}

/** One row of the register page (a message list line). */
export interface MessageSummary {
  id: string;
  folderPath: string;
  subject: string;
  /** Raw "Name <addr>" form; components parse it for display. */
  author: string;
  recipients: string;
  ccList: string;
  /** ISO 8601 date string as returned by the backend. */
  date: string;
  read: boolean;
  flagged: boolean;
  tags: string[];
  /** Truncated plain-text preview; always rendered as text, never as HTML. */
  preview: string;
  /** True only when the backend can tell us; absent rows simply show nothing. */
  hasAttachments?: boolean;
}

export interface AuthResult {
  result: string;
  domain?: string;
  /** DKIM selector, when the backend reports one. */
  selector?: string;
}

export interface MessageAuthentication {
  authservId?: string;
  spf?: AuthResult;
  /** DKIM can carry several signatures. */
  dkim?: AuthResult[];
  dmarc?: AuthResult;
}

export interface AttachmentInfo {
  name: string;
  /** Byte size when known. */
  size?: number;
  contentType?: string;
  part?: string;
}

/** The full record sheet for one message. */
export interface MessageDetail {
  id: string;
  folderPath: string;
  subject: string;
  author: string;
  recipients: string;
  ccList: string;
  date: string;
  tags: string[];
  /** Markdown (preferred) or plain text body, already converted server-side. */
  body: string;
  bodyFormat: "markdown" | "text";
  attachments: AttachmentInfo[];
  authentication?: MessageAuthentication;
  bodyTruncated: boolean;
  /** Offset to pass to continue a truncated body, when present. */
  nextBodyOffset?: number;
  bodyTotalChars?: number;
}

export interface SearchResult {
  messages: MessageSummary[];
  totalMatches: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

/** What the user expressed in the list pane; backends translate this. */
export interface MessageQuery {
  /** Free text — search operators (from:, subject:, participant:@domain, …)
   *  pass through untouched for the sidecar to interpret. */
  text: string;
  unreadOnly?: boolean;
  flaggedOnly?: boolean;
  /** Folder URI to scope to (with subfolders); null = whole register. */
  scopeFolder?: string | null;
  maxResults?: number;
  offset?: number;
}

/** SSE `mail` event payload from the sidecar. */
export interface MailEvent {
  unread: number;
  previous: number;
  ts: string;
}

export interface HealthInfo {
  ok: boolean;
  commonpost?: {
    reachable: boolean;
    port?: number;
    serverInfo?: { name?: string; version?: string };
  };
  uptime?: number;
}

/** A synthetic demo arrival announced by the mock backend. */
export type MailEventCallback = (event: MailEvent) => void;

/* ---- Phase 4: contacts ---- */

export interface AddressBook {
  id: string;
  name: string;
  readOnly: boolean;
  isDefault: boolean;
}

/** A row of the contacts register; `searchContacts` returns these. */
export interface ContactSummary {
  id: string;
  addressBookId: string;
  displayName: string;
  /** Primary email, when the contact carries one. */
  email: string;
  organization: string;
}

/** One typed line of a contact card (email / phone / address). */
export interface ContactLine {
  type: string;
  value: string;
}

/** The full record card for one contact (`getContact`). */
export interface ContactDetail extends ContactSummary {
  firstName: string;
  lastName: string;
  emails: ContactLine[];
  phones: ContactLine[];
  addresses: ContactLine[];
  title: string;
  note: string;
  birthday: string;
  addressBookName: string;
}

export interface ContactSearchResult {
  contacts: ContactSummary[];
  hasMore: boolean;
  nextOffset?: number;
}

/* ---- Phase 4: agenda ---- */

export interface CalendarInfo {
  id: string;
  name: string;
  readOnly: boolean;
  disabled: boolean;
  supportsEvents: boolean;
  supportsTasks: boolean;
  /** Stable hue-chip index (from the fixed palette; TB colors are not exposed). */
  colorIndex: number;
}

export interface EventInfo {
  id: string;
  calendarId: string;
  calendarName: string;
  title: string;
  /** ISO 8601; date-only strings mean all-day. */
  startDate: string;
  endDate: string;
  allDay: boolean;
  location: string;
  /** True when this row is an occurrence of a recurring series. */
  isRecurring: boolean;
}

export interface TaskInfo {
  id: string;
  calendarId: string;
  title: string;
  dueDate: string;
  completed: boolean;
  priority?: number;
}
