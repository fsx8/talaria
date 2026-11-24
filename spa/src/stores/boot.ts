/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The boot snapshot (Round-2 perf): the server state a repeat visit needs
 * to render the shell instantly — accounts, folders, the recent first page
 * and the global unread — persisted in localStorage and re-validated by
 * `GET /api/bootstrap` right after mount.
 *
 * Deliberate decision (recorded in tb-webclient-build-plan.md § Round 2):
 * a hand-rolled snapshot, NOT `@tanstack/vue-query` — no new dependency,
 * and Pinia stays the sole owner of server state. The sidecar's bootstrap
 * answer carries its own freshness (`generatedAt` = the oldest cache
 * ingredient), so a snapshot older than the sidecar's answer triggers a
 * quiet background refetch; `refreshSeq` remains the single ordering guard
 * for every in-flight query.
 */

import type { Account, Folder, SearchResult } from "../api/types";
import { useAccountsStore } from "./accounts";
import { useMailStore } from "./mail";

export interface BootSnapshot {
  version: 1;
  accounts: Account[];
  foldersByAccount: Record<string, Folder[]>;
  /** The default register view's first page (exactly what `refresh()` loads). */
  recent: SearchResult;
  unread: number | null;
  /** When this snapshot was last written from successful server data. */
  generatedAt: string;
}

const STORAGE_KEY = "talaria.boot";
const MAX_BYTES = 1_500_000; // 50 rows + ~230 folders ≈ 60 KB; the cap only guards pathological data
const PERSIST_DEBOUNCE_MS = 400;

/** Validated read — a corrupt or foreign snapshot is simply no snapshot. */
export function loadBootSnapshot(): BootSnapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BootSnapshot> | null;
    if (!parsed || parsed.version !== 1) return null;
    if (!Array.isArray(parsed.accounts) || !isFolderMap(parsed.foldersByAccount)) return null;
    if (!isSearchResult(parsed.recent)) return null;
    const generatedAt = typeof parsed.generatedAt === "string" ? parsed.generatedAt : "";
    if (!generatedAt || Number.isNaN(Date.parse(generatedAt))) return null;
    return {
      version: 1,
      accounts: parsed.accounts.filter((a): a is Account => isAccount(a)),
      foldersByAccount: parsed.foldersByAccount,
      recent: parsed.recent,
      unread: typeof parsed.unread === "number" ? parsed.unread : null,
      generatedAt,
    };
  } catch {
    return null;
  }
}

/** Collect the current server state from the stores and persist it. */
export function persistBootSnapshot(): void {
  const accounts = useAccountsStore();
  const mail = useMailStore();
  const snapshot: BootSnapshot = {
    version: 1,
    accounts: accounts.accounts,
    foldersByAccount: accounts.foldersByAccount,
    recent: {
      messages: mail.messages,
      totalMatches: mail.totalMatches,
      offset: 0,
      limit: mail.pageSize,
      hasMore: mail.hasMore,
    },
    unread: mail.lastMailEvent?.unread ?? null,
    generatedAt: new Date().toISOString(),
  };
  try {
    const raw = JSON.stringify(snapshot);
    if (raw.length <= MAX_BYTES) localStorage.setItem(STORAGE_KEY, raw);
  } catch {
    /* storage unavailable (private mode, quota) — the app boots un-snapshotted */
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced persist — refresh + tally refresh can land within one tick. */
export function scheduleBootSnapshotPersist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistBootSnapshot();
  }, PERSIST_DEBOUNCE_MS);
}

export function clearBootSnapshot(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/* ---- shape guards (never trust storage) ---- */

function isAccount(value: unknown): value is Account {
  return typeof value === "object" && value !== null && typeof (value as Account).id === "string";
}

function isFolder(value: unknown): value is Folder {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Folder).path === "string" &&
    typeof (value as Folder).accountId === "string"
  );
}

function isFolderMap(value: unknown): value is Record<string, Folder[]> {
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value).every(
    (folders) => Array.isArray(folders) && folders.every(isFolder),
  );
}

function isSearchResult(value: unknown): value is SearchResult {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as SearchResult).messages) &&
    (value as SearchResult).messages.every(
      (m) => typeof m === "object" && m !== null && typeof m.id === "string" && typeof m.folderPath === "string",
    )
  );
}
