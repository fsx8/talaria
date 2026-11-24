<script setup lang="ts">
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { defineAsyncComponent, onBeforeUnmount, onMounted } from "vue";
import { getBackend } from "./api";
import AgendaView from "./components/AgendaView.vue";
import ContactsView from "./components/ContactsView.vue";
import MessageListPane from "./components/MessageListPane.vue";
import PhoneNav from "./components/PhoneNav.vue";
import ReaderPane from "./components/ReaderPane.vue";
import SettingsView from "./components/SettingsView.vue";
import ShortcutsHelp from "./components/ShortcutsHelp.vue";
import SidebarPane from "./components/SidebarPane.vue";
import ToastOutlet from "./components/ToastOutlet.vue";
import TopBar from "./components/TopBar.vue";
import { loadBootSnapshot, persistBootSnapshot } from "./stores/boot";
import { useAccountsStore } from "./stores/accounts";
import { useComposeStore } from "./stores/compose";
import { useMailStore } from "./stores/mail";
import { useUiStore } from "./stores/ui";

// The composer carries Tiptap/ProseMirror (~half the bundle) — loaded on
// first open, off the boot-critical path (Round-2 perf discipline).
const ComposerSheet = defineAsyncComponent(() => import("./components/ComposerSheet.vue"));

const ui = useUiStore();
const mail = useMailStore();
const accounts = useAccountsStore();
const compose = useComposeStore();

let unsubscribe: (() => void) | null = null;

/* ---- Stage 2: the keyboard map (see ShortcutsHelp.vue) ---- */

/** g-chord state: "g" arms a ~1.2 s window for i/s/d/t. */
let chordTimer: ReturnType<typeof setTimeout> | null = null;
let chordArmed = false;

function armChord() {
  chordArmed = true;
  if (chordTimer) clearTimeout(chordTimer);
  chordTimer = setTimeout(() => {
    chordArmed = false;
  }, 1_200);
}

function disarmChord() {
  chordArmed = false;
  if (chordTimer) {
    clearTimeout(chordTimer);
    chordTimer = null;
  }
}

/** True when the user is selecting text (never hijack copy actions). */
function isSelectingText(): boolean {
  const selection = window.getSelection();
  return selection !== null && !selection.isCollapsed && String(selection).length > 0;
}

/** Jump to the folder of a kind, preferring the visible selected account. */
function gotoFolder(kind: "inbox" | "sent" | "drafts") {
  const pool = (accountId: string | null) =>
    accountId ? (accounts.foldersByAccount[accountId] ?? []) : [];
  const preferred = pool(accounts.selectedAccountId).find((f) => f.kind === kind);
  const fallback = accounts.visibleAccounts
    .flatMap((a) => pool(a.id))
    .find((f) => f.kind === kind);
  const folder = preferred ?? fallback;
  if (!folder) return;
  ui.openView("mail");
  void accounts.selectScope(folder.path);
}

/** The Move menu of the active context: batch bar in select mode, else the sheet. */
function openMoveMenu() {
  const selector =
    mail.selectMode && mail.checkedCount > 0
      ? 'section[aria-label="Message list"] details.dropdown > summary'
      : "article.record-sheet details.dropdown > summary";
  const summary = document.querySelector<HTMLElement>(selector);
  summary?.click();
}

function toggleFlagShortcut() {
  if (!mail.actionsVisible) return;
  const summary = mail.selectedSummary;
  if (!summary) return;
  void mail.setFlagged([{ id: summary.id, folderPath: summary.folderPath }], !summary.flagged);
}

function toggleSelectShortcut() {
  if (!mail.actionsVisible) return;
  const summary = mail.selectedSummary;
  if (!summary) return;
  if (!mail.selectMode) mail.toggleSelectMode();
  mail.toggleChecked(summary.id);
}

function focusSearch() {
  const field =
    document.getElementById("talaria-search") ??
    document.getElementById("talaria-search-phone");
  field?.focus();
}

/* ---- Stage 3 (W2 drafts): compose keys ---- */

function newComposeShortcut() {
  if (!compose.entryVisible) return;
  compose.openNew();
}

/** Reply / reply-all / forward on the open record (needs its detail). The
 *  composer is a full-screen overlay, so the phone reader needs no opening. */
function replyShortcut(all: boolean) {
  if (!compose.entryVisible) return;
  const summary = mail.selectedSummary;
  if (!summary || mail.detailById.get(summary.id) === undefined) return;
  compose.openReply(all);
}

function forwardShortcut() {
  if (!compose.entryVisible) return;
  const summary = mail.selectedSummary;
  if (!summary || mail.detailById.get(summary.id) === undefined) return;
  compose.openForward();
}

function onKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return;

  if (event.key === "Escape") {
    // The composer sits on top of everything; it answers first, and its
    // close path saves the draft (or asks when the save fails).
    if (compose.open) {
      if (compose.confirm) {
        compose.cancelConfirm();
      } else {
        void compose.attemptClose();
      }
      return;
    }
    if (ui.shortcutsOpen) {
      ui.closeShortcuts();
    } else if (ui.railDrawerOpen) {
      ui.closeRailDrawer();
    } else if (ui.phoneView === "reader") {
      ui.backToList();
    } else if (mail.selectedId) {
      mail.clearSelection();
    }
    return;
  }

  // The composer owns the keyboard while open (its fields are guarded above;
  // anything reaching here is a body-level key) — no hijacks behind the sheet.
  if (compose.open) return;
  // The overlay owns the keyboard while open.
  if (ui.shortcutsOpen) return;
  // Don't hijack text selection inside the record sheet.
  if (isSelectingText()) return;

  if (event.key === "?") {
    event.preventDefault();
    ui.openShortcuts();
    return;
  }

  // The g-chord goes to views/folders; everything else is single-key.
  if (chordArmed) {
    const key = event.key.toLowerCase();
    if (key === "i") {
      disarmChord();
      event.preventDefault();
      gotoFolder("inbox");
      return;
    }
    if (key === "s") {
      disarmChord();
      event.preventDefault();
      gotoFolder("sent");
      return;
    }
    if (key === "d") {
      disarmChord();
      event.preventDefault();
      gotoFolder("drafts");
      return;
    }
    if (key === "t") {
      disarmChord();
      event.preventDefault();
      ui.openView("agenda");
      return;
    }
    disarmChord(); // any other key cancels the chord
  }

  const inMailView = ui.activeView === "mail";

  if (event.key === "/") {
    event.preventDefault();
    focusSearch();
    return;
  }
  if (event.key.toLowerCase() === "c") {
    event.preventDefault();
    newComposeShortcut();
    return;
  }
  if (event.key.toLowerCase() === "g" && inMailView) {
    event.preventDefault();
    armChord();
    return;
  }
  if (!inMailView) return;

  if (event.key === "ArrowDown" || event.key.toLowerCase() === "j") {
    event.preventDefault();
    if (mail.selectedId) {
      mail.selectNext();
    } else if (mail.selectFirstUnread() && ui.isPhone) {
      ui.openReader();
    }
  } else if (event.key === "ArrowUp" || event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (mail.selectedId) {
      mail.selectPrev();
    } else if (mail.selectFirstUnread() && ui.isPhone) {
      ui.openReader();
    }
  } else if (event.key === "Enter" || event.key.toLowerCase() === "o") {
    event.preventDefault();
    if (!mail.selectedId) return;
    // A Drafts-folder row re-opens in the composer, not the reader.
    const summary = mail.selectedSummary;
    if (summary && compose.entryVisible && mail.selectedIsDraft) {
      void compose.openDraft(summary.id);
      return;
    }
    if (ui.isPhone) ui.openReader();
  } else if (event.key.toLowerCase() === "x") {
    event.preventDefault();
    toggleSelectShortcut();
  } else if (event.key === "f") {
    // exactly f — F (shift) is forward, the Stage-3 compose key
    event.preventDefault();
    toggleFlagShortcut();
  } else if (event.key === "F") {
    event.preventDefault();
    forwardShortcut();
  } else if (event.key.toLowerCase() === "r") {
    event.preventDefault();
    replyShortcut(false);
  } else if (event.key === "a" || (event.key === "A" && event.shiftKey)) {
    event.preventDefault();
    replyShortcut(true);
  } else if (event.key.toLowerCase() === "m") {
    event.preventDefault();
    openMoveMenu();
  }
}

onMounted(async () => {
  window.addEventListener("keydown", onKeydown);
  const backend = getBackend();
  unsubscribe = backend.onMailEvent((event) => mail.onMailEvent(event));
  // The composer entry points need to know whether the add-on serves the
  // draft tier — one lazy probe, refreshed on the next full reload.
  compose.ensureProbed();

  // Round-2 perf boot: paint instantly from the persisted snapshot, then
  // re-validate with ONE bootstrap call. The snapshot is hand-rolled (not
  // @tanstack/vue-query) by design — no new dependency, Pinia stays the
  // sole server-state owner. `refreshSeq` remains the single ordering
  // guard: hydration writes state directly, every fetch path seq-guards.
  const snapshot = loadBootSnapshot();
  if (snapshot) {
    accounts.applySnapshot(snapshot.accounts, snapshot.foldersByAccount);
    mail.applySnapshot(snapshot.recent, snapshot.unread, snapshot.generatedAt);
  }

  if (typeof backend.getBootstrap !== "function") {
    // Mock backend (or a pre-bootstrap sidecar): boot through the classic
    // per-call path.
    await accounts.load();
    await mail.refresh();
    return;
  }
  try {
    const boot = await backend.getBootstrap();
    accounts.applyBoot(boot);
    mail.applyBoot(boot);
    persistBootSnapshot();
    // The bootstrap answer is built from the sidecar's cache — if its
    // oldest ingredient predates what we just rendered (multi-client
    // skew, sidecar restart), quietly refetch the live data.
    if (snapshot && Date.parse(boot.generatedAt) < Date.parse(snapshot.generatedAt)) {
      void accounts.refreshUnread();
      void mail.refresh();
    }
  } catch {
    // No bootstrap (transient 502, old sidecar): fall back to the classic
    // boot burst — the snapshot, if any, is already on screen.
    await Promise.allSettled([accounts.load(), mail.refresh()]);
    persistBootSnapshot();
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  disarmChord();
  unsubscribe?.();
});
</script>

<template>
  <TopBar />

  <div class="app-shell">
    <!-- Register rail: persistent pane on desktop, drawer below 1024px -->
    <aside
      class="flex min-h-0 flex-col bg-base-200"
      :class="
        ui.railDrawerOpen
          ? 'max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-40 max-lg:w-72 max-lg:border-r max-lg:border-base-300 max-lg:shadow-[0_0_28px_var(--sheet-shadow)]'
          : 'max-lg:hidden lg:flex'
      "
      aria-label="Accounts and folders"
    >
      <SidebarPane />
    </aside>

    <div
      v-if="ui.railDrawerOpen"
      class="fixed inset-0 z-30 bg-[rgba(8,14,22,0.42)] lg:hidden"
      aria-hidden="true"
      @click="ui.closeRailDrawer()"
    />

    <!-- mail register: list + reader -->
    <template v-if="ui.activeView === 'mail'">
      <MessageListPane :class="ui.phoneView === 'reader' ? 'max-md:hidden' : 'flex'" class="flex min-h-0 flex-col" />

      <ReaderPane
        class="min-h-0 flex-col"
        :class="ui.phoneView === 'reader' ? 'flex' : 'hidden md:flex'"
      />
    </template>

    <!-- contacts register: search + cards (spans list + reader columns) -->
    <ContactsView v-else-if="ui.activeView === 'contacts'" class="min-h-0 flex-col lg:col-span-2" />

    <!-- the week on one page -->
    <AgendaView v-else-if="ui.activeView === 'agenda'" class="min-h-0 flex-col lg:col-span-2" />

    <!-- preferences (routed: /settings) -->
    <SettingsView v-else class="min-h-0 flex-col lg:col-span-2" />
  </div>

  <PhoneNav v-if="ui.activeView === 'mail'" />

  <!-- write-action confirmations (W1 organize) -->
  <ToastOutlet />

  <!-- the drafts composer (W2, Stage 3) -->
  <ComposerSheet />

  <!-- the keyboard map (? key, Stage 2) -->
  <ShortcutsHelp />
</template>
