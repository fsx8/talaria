/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { defineStore } from "pinia";
import { getBackend } from "../api";
import type { AddressBook, ContactDetail, ContactSummary } from "../api/types";

/**
 * The contacts register: address books, a paged search over them, and a
 * small detail cache. Strictly read-only — edits live in Thunderbird.
 */

const DETAIL_CACHE_MAX = 40;

export const useContactsStore = defineStore("contacts", {
  state: () => ({
    books: [] as AddressBook[],
    query: "",
    contacts: [] as ContactSummary[],
    totalKnown: 0,
    hasMore: false,
    nextOffset: undefined as number | undefined,
    loading: false,
    appending: false,
    error: null as string | null,

    selectedId: null as string | null,
    detailById: new Map<string, ContactDetail>(),
    detailOrder: [] as string[],
    detailLoading: false,
    detailError: null as string | null,
  }),

  getters: {
    selectedDetail(state): ContactDetail | null {
      return state.selectedId ? (state.detailById.get(state.selectedId) ?? null) : null;
    },
    bookName(state) {
      return (id: string): string => state.books.find((b) => b.id === id)?.name ?? "Address book";
    },
  },

  actions: {
    async load() {
      if (this.books.length > 0 || this.loading) return;
      this.loading = true;
      this.error = null;
      try {
        const backend = getBackend();
        this.books = await backend.listAddressBooks();
        await this.search("", 0);
      } catch (cause) {
        this.error = cause instanceof Error ? cause.message : "The address books could not be loaded.";
      } finally {
        this.loading = false;
      }
    },

    async search(query: string, offset = 0) {
      this.error = null;
      if (offset === 0) {
        this.loading = this.contacts.length === 0;
        this.query = query;
      } else {
        this.appending = true;
      }
      try {
        const result = await getBackend().searchContacts(query, offset);
        if (offset === 0) {
          this.contacts = result.contacts;
        } else {
          const seen = new Set(this.contacts.map((c) => c.id));
          this.contacts.push(...result.contacts.filter((c) => !seen.has(c.id)));
        }
        this.hasMore = result.hasMore;
        this.nextOffset = result.nextOffset;
        this.totalKnown = this.contacts.length;
      } catch (cause) {
        this.error = cause instanceof Error ? cause.message : "The contact search failed.";
      } finally {
        this.loading = false;
        this.appending = false;
      }
    },

    async loadMore() {
      if (!this.hasMore || this.appending || this.loading) return;
      await this.search(this.query, this.nextOffset ?? this.contacts.length);
    },

    async select(id: string) {
      if (this.selectedId === id) return;
      this.selectedId = id;
      this.detailError = null;
      if (this.detailById.has(id)) return;
      this.detailLoading = true;
      try {
        const detail = await getBackend().getContact(id);
        this.detailById.set(id, detail);
        this.detailOrder.push(id);
        while (this.detailOrder.length > DETAIL_CACHE_MAX) {
          const evicted = this.detailOrder.shift();
          if (evicted && evicted !== this.selectedId) this.detailById.delete(evicted);
        }
      } catch (cause) {
        this.detailError = cause instanceof Error ? cause.message : "Opening the contact card failed.";
        this.selectedId = null;
      } finally {
        this.detailLoading = false;
      }
    },
  },
});
