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
import { useUiStore, type ActiveView } from "../stores/ui";

const ui = useUiStore();
const accounts = useAccountsStore();

const switcher: Array<{ view: ActiveView; icon: "book" | "people" | "calendar"; label: string }> = [
  { view: "mail", icon: "book", label: "Register" },
  { view: "contacts", icon: "people", label: "Contacts" },
  { view: "agenda", icon: "calendar", label: "Agenda" },
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
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pt-2">
    <!-- switcher: the three consultations this register offers -->
    <div class="mb-1 flex flex-none items-center gap-1 rounded-[4px] border border-rule p-1">
      <button
        v-for="entry in switcher"
        :key="entry.view"
        class="flex flex-1 items-center justify-center gap-1.5 rounded-[3px] px-1 py-1 text-[12px]"
        :class="ui.activeView === entry.view ? 'bg-tint font-semibold text-ink' : 'text-ink-3 hover:text-ink'"
        :aria-pressed="ui.activeView === entry.view"
        @click="ui.openView(entry.view)"
      >
        <IconGlyph :name="entry.icon" :size="14" />
        {{ entry.label }}
      </button>
    </div>

    <!-- scope: the whole register -->
    <button
      class="flex w-full items-center gap-2 rounded-[4px] px-2 py-1.5 text-left text-[13px]"
      :class="!accounts.scopeFolder && ui.activeView === 'mail' ? 'bg-tint font-semibold text-ink' : 'text-ink-2 hover:bg-tint-soft'"
      :aria-current="!accounts.scopeFolder && ui.activeView === 'mail' ? 'true' : undefined"
      @click="selectScope('all')"
    >
      <IconGlyph name="book" :size="15" class="text-ink-3" />
      <span class="flex-1 truncate">All mail</span>
      <span v-if="accounts.registerUnread > 0" class="tabular text-[11.5px] font-semibold" style="color: var(--accent)">
        {{ groupCount(accounts.registerUnread) }}
      </span>
    </button>

    <!-- accounts -->
    <div class="mt-3">
      <button
        v-for="account in accounts.accounts"
        :key="account.id"
        class="flex w-full items-center gap-2 rounded-[4px] px-2 py-1.5 text-left text-[13px]"
        :class="accounts.selectedAccountId === account.id ? 'bg-tint font-semibold text-ink' : 'text-ink-2 hover:bg-tint-soft'"
        :aria-current="accounts.selectedAccountId === account.id ? 'true' : undefined"
        @click="selectAccount(account.id)"
      >
        <span
          class="account-chip"
          :style="{ background: `var(--acct-${account.colorIndex})` }"
          aria-hidden="true"
        />
        <span class="flex-1 truncate">{{ account.label }}</span>
        <span
          v-if="accounts.accountUnread(account.id) > 0"
          class="tabular text-[11.5px] font-semibold"
          :style="{ color: accounts.selectedAccountId === account.id ? 'var(--accent)' : 'var(--ink-3)' }"
        >
          {{ groupCount(accounts.accountUnread(account.id)) }}
        </span>
      </button>
    </div>

    <!-- folders of the selected account -->
    <div v-if="folders.length" class="mt-3 mb-2 border-t border-rule pt-2">
      <button
        v-for="folder in folders"
        :key="folder.path"
        class="flex w-full items-center gap-2 rounded-[4px] py-1.5 pr-2 text-left text-[13px]"
        :class="[
          folder.depth > 0 ? 'pl-6' : 'pl-2',
          accounts.scopeFolder === folder.path ? 'bg-tint font-semibold text-ink' : 'text-ink-2 hover:bg-tint-soft',
        ]"
        :aria-current="accounts.scopeFolder === folder.path ? 'true' : undefined"
        @click="selectScope(folder.path)"
      >
        <IconGlyph :name="folderIcon(folder.kind)" :size="14" class="text-ink-3" />
        <span class="flex-1 truncate">{{ folder.name }}</span>
        <span class="agate !text-ink-3">{{ groupCount(folder.total) }}</span>
        <span
          v-if="folder.unread > 0"
          class="tabular min-w-[1.6em] text-right text-[11.5px] font-semibold"
          style="color: var(--accent)"
        >
          {{ folder.unread }}
        </span>
      </button>
    </div>

    <!-- docked agenda: the week at a glance (full page behind the switcher) -->
    <AgendaWidget class="mt-auto" />
  </div>

  <!-- footer: backend status / demo label -->
  <div class="border-t border-rule px-3 py-2">
    <div v-if="health" class="flex items-center gap-2">
      <span
        class="h-1.5 w-1.5 rounded-full"
        :style="{ background: health.commonpost?.reachable ? 'var(--pass)' : 'var(--fail)' }"
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
        class="rounded-sm p-1 text-ink-3 hover:text-ink"
        :aria-label="healthChecking ? 'Checking backend' : 'Check backend status'"
        :title="healthChecking ? 'Checking…' : 'Check status'"
        @click="checkHealth"
      >
        <IconGlyph name="refresh" :size="13" :class="healthChecking ? 'animate-spin' : ''" />
      </button>
    </div>
    <div v-if="ui.backendKind === 'mock'" class="agate mt-1" style="color: var(--warn)">
      Demo data — mock backend
    </div>
  </div>
</template>
