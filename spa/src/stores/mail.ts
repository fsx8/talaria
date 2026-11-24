/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { defineStore } from "pinia";
import { BackendError, getBackend } from "../api";
import type { BodyChunk, MessageRef } from "../api/backend-interface";
import type { BootstrapData, Folder, MailEvent, MessageDetail, MessageSummary, SearchResult } from "../api/types";
import { useAccountsStore } from "./accounts";
import { scheduleBootSnapshotPersist } from "./boot";
import { useSettingsStore } from "./settings";
import { useToastStore } from "./toast";

/**
 * The register page (message list) and the record sheet (reader).
 * Pagination = offset + hasMore from the sidecar; the detail cache is a
 * small LRU so flipping prev/next stays instant. Phase 4 adds the
 * conversation (thread) panel, cache-derived attachment hints, and
 * `bodyOffset`-paged body continuation. Round 3 (W1 organize) adds the
 * reversible write tier: read/unread, flag, move to folder, create folder
 * — all optimistic with rollback, all confirmed via marginalia toasts.
 */

const PAGE_SIZE = 50;
const DETAIL_CACHE_MAX = 24;
/** Mark a record as read this long after opening it (settings-gated). */
const MARK_READ_DELAY_MS = 900;
/** How long a moved row stays locally suppressed (IMAP echoes can linger). */
const MOVE_ECHO_MS = 20_000;

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

    /* ---- W1 organize (Round 3) ---- */
    /** Batch-selection mode: the register shows checkboxes, the head a bar. */
    selectMode: false,
    checkedIds: [] as string[],
    /** Any write round-trip in flight (drives button spinners, re-entry guards). */
    writeBusy: false,
    /** The open-then-mark-read timer for the current selection. */
    markReadTimer: null as ReturnType<typeof setTimeout> | null,
    /** Rows moved out of a folder, suppressed until an IMAP echo settles:
     *  id → { until, to } — the row stays hidden while the register still
     *  shows it under its OLD folder. */
    pendingMoves: new Map<string, { until: number; to: string }>(),

    /* ---- Stage 2 ---- */
    /** Remote-image consent: message ids the user explicitly allowed this
     *  session (never persisted — consent is per message, per session). */
    remoteImagesAllowed: new Set<string>(),
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
    /** The backend carries a write tier (real sidecar post-W1, mock demo). */
    canOrganize(): boolean {
      return getBackend().updateMessages !== undefined;
    },
    /** The combined switch: affordances show only when both gates are open. */
    actionsVisible(): boolean {
      return useSettingsStore().showActions && this.canOrganize;
    },
    /** The open record sits in a Drafts folder (the composer owns those). */
    selectedIsDraft(): boolean {
      const summary = this.selectedSummary;
      if (!summary) return false;
      return useAccountsStore().folderByPath(summary.folderPath)?.kind === "drafts";
    },
    checkedCount(state): number {
      return state.checkedIds.length;
    },
    /** The checked rows that are actually on the loaded pages. */
    checkedItems(state): MessageRef[] {
      const refs: MessageRef[] = [];
      for (const row of state.messages) {
        if (state.checkedIds.includes(row.id)) refs.push({ id: row.id, folderPath: row.folderPath });
      }
      return refs;
    },
    /**
     * The scope a TYPED query is implicitly filed under (Stage 2 search
     * scoping): All mail → null (the server skips Trash/Junk), Current
     * account → the account's root URI, Current folder → the rail's scope.
     * Untyped browsing keeps the rail's explicit scope untouched.
     */
    typedScopeFolder(state): string | null {
      const accounts = useAccountsStore();
      const settings = useSettingsStore();
      if (!state.searchText) return accounts.scopeFolder;
      switch (settings.searchScope) {
        case "account": {
          const root = accounts.accountRootPath(accounts.selectedAccountId);
          return root ?? null;
        }
        case "folder":
          return accounts.scopeFolder;
        default:
          return null;
      }
    },
    /** Human label of the effective typed scope — the chip next to results. */
    typedScopeLabel(state): string | null {
      const accounts = useAccountsStore();
      const settings = useSettingsStore();
      if (!state.searchText) return null;
      const scope = this.typedScopeFolder;
      if (!scope) return "All mail";
      for (const account of accounts.accounts) {
        const folders = accounts.foldersByAccount[account.id] ?? [];
        const root = accounts.accountRootPath(account.id);
        if (root && scope === root) return settings.accountLabel(account);
        const hit = folders.find((f) => f.path === scope);
        if (hit) return hit.name;
      }
      return "Folder";
    },
  },

  actions: {
    buildArgs(extra: { maxResults?: number; offset?: number }) {
      return {
        text: this.searchText,
        unreadOnly: this.unreadOnly || undefined,
        flaggedOnly: this.flaggedOnly || undefined,
        // Typed queries carry the implicit Search-scope setting; untyped
        // browsing keeps the rail's explicit folder scope.
        scopeFolder: this.typedScopeFolder,
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
        this.messages = this.filterHiddenAccounts(this.filterMoveEchoes(result.messages));
        this.totalMatches = result.totalMatches;
        this.hasMore = result.hasMore;
        // Keep the selection when the message survives the refresh; else drop it.
        if (this.selectedId && !result.messages.some((m) => m.id === this.selectedId)) {
          this.clearSelection();
        }
        scheduleBootSnapshotPersist(); // keep the repeat-visit snapshot fresh
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
        const fresh = this.filterHiddenAccounts(this.filterMoveEchoes(result.messages)).filter((m) => !seen.has(m.id));
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

    /** One-shot extra refresh that does NOT clear the debounce timer (used
     *  after moves, so a settle pass can't be swallowed by scheduleRefresh). */
    scheduleSettleRefresh(delay: number) {
      setTimeout(() => {
        if (this.listLoading || this.listAppending) return;
        void this.refresh();
      }, delay);
    },

    async select(id: string) {
      if (this.selectedId === id) return;
      const previous = this.selectedId;
      this.cancelMarkRead(); // a new selection abandons the previous open's timer
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
      // Drafts are the composer's material, not reading material: no
      // mark-as-read on open, no conversation panel.
      if (this.selectedIsDraft) {
        this.cancelMarkRead();
        return;
      }
      this.scheduleMarkRead(id);
      void this.loadThread();
    },

    /* ---- W1 organize (Round 3): mark-as-read on open ---- */

    /** Arm the delayed mark-as-read for a freshly opened record. Failures
     *  degrade silently (the entry just stays unread). */
    scheduleMarkRead(id: string) {
      const settings = useSettingsStore();
      if (!settings.markReadOnOpen || !this.actionsVisible) return;
      const summary = this.messages.find((m) => m.id === id);
      if (!summary || summary.read) return;
      this.markReadTimer = setTimeout(() => {
        this.markReadTimer = null;
        // Still on the same record, and still unread?
        if (this.selectedId !== id) return;
        const current = this.messages.find((m) => m.id === id) ?? this.selectedSummary;
        if (!current || current.read) return;
        void this.setRead([{ id: current.id, folderPath: current.folderPath }], true, { silent: true });
      }, MARK_READ_DELAY_MS);
    },

    cancelMarkRead() {
      if (this.markReadTimer) {
        clearTimeout(this.markReadTimer);
        this.markReadTimer = null;
      }
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
      this.cancelMarkRead();
      this.selectedId = null;
    },

    /* ---- W1 organize (Round 3): the reversible write tier ---- */

    /**
     * Drop rows the server still echoes under their OLD folder shortly
     * after a move (IMAP copies settle asynchronously). A row that already
     * shows up under its new home is kept.
     */
    filterMoveEchoes(rows: MessageSummary[]): MessageSummary[] {
      if (this.pendingMoves.size === 0) return rows;
      const now = Date.now();
      for (const [id, entry] of this.pendingMoves) {
        if (entry.until < now) this.pendingMoves.delete(id);
      }
      if (this.pendingMoves.size === 0) return rows;
      return rows.filter((m) => {
        const pending = this.pendingMoves.get(m.id);
        return !pending || m.folderPath === pending.to;
      });
    },

    /** Optimistic read/unread change with rollback; confirms via toast
     *  unless silent (mark-as-read-on-open degrades quietly). */
    async setRead(items: MessageRef[], read: boolean, opts: { silent?: boolean } = {}) {
      await this.applyPatch(items, { read }, opts, read ? "Marked read" : "Marked unread");
    },

    /** Optimistic flag change with rollback (confirmation-free: reversible). */
    async setFlagged(items: MessageRef[], flagged: boolean) {
      await this.applyPatch(items, { flagged }, {}, flagged ? "Flagged" : "Flag cleared");
    },

    /** Shared optimistic patch: flip rows (and the open record's summaries)
     *  immediately, then settle with the backend; any failure restores the
     *  previous values and reports via toast. */
    async applyPatch(
      items: MessageRef[],
      patch: { read?: boolean; flagged?: boolean },
      opts: { silent?: boolean },
      okLabel: string,
    ) {
      const backend = getBackend();
      if (!backend.updateMessages || items.length === 0 || this.writeBusy) return;
      const toast = useToastStore();
      // Capture + optimistic flip on every visible copy of each row.
      const before: Array<{ row: MessageSummary; read: boolean; flagged: boolean }> = [];
      for (const item of items) {
        for (const row of this.rowsById(item.id)) {
          before.push({ row, read: row.read, flagged: row.flagged });
          if (patch.read !== undefined) row.read = patch.read;
          if (patch.flagged !== undefined) row.flagged = patch.flagged;
        }
      }
      this.writeBusy = true;
      try {
        const result = await backend.updateMessages(items, patch);
        if (result.notFound.length > 0 && !opts.silent) {
          toast.ok(`${okLabel} · ${result.notFound.length} of ${items.length} not found (already moved?)`);
        } else if (!opts.silent) {
          toast.ok(items.length > 1 ? `${okLabel} · ${result.updated}` : okLabel);
        }
        if (result.warning) toast.err(`Note: ${result.warning}`);
        void useAccountsStore().refreshUnread();
      } catch (cause) {
        for (const entry of before) {
          entry.row.read = entry.read;
          entry.row.flagged = entry.flagged;
        }
        if (!opts.silent) {
          toast.err(cause instanceof Error ? cause.message : "The change was rolled back.");
        }
      } finally {
        this.writeBusy = false;
      }
    },

    /**
     * Drop rows filed under a hidden account (Stage 2 per-account
     * visibility — client-side filtering; the backend keeps indexing the
     * account, so a folder-scoped refresh is still authoritative).
     */
    filterHiddenAccounts(rows: MessageSummary[]): MessageSummary[] {
      const accounts = useAccountsStore();
      if (!accounts.hasHiddenAccounts) return rows;
      return rows.filter((m) => accounts.accountOfFolder(m.folderPath) !== null);
    },

    /** Select the first unread row (keyboard j/k with no selection, phone). */
    selectFirstUnread(): boolean {
      const target = this.messages.find((m) => !m.read) ?? this.messages[0];
      if (!target) return false;
      void this.select(target.id);
      return true;
    },

    /* ---- Stage 2: remote-image consent ---- */

    /** The open message may render remote images for the rest of the session. */
    allowRemoteImages(id: string) {
      this.remoteImagesAllowed.add(id);
    },

    remoteImagesAllowedFor(id: string | null): boolean {
      return id !== null && this.remoteImagesAllowed.has(id);
    },

    /** Every visible copy of a row: the register, the thread panel. */
    rowsById(id: string): MessageSummary[] {
      const rows: MessageSummary[] = [];
      const main = this.messages.find((m) => m.id === id);
      if (main) rows.push(main);
      const thread = this.threadSummaries.find((m) => m.id === id);
      if (thread) rows.push(thread);
      return rows;
    },

    /**
     * Move entries to a folder: optimistic removal from the register (with
     * a local echo-suppression window), refresh + tally on success,
     * re-insert + refresh on failure. No confirmation dialog — the picker
     * click IS the confirmation, and moves are reversible.
     */
    async moveTo(items: MessageRef[], target: Folder) {
      const backend = getBackend();
      if (!backend.updateMessages || items.length === 0 || this.writeBusy) return;
      const toast = useToastStore();
      const moving = new Set(items.map((i) => i.id));
      if (this.selectedId && moving.has(this.selectedId)) this.clearSelection();
      if (this.selectMode) this.exitSelectMode();

      // Optimistic removal (descending so the captured indexes stay valid).
      const originals: Array<{ index: number; row: MessageSummary }> = [];
      for (let i = this.messages.length - 1; i >= 0; i--) {
        const row = this.messages[i]!;
        if (moving.has(row.id) && row.folderPath !== target.path) {
          originals.push({ index: i, row });
          this.messages.splice(i, 1);
        }
      }
      for (const item of items) {
        if (!originals.some((o) => o.row.id === item.id)) continue;
        this.pendingMoves.set(item.id, { until: Date.now() + MOVE_ECHO_MS, to: target.path });
      }
      this.totalMatches = Math.max(0, this.totalMatches - originals.length);

      this.writeBusy = true;
      try {
        const result = await backend.updateMessages(items, { moveTo: target.path });
        const moved = result.updated - result.notFound.length;
        if (moved > 0) {
          toast.ok(`Filed ${moved > 1 ? `${moved} entries` : "entry"} under ${target.name}`);
        }
        if (result.notFound.length > 0) {
          toast.err(`${result.notFound.length} not found — already moved?`);
        }
        if (result.warning) toast.err(`Note: ${result.warning}`);
      } catch (cause) {
        // Roll back: re-insert at the captured positions (ascending).
        for (const { index, row } of originals.reverse()) {
          this.messages.splice(index, 0, row);
        }
        this.totalMatches += originals.length;
        for (const item of items) this.pendingMoves.delete(item.id);
        toast.err(cause instanceof Error ? cause.message : "The move was rolled back.");
      } finally {
        this.writeBusy = false;
      }
      // Resync with the server's view (IMAP moves settle asynchronously) and
      // refresh the tallies — both flow through refreshSeq, so a pending
      // user query still wins. IMAP copies can take tens of seconds to land
      // (and arrive under a NEW message id), so two settle passes catch the
      // server's view without the user doing anything.
      void this.refresh();
      this.scheduleRefresh(5_000);
      this.scheduleSettleRefresh(20_000);
      void useAccountsStore().refreshUnread();
    },

    /** Create a folder inline from the move picker; the tree refetches and
     *  the folder appears once the server confirms (null path = pending). */
    async createFolderUnder(parentPath: string, name: string): Promise<boolean> {
      const backend = getBackend();
      if (!backend.createFolder || this.writeBusy) return false;
      const toast = useToastStore();
      const trimmed = name.trim();
      if (!trimmed) return false;
      this.writeBusy = true;
      try {
        const result = await backend.createFolder(parentPath, trimmed);
        await useAccountsStore().loadFolders();
        toast.ok(
          result.path
            ? `Folder ${trimmed} created`
            : `Folder ${trimmed} requested — appears when the server confirms`,
        );
        return true;
      } catch (cause) {
        toast.err(cause instanceof Error ? cause.message : "The folder could not be created.");
        return false;
      } finally {
        this.writeBusy = false;
      }
    },

    /* ---- W1 organize: batch selection mode ---- */

    toggleSelectMode() {
      this.selectMode = !this.selectMode;
      if (!this.selectMode) this.checkedIds = [];
    },
    exitSelectMode() {
      this.selectMode = false;
      this.checkedIds = [];
    },
    toggleChecked(id: string) {
      this.checkedIds = this.checkedIds.includes(id)
        ? this.checkedIds.filter((c) => c !== id)
        : [...this.checkedIds, id];
    },
    checkAllVisible() {
      this.checkedIds = this.messages.map((m) => m.id);
    },

    /** Hydrate from a /api/bootstrap answer (Round-2 perf): the recent first
     *  page + the sidecar's global unread for the folio. */
    applyBoot(boot: Pick<BootstrapData, "recent" | "unread" | "generatedAt">) {
      this.applyRecentPage(boot.recent);
      if (boot.unread !== null) this.seedFolio(boot.unread, boot.generatedAt);
    },

    /** Render the persisted snapshot instantly (pre-bootstrap paint). */
    applySnapshot(recent: SearchResult, unread: number | null, generatedAt: string) {
      this.applyRecentPage(recent);
      if (unread !== null) this.seedFolio(unread, generatedAt);
    },

    applyRecentPage(result: SearchResult) {
      this.messages = this.filterHiddenAccounts(this.filterMoveEchoes(result.messages));
      this.totalMatches = result.totalMatches;
      this.hasMore = result.hasMore;
      this.listError = null;
      this.listLoading = false;
      this.listAppending = false;
    },

    /** Seed the folio from bootstrap/snapshot data (same device as the SSE
     *  hello: folder tallies alone undercount until the first mail event). */
    seedFolio(unread: number, ts: string) {
      const previous = this.lastMailEvent?.unread ?? unread;
      this.lastMailEvent = { unread, previous, ts };
      this.lastMailEventAt = Date.now();
    },

    onMailEvent(event: MailEvent) {
      this.lastMailEvent = event;
      this.lastMailEventAt = Date.now();
      // The connect-time hello (and every SSE reconnect) only seeds the
      // folio — refreshing the register on it duplicated the boot search
      // and gated first paint behind a second full scan (Round-2 perf fix).
      // The tallies ARE re-checked though (headers-only, cheap): the SSE
      // baseline must reconcile into the rail, which the folio now reads.
      if (event.isHello) {
        void useAccountsStore().refreshUnread();
        return;
      }
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
      this.cancelMarkRead();
      this.exitSelectMode();
      this.pendingMoves.clear();
    },
  },
});
