/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { defineStore } from "pinia";
import { BackendError, getBackend } from "../api";
import type { BodyChunk } from "../api/backend-interface";
import type { MailEvent, MessageDetail, MessageSummary } from "../api/types";
import { useAccountsStore } from "./accounts";

/**
 * The register page (message list) and the record sheet (reader).
 * Pagination = offset + hasMore from the sidecar; the detail cache is a
 * small LRU so flipping prev/next stays instant. Phase 4 adds the
 * conversation (thread) panel, cache-derived attachment hints, and
 * `bodyOffset`-paged body continuation.
 */

const PAGE_SIZE = 50;
const DETAIL_CACHE_MAX = 24;

export const useMailStore = defineStore("mail", {
  state: () => ({
    messages: [] as MessageSummary[],
    totalMatches: 0,
    hasMore: false,
    pageSize: PAGE_SIZE,
    listLoading: false,
    listAppending: false,
    listError: null as string | null,
    /** The text of the search field; operators pass through verbatim. */
    searchText: "",
    unreadOnly: false,
    flaggedOnly: false,

    selectedId: null as string | null,
    detailById: new Map<string, MessageDetail>(),
    detailOrder: [] as string[],
    detailLoading: false,
    detailError: null as string | null,
    /** Body continuation state for truncated messages. */
    loadingMoreBody: false,
    bodyError: null as string | null,

    /** Derived attachment knowledge: filled whenever a full record passes
     *  through the caches (open message, preloaded neighbours, thread).
     *  true/false = known; missing = unknown (rows show nothing). */
    attachmentsKnown: new Map<string, boolean>(),

    /** The conversation panel under the record sheet. */
    threadSummaries: [] as MessageSummary[],
    threadDetails: new Map<string, MessageDetail>(),
    threadLoading: false,
    threadError: null as string | null,
    threadExpanded: false,

    /** Live SSE state — the folio in the top bar reads this. */
    lastMailEvent: null as MailEvent | null,
    lastMailEventAt: 0,

    /** Monotonic guard: responses of superseded queries are dropped, so a
     *  slow whole-register scan can never overwrite a fresher result. */
    refreshSeq: 0,

    refreshTimer: null as ReturnType<typeof setTimeout> | null,
  }),

  getters: {
    selectedIndex(state): number {
      return state.messages.findIndex((m) => m.id === state.selectedId);
    },
    selectedSummary(state): MessageSummary | null {
      return state.messages.find((m) => m.id === state.selectedId) ?? null;
    },
    selectedDetail(state): MessageDetail | null {
      return state.selectedId ? (state.detailById.get(state.selectedId) ?? null) : null;
    },
    /** The conversation in chronological order, bodies when fetched. */
    thread(state): Array<{ summary: MessageSummary; detail: MessageDetail | null; isCurrent: boolean }> {
      return state.threadSummaries.map((summary) => ({
        summary,
        detail: state.threadDetails.get(summary.id) ?? null,
        isCurrent: summary.id === state.selectedId,
      }));
    },
    prevId(state): string | null {
      const index = state.messages.findIndex((m) => m.id === state.selectedId);
      return index > 0 ? (state.messages[index - 1]?.id ?? null) : null;
    },
    nextId(state): string | null {
      const index = state.messages.findIndex((m) => m.id === state.selectedId);
      return index >= 0 && index < state.messages.length - 1
        ? (state.messages[index + 1]?.id ?? null)
        : null;
    },
    scopeLabel(): string {
      const accounts = useAccountsStore();
      if (!accounts.scopeFolder) return "All mail";
      for (const folders of Object.values(accounts.foldersByAccount)) {
        const folder = folders.find((f) => f.path === accounts.scopeFolder);
        if (folder) return folder.name;
      }
      return "Folder";
    },
    /** Paperclip hint for a row: true/false when known, undefined when not. */
    derivedAttachments(state) {
      return (id: string): boolean | undefined => state.attachmentsKnown.get(id);
    },
  },

  actions: {
    buildArgs(extra: { maxResults?: number; offset?: number }) {
      const accounts = useAccountsStore();
      return {
        text: this.searchText,
        unreadOnly: this.unreadOnly || undefined,
        flaggedOnly: this.flaggedOnly || undefined,
        scopeFolder: accounts.scopeFolder,
        ...extra,
      };
    },

    async refresh() {
      const seq = ++this.refreshSeq;
      this.refreshTimer && clearTimeout(this.refreshTimer);
      this.listLoading = true;
      this.listError = null;
      try {
        const result = await getBackend().searchMessages(
          this.buildArgs({ maxResults: this.pageSize, offset: 0 }),
        );
        // A newer query superseded this one (search typing, SSE refresh) —
        // drop the stale page instead of clobbering the newer result.
        if (seq !== this.refreshSeq) return;
        this.messages = result.messages;
        this.totalMatches = result.totalMatches;
        this.hasMore = result.hasMore;
        // Keep the selection when the message survives the refresh; else drop it.
        if (this.selectedId && !result.messages.some((m) => m.id === this.selectedId)) {
          this.clearSelection();
        }
      } catch (cause) {
        if (seq !== this.refreshSeq) return;
        this.listError =
          cause instanceof Error ? cause.message : "The register page could not be loaded.";
      } finally {
        if (seq === this.refreshSeq) {
          this.listLoading = false;
          this.listAppending = false;
        }
      }
    },

    async loadMore() {
      if (!this.hasMore || this.listLoading || this.listAppending) return;
      const seq = this.refreshSeq;
      this.listAppending = true;
      try {
        const result = await getBackend().searchMessages(
          this.buildArgs({ maxResults: this.pageSize, offset: this.messages.length }),
        );
        if (seq !== this.refreshSeq) return; // superseded mid-flight
        const seen = new Set(this.messages.map((m) => m.id));
        const fresh = result.messages.filter((m) => !seen.has(m.id));
        this.messages.push(...fresh);
        this.totalMatches = result.totalMatches;
        this.hasMore = result.hasMore;
      } catch (cause) {
        if (seq !== this.refreshSeq) return;
        this.listError =
          cause instanceof Error ? cause.message : "Loading more entries failed.";
        this.hasMore = false;
      } finally {
        if (seq === this.refreshSeq) this.listAppending = false;
      }
    },

    setSearchText(text: string) {
      this.searchText = text;
      this.scheduleRefresh();
    },

    toggleUnreadFilter() {
      this.unreadOnly = !this.unreadOnly;
      void this.refresh();
    },

    toggleFlaggedFilter() {
      this.flaggedOnly = !this.flaggedOnly;
      void this.refresh();
    },

    /** Debounce keystroke searches; SSE refreshes share the same path. */
    scheduleRefresh(delay = 300) {
      if (this.refreshTimer) clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(() => void this.refresh(), delay);
    },

    async select(id: string) {
      if (this.selectedId === id) return;
      const previous = this.selectedId;
      this.selectedId = id;
      this.detailError = null;
      this.bodyError = null;
      this.resetThread();
      if (!this.detailById.has(id)) {
        const summary = this.messages.find((m) => m.id === id);
        if (!summary) return;
        this.detailLoading = true;
        try {
          const detail = await getBackend().getMessage(summary.id, summary.folderPath);
          this.cacheDetail(this.withFolderPath(detail, summary.folderPath));
          // Preload the neighbours so prev/next flips are instant (raise from
          // the vertical-feed challenger: the next record is one flip away).
          void this.preloadNeighbours(summary.id);
        } catch (cause) {
          this.detailError =
            cause instanceof BackendError || cause instanceof Error
              ? cause.message
              : "Opening the record failed.";
          this.selectedId = previous;
          return;
        } finally {
          this.detailLoading = false;
        }
      } else {
        void this.preloadNeighbours(id);
      }
      void this.loadThread();
    },

    resetThread() {
      this.threadSummaries = [];
      this.threadDetails = new Map();
      this.threadError = null;
      this.threadExpanded = false;
    },

    /** getMessage answers carry no folderPath — always pair a record with
     *  the folder path of the summary it was opened from. */
    withFolderPath(detail: MessageDetail, fallback: string): MessageDetail {
      return detail.folderPath ? detail : { ...detail, folderPath: fallback };
    },

    /** Load the conversation the selected message belongs to. */
    async loadThread() {
      const detail = this.selectedDetail;
      if (!detail) return;
      const summary = this.selectedSummary;
      const folderPath = summary?.folderPath || detail.folderPath;
      this.threadLoading = true;
      this.threadError = null;
      try {
        const result = await getBackend().getThread(detail.id, folderPath);
        if (this.selectedId !== detail.id) return; // selection moved on meanwhile
        this.threadSummaries = result.messages;
        if (result.messages.length > 1) {
          const missing = result.messages
            .filter((m) => !this.threadDetails.has(m.id) && !this.detailById.has(m.id))
            .map((m) => ({ id: m.id, folderPath: m.folderPath }));
          if (missing.length > 0) {
            const details = await getBackend().getMessages(missing);
            for (const d of details) {
              this.threadDetails.set(d.id, d);
              this.noteAttachments(d);
            }
          }
          // Reuse already-cached details (selected + preloaded neighbours).
          for (const m of result.messages) {
            const cached = this.detailById.get(m.id);
            if (cached && !this.threadDetails.has(m.id)) this.threadDetails.set(m.id, cached);
          }
        }
      } catch (cause) {
        this.threadError =
          cause instanceof Error ? cause.message : "The conversation could not be loaded.";
      } finally {
        this.threadLoading = false;
      }
    },

    toggleThreadExpanded() {
      this.threadExpanded = !this.threadExpanded;
    },

    async preloadNeighbours(id: string) {
      const index = this.messages.findIndex((m) => m.id === id);
      for (const offset of [-1, 1]) {
        const neighbour = this.messages[index + offset];
        if (neighbour && !this.detailById.has(neighbour.id)) {
          try {
            const detail = await getBackend().getMessage(neighbour.id, neighbour.folderPath);
            this.cacheDetail(this.withFolderPath(detail, neighbour.folderPath));
          } catch {
            /* preload failures are silent — the row loads on demand */
          }
        }
      }
    },

    noteAttachments(detail: MessageDetail) {
      this.attachmentsKnown.set(detail.id, detail.attachments.length > 0);
    },

    cacheDetail(detail: MessageDetail) {
      this.detailById.set(detail.id, detail);
      if (!this.detailOrder.includes(detail.id)) this.detailOrder.push(detail.id);
      while (this.detailOrder.length > DETAIL_CACHE_MAX) {
        const evicted = this.detailOrder.shift();
        if (evicted && evicted !== this.selectedId) this.detailById.delete(evicted);
      }
      this.noteAttachments(detail);
    },

    /** Fetch the rest of a truncated body via `bodyOffset` paging and splice
     *  it into the cached record — no full refetch needed. */
    async loadMoreBody() {
      const detail = this.selectedDetail;
      if (!detail || !detail.bodyTruncated || this.loadingMoreBody) return;
      this.loadingMoreBody = true;
      this.bodyError = null;
      try {
        const backend = getBackend();
        const summary = this.selectedSummary;
        const folderPath = summary?.folderPath || detail.folderPath;
        let body = detail.body;
        let next: number | undefined = detail.nextBodyOffset;
        let truncated: boolean = detail.bodyTruncated;
        let guard = 0;
        while (truncated && next && guard++ < 20) {
          const chunk: BodyChunk = await backend.getMessageBodyChunk(detail.id, folderPath, next);
          body += chunk.text;
          next = chunk.nextBodyOffset;
          truncated = chunk.bodyTruncated;
        }
        this.cacheDetail({ ...detail, body, bodyTruncated: truncated, nextBodyOffset: next });
      } catch {
        this.bodyError = "Loading the rest of this record failed.";
      } finally {
        this.loadingMoreBody = false;
      }
    },

    selectPrev() {
      const prev = this.prevId;
      if (prev) void this.select(prev);
    },
    selectNext() {
      const next = this.nextId;
      if (next) void this.select(next);
    },
    clearSelection() {
      this.selectedId = null;
    },

    onMailEvent(event: MailEvent) {
      this.lastMailEvent = event;
      this.lastMailEventAt = Date.now();
      // Re-file the current page promptly; the sidecar's own poll already
      // throttled the change, so this only costs one search call.
      this.scheduleRefresh(1_200);
      void useAccountsStore().refreshUnread();
    },

    reset() {
      this.messages = [];
      this.totalMatches = 0;
      this.hasMore = false;
      this.selectedId = null;
      this.listError = null;
      this.resetThread();
    },
  },
});
