/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { defineStore } from "pinia";
import { getBackend } from "../api";
import type { Account, BootstrapData, Folder } from "../api/types";
import { useMailStore } from "./mail";
import { useSettingsStore } from "./settings";
import { scheduleBootSnapshotPersist } from "./boot";

/**
 * The register rail: accounts with their color chips, folders with their
 * unread tallies, and the scope the list pane is currently filed under.
 * Stage 2 adds per-account visibility: hidden accounts drop out of the rail,
 * the folder tree, the tallies and the register — client-side only (the
 * backend keeps indexing them; the sidecar's global folio still counts them).
 */

export const useAccountsStore = defineStore("accounts", {
  state: () => ({
    accounts: [] as Account[],
    foldersByAccount: {} as Record<string, Folder[]>,
    selectedAccountId: null as string | null,
    /** null = the whole register (all accounts, server skips Trash/Junk). */
    scopeFolder: null as string | null,
    loading: false,
    error: null as string | null,
  }),

  getters: {
    selectedAccount(state): Account | null {
      return state.accounts.find((a) => a.id === state.selectedAccountId) ?? null;
    },
    /** Accounts that pass the per-account visibility filter (Stage 2). */
    visibleAccounts(state): Account[] {
      const hidden = new Set(useSettingsStore().hiddenAccountIds);
      if (hidden.size === 0) return state.accounts;
      const visible = state.accounts.filter((a) => !hidden.has(a.id));
      // Guardrail backstop: never blank the rail entirely (e.g. a stale
      // settings snapshot naming accounts that no longer exist).
      return visible.length > 0 ? visible : state.accounts;
    },
    /** folderPath → accountId, visible accounts only (register filtering). */
    visibleFolderPathAccount(state): Map<string, string> {
      const map = new Map<string, string>();
      for (const account of this.visibleAccounts) {
        for (const folder of state.foldersByAccount[account.id] ?? []) {
          if (!map.has(folder.path)) map.set(folder.path, account.id);
        }
      }
      return map;
    },
    /** The account a folder URI belongs to (visible accounts only), or null. */
    accountOfFolder(): ((folderPath: string) => string | null) {
      const map = this.visibleFolderPathAccount;
      return (folderPath: string): string | null => {
        let best: string | null = null;
        let bestLen = -1;
        for (const [path, accountId] of map) {
          if (folderPath.startsWith(path) && path.length > bestLen) {
            best = accountId;
            bestLen = path.length;
          }
        }
        return best;
      };
    },
    /** The account root URI (a depth-0 path minus its last segment) — the
     *  scope for "Current account" typed searches and inline folder creation. */
    accountRootPath(state): ((accountId: string | null) => string | null) {
      return (accountId: string | null): string | null => {
        if (!accountId) return null;
        const top = (state.foldersByAccount[accountId] ?? []).find((f) => f.depth === 0);
        return top ? top.path.slice(0, top.path.lastIndexOf("/")) : null;
      };
    },
    /** The folder object for a URI, across every account (or null). */
    folderByPath(state): ((path: string) => Folder | null) {
      return (path: string): Folder | null => {
        for (const folders of Object.values(state.foldersByAccount)) {
          const hit = folders.find((f) => f.path === path);
          if (hit) return hit;
        }
        return null;
      };
    },
    /** The Trash folder of the account a folder URI belongs to (or null). */
    trashOfFolderPath(): ((folderPath: string) => Folder | null) {
      return (folderPath: string): Folder | null => {
        const accountId = this.accountOfFolder(folderPath);
        if (!accountId) return null;
        return (this.foldersByAccount[accountId] ?? []).find((f) => f.kind === "trash") ?? null;
      };
    },
    /** Every identity address of every visible account — "self" for reply-all. */
    selfAddresses(): Set<string> {
      const addresses = new Set<string>();
      for (const account of this.visibleAccounts) {
        for (const identity of account.identities) {
          if (identity.email) addresses.add(identity.email.toLowerCase());
        }
        if (account.email) addresses.add(account.email.toLowerCase());
      }
      return addresses;
    },
    folders(state): Folder[] {
      return state.selectedAccountId
        ? (state.foldersByAccount[state.selectedAccountId] ?? [])
        : [];
    },
    /** Unread across every non-trash/junk folder of every visible account. */
    registerUnread(state): number {
      const visible = new Set(this.visibleAccounts.map((a) => a.id));
      let unread = 0;
      for (const [accountId, folders] of Object.entries(state.foldersByAccount)) {
        if (!visible.has(accountId)) continue;
        for (const folder of folders) {
          if (folder.kind === "trash" || folder.kind === "junk") continue;
          unread += folder.unread;
        }
      }
      return unread;
    },
    /** True when at least one account is filtered out (folio honesty: the
     *  SSE global unread then overcounts — the rail tally is authoritative). */
    hasHiddenAccounts(state): boolean {
      return this.visibleAccounts.length < state.accounts.length;
    },
    accountUnread(state) {
      return (accountId: string): number => {
        let unread = 0;
        for (const folder of state.foldersByAccount[accountId] ?? []) {
          if (folder.kind === "trash" || folder.kind === "junk") continue;
          unread += folder.unread;
        }
        return unread;
      };
    },
  },

  actions: {
    async load() {
      this.loading = true;
      this.error = null;
      try {
        const backend = getBackend();
        // The flat folder list carries accountId — accounts are not needed
        // first, so both boot calls run concurrently (Round-2 perf).
        const [accounts] = await Promise.all([backend.listAccounts(), this.loadFolders()]);
        this.accounts = accounts;
        if (!this.selectedAccountId && this.accounts.length > 0) {
          this.selectedAccountId = this.accounts[0]!.id;
        }
      } catch (cause) {
        this.error = cause instanceof Error ? cause.message : "Loading the accounts failed.";
      } finally {
        this.loading = false;
      }
    },

    /** One call returns every account's folders (sidecar contract) — grouped
     *  client-side so the rail carries true per-account unread tallies. */
    async loadFolders() {
      const backend = getBackend();
      const folders = await backend.listFolders(null);
      const grouped: Record<string, Folder[]> = {};
      for (const folder of folders) {
        (grouped[folder.accountId] ??= []).push(folder);
      }
      this.foldersByAccount = grouped;
      scheduleBootSnapshotPersist();
    },

    /** Hydrate from a /api/bootstrap answer (Round-2 perf): same wire data
     *  the individual calls would map — stores can't tell the paths apart. */
    applyBoot(boot: Pick<BootstrapData, "accounts" | "folders">) {
      this.accounts = boot.accounts;
      const grouped: Record<string, Folder[]> = {};
      for (const folder of boot.folders) {
        (grouped[folder.accountId] ??= []).push(folder);
      }
      this.foldersByAccount = grouped;
      if (!this.selectedAccountId && this.accounts.length > 0) {
        this.selectedAccountId = this.accounts[0]!.id;
      }
      this.error = null;
      this.loading = false;
    },

    /** Render the persisted snapshot instantly (pre-bootstrap paint). */
    applySnapshot(accounts: Account[], foldersByAccount: Record<string, Folder[]>) {
      this.accounts = accounts;
      this.foldersByAccount = foldersByAccount;
      if (!this.selectedAccountId && this.accounts.length > 0) {
        this.selectedAccountId = this.accounts[0]!.id;
      }
    },

    /** Components close the rail drawer (ui store) alongside these. */
    async selectAccount(id: string) {
      if (this.selectedAccountId === id) return;
      this.selectedAccountId = id;
      this.scopeFolder = null;
      await useMailStore().refresh();
    },

    async selectScope(scope: "all" | string) {
      this.scopeFolder = scope === "all" ? null : scope;
      await useMailStore().refresh();
    },

    async refreshUnread() {
      try {
        // Folder objects carry the unread tallies; one call per account is
        // cheap (headers only). Refresh only the visible account.
        await this.loadFolders();
      } catch {
        /* a failed tally refresh is silent; the next event retries */
      }
    },

    setError(message: string | null) {
      this.error = message;
    },

    /** Stage 2: after a per-account visibility change, drop a hidden
     *  selected account or scope so the rail never points into the dark. */
    reconcileVisibility() {
      if (this.selectedAccountId && !this.visibleAccounts.some((a) => a.id === this.selectedAccountId)) {
        this.selectedAccountId = this.visibleAccounts[0]?.id ?? null;
      }
      if (this.scopeFolder && !this.accountOfFolder(this.scopeFolder)) {
        // The scope's owner is hidden — fall back to All mail.
        this.scopeFolder = null;
        void useMailStore().refresh();
      }
    },
  },
});
