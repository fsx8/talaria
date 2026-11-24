<script setup lang="ts">
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { computed, onMounted, ref } from "vue";
import { getBackend } from "../api";
import type { HealthInfo } from "../api";
import AgendaWidget from "./AgendaWidget.vue";
import IconGlyph from "./IconGlyph.vue";
import { groupCount } from "../composables/format";
import { useAccountsStore } from "../stores/accounts";
import { useMailStore } from "../stores/mail";
import { useSearchesStore } from "../stores/searches";
import { useToastStore } from "../stores/toast";
import { useSettingsStore } from "../stores/settings";
import { useUiStore, type ActiveView } from "../stores/ui";

const ui = useUiStore();
const accounts = useAccountsStore();
const settings = useSettingsStore();
const searches = useSearchesStore();
const toast = useToastStore();
const mail = useMailStore();

const switcher: Array<{ view: ActiveView; icon: "book" | "people" | "calendar" | "gear"; label: string }> = [
  { view: "mail", icon: "book", label: "Register" },
  { view: "contacts", icon: "people", label: "Contacts" },
  { view: "agenda", icon: "calendar", label: "Agenda" },
  { view: "settings", icon: "gear", label: "Settings" },
];

const health = ref<HealthInfo | null>(null);
const healthChecking = ref(false);

async function checkHealth() {
  healthChecking.value = true;
  try {
    health.value = await getBackend().getHealth();
  } catch {
    health.value = { ok: false };
  } finally {
    healthChecking.value = false;
  }
}

onMounted(() => {
  void accounts.load();
  void checkHealth();
});

const folders = computed(() => accounts.folders);

function folderIcon(kind: string): "inbox" | "folder" {
  return kind === "inbox" ? "inbox" : "folder";
}

function selectScope(scope: "all" | string) {
  void accounts.selectScope(scope);
  ui.closeRailDrawer();
}

function selectAccount(id: string) {
  void accounts.selectAccount(id);
  ui.closeRailDrawer();
}

/* ---- Stage 2: saved searches ---- */

/** Re-run a saved search (typed-query scope rules apply, as when typing it). */
function runSearch(id: string) {
  const entry = searches.items.find((item) => item.id === id);
  if (!entry) return;
  ui.openView("mail");
  mail.setSearchText(entry.query);
  ui.closeRailDrawer();
}

/** Right-click or long-press removes the bookmark (client-side, no confirm —
 *  recreating it is one keystroke; a toast reports it). */
function removeSearch(id: string) {
  const entry = searches.items.find((item) => item.id === id);
  searches.remove(id);
  if (entry) toast.ok(`Search “${searches.displayName(entry)}” removed`);
}

const PRESS_MS = 550;
let pressTimer: ReturnType<typeof setTimeout> | null = null;

function pressStart(id: string) {
  pressTimer = setTimeout(() => {
    pressTimer = null;
    removeSearch(id);
  }, PRESS_MS);
}

function pressCancel() {
  if (pressTimer) {
    clearTimeout(pressTimer);
    pressTimer = null;
  }
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pt-2">
    <!-- switcher: the four consultations this register offers -->
    <div role="tablist" aria-label="Views" class="tabs tabs-sm mb-1 grid w-full grid-cols-4 rounded-field border border-base-300 bg-base-300/30 p-0.5">
      <button
        v-for="entry in switcher"
        :key="entry.view"
        role="tab"
        class="tab flex-col gap-0.5 px-1 py-1.5 text-[10.5px] leading-tight"
        :class="ui.activeView === entry.view ? 'tab-active' : ''"
        :aria-current="ui.activeView === entry.view ? 'page' : undefined"
        @click="ui.openView(entry.view)"
      >
        <IconGlyph :name="entry.icon" :size="14" />
        {{ entry.label }}
      </button>
    </div>

    <!-- scope: the whole register -->
    <button
      class="flex w-full items-center gap-2 rounded-field px-2 py-1.5 text-left text-[13px]"
      :class="!accounts.scopeFolder && ui.activeView === 'mail' ? 'bg-base-300 font-semibold' : 'text-base-content/70 hover:bg-base-300/50'"
      :aria-current="!accounts.scopeFolder && ui.activeView === 'mail' ? 'true' : undefined"
      @click="selectScope('all')"
    >
      <IconGlyph name="book" :size="15" class="text-base-content/55" />
      <span class="flex-1 truncate">All mail</span>
      <span v-if="accounts.registerUnread > 0" class="tabular text-[11.5px] font-semibold text-primary">
        {{ groupCount(accounts.registerUnread) }}
      </span>
    </button>

    <!-- accounts (visible only — Stage 2 per-account visibility) -->
    <div class="mt-3">
      <button
        v-for="account in accounts.visibleAccounts"
        :key="account.id"
        class="flex w-full items-center gap-2 rounded-field px-2 py-1.5 text-left text-[13px]"
        :class="accounts.selectedAccountId === account.id ? 'bg-base-300 font-semibold' : 'text-base-content/70 hover:bg-base-300/50'"
        :aria-current="accounts.selectedAccountId === account.id ? 'true' : undefined"
        :title="settings.accountLabel(account) + (settings.accountLabel(account) !== account.email ? ` · ${account.email}` : '')"
        @click="selectAccount(account.id)"
      >
        <span
          class="account-chip"
          :style="{ background: `var(--acct-${account.colorIndex})` }"
          aria-hidden="true"
        />
        <span class="flex-1 truncate">{{ settings.accountLabel(account) }}</span>
        <span
          v-if="accounts.accountUnread(account.id) > 0"
          class="tabular min-w-fit text-[11.5px] font-semibold"
          :class="accounts.selectedAccountId === account.id ? 'text-primary' : 'text-base-content/55'"
        >
          {{ groupCount(accounts.accountUnread(account.id)) }}
        </span>
      </button>
    </div>

    <!-- folders of the selected account -->
    <div v-if="folders.length" class="mb-2 mt-3 border-t border-base-300 pt-2">
      <button
        v-for="folder in folders"
        :key="folder.path"
        class="flex w-full items-center gap-2 rounded-field py-1.5 pr-2 text-left text-[13px]"
        :class="[
          folder.depth > 0 ? 'pl-6' : 'pl-2',
          accounts.scopeFolder === folder.path ? 'bg-base-300 font-semibold' : 'text-base-content/70 hover:bg-base-300/50',
        ]"
        :aria-current="accounts.scopeFolder === folder.path ? 'true' : undefined"
        @click="selectScope(folder.path)"
      >
        <IconGlyph :name="folderIcon(folder.kind)" :size="14" class="text-base-content/55" />
        <span class="flex-1 truncate">{{ folder.name }}</span>
        <span class="agate">{{ groupCount(folder.total) }}</span>
        <span
          v-if="folder.unread > 0"
          class="tabular min-w-[1.6em] text-right text-[11.5px] font-semibold text-primary"
        >
          {{ folder.unread }}
        </span>
      </button>
    </div>

    <!-- saved searches (Stage 2): click re-runs, right-click / long-press removes -->
    <div v-if="searches.sorted.length" class="mb-2 mt-1 border-t border-base-300 pt-2">
      <h3 class="agate mb-1 px-2 font-semibold uppercase tracking-[0.08em]">Searches</h3>
      <button
        v-for="entry in searches.sorted"
        :key="entry.id"
        class="group flex w-full items-center gap-2 rounded-field px-2 py-1.5 text-left text-[13px] text-base-content/70 hover:bg-base-300/50"
        :class="mail.searchText.trim() === entry.query ? 'bg-base-300 font-semibold text-base-content' : ''"
        :aria-current="mail.searchText.trim() === entry.query ? 'true' : undefined"
        :title="`${entry.query} — right-click to remove`"
        @click="runSearch(entry.id)"
        @contextmenu.prevent="removeSearch(entry.id)"
        @touchstart.passive="pressStart(entry.id)"
        @touchend.passive="pressCancel"
        @touchmove.passive="pressCancel"
        @touchcancel.passive="pressCancel"
      >
        <IconGlyph name="search" :size="14" class="text-base-content/55" />
        <span class="flex-1 truncate">{{ searches.displayName(entry) }}</span>
        <span
          class="btn btn-ghost btn-xs btn-circle hidden flex-none group-hover:flex"
          role="button"
          tabindex="-1"
          aria-label="Remove saved search"
          @click.stop="removeSearch(entry.id)"
          @keydown.enter.stop.prevent="removeSearch(entry.id)"
        >
          <IconGlyph name="close" :size="12" />
        </span>
      </button>
    </div>

    <!-- docked agenda: the week at a glance (full page behind the switcher) -->
    <AgendaWidget class="mt-auto" />
  </div>

  <!-- footer: backend status / demo label -->
  <div class="border-t border-base-300 px-3 py-2">
    <div v-if="health" class="flex items-center gap-2">
      <span
        class="status"
        :class="health.commonpost?.reachable ? 'status-success' : 'status-error'"
        aria-hidden="true"
      />
      <span class="agate flex-1 truncate">
        <template v-if="health.commonpost?.reachable">
          {{ health.commonpost.serverInfo?.name ?? "commonpost" }}
          <template v-if="health.commonpost.serverInfo?.version">v{{ health.commonpost.serverInfo.version }}</template>
        </template>
        <template v-else>backend unreachable</template>
      </span>
      <button
        type="button"
        class="btn btn-ghost btn-xs btn-circle"
        :aria-label="healthChecking ? 'Checking backend' : 'Check backend status'"
        :title="healthChecking ? 'Checking…' : 'Check status'"
        @click="checkHealth"
      >
        <IconGlyph name="refresh" :size="13" :class="healthChecking ? 'animate-spin' : ''" />
      </button>
    </div>
    <div v-if="ui.backendKind === 'mock'" class="agate mt-1 text-warning">
      Demo data — mock backend
    </div>
  </div>
</template>
