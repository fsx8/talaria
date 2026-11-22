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
  BackendKind,
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

/** Where the body of a truncated message continues (`bodyOffset` paging). */
export interface BodyChunk {
  text: string;
  nextBodyOffset?: number;
  bodyTruncated: boolean;
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
  listAddressBooks(): Promise<AddressBook[]>;
  searchContacts(query: string, offset?: number): Promise<ContactSearchResult>;
  getContact(id: string): Promise<ContactDetail>;
  listCalendars(): Promise<CalendarInfo[]>;
  /** Events in a start/end ISO range (inclusive), recurring already expanded. */
  listEvents(range: { start: string; end: string }): Promise<EventInfo[]>;
  /** Open (incomplete) tasks; the docked agenda only needs the count. */
  listTasks(): Promise<TaskInfo[]>;
  getHealth(): Promise<HealthInfo>;
  /** Subscribe to new-mail events; returns an unsubscribe function. */
  onMailEvent(callback: MailEventCallback): () => void;
  /** Present only when the backend can actually deliver browser push. */
  push?: PushBackend;
  dispose?(): void;
}
