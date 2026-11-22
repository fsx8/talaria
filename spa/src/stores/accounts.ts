/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { defineStore } from "pinia";
import { getBackend } from "../api";
import type { Account, Folder } from "../api/types";
import { useMailStore } from "./mail";

/**
 * The register rail: accounts with their color chips, folders with their
 * unread tallies, and the scope the list pane is currently filed under.
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
    folders(state): Folder[] {
      return state.selectedAccountId
        ? (state.foldersByAccount[state.selectedAccountId] ?? [])
        : [];
    },
    /** Unread across every non-trash/junk folder of every account. */
    registerUnread(state): number {
      let unread = 0;
      for (const folders of Object.values(state.foldersByAccount)) {
        for (const folder of folders) {
          if (folder.kind === "trash" || folder.kind === "junk") continue;
          unread += folder.unread;
        }
      }
      return unread;
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
        this.accounts = await backend.listAccounts();
        if (!this.selectedAccountId && this.accounts.length > 0) {
          this.selectedAccountId = this.accounts[0]!.id;
        }
        await this.loadFolders();
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
  },
});
