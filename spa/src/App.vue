<script setup lang="ts">
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { onBeforeUnmount, onMounted } from "vue";
import { getBackend } from "./api";
import AgendaView from "./components/AgendaView.vue";
import ContactsView from "./components/ContactsView.vue";
import MessageListPane from "./components/MessageListPane.vue";
import PhoneNav from "./components/PhoneNav.vue";
import ReaderPane from "./components/ReaderPane.vue";
import SidebarPane from "./components/SidebarPane.vue";
import TopBar from "./components/TopBar.vue";
import { useMailStore } from "./stores/mail";
import { useUiStore } from "./stores/ui";

const ui = useUiStore();
const mail = useMailStore();

let unsubscribe: (() => void) | null = null;

function onKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
    return;
  }
  if (event.key === "Escape") {
    if (ui.railDrawerOpen) {
      ui.closeRailDrawer();
    } else if (ui.phoneView === "reader") {
      ui.backToList();
    }
    return;
  }
  if (ui.isPhone && event.key === "Enter") {
    if (mail.selectedId) ui.openReader();
    return;
  }
  if (event.key === "ArrowDown" || event.key === "j") {
    event.preventDefault();
    mail.selectNext();
  } else if (event.key === "ArrowUp" || event.key === "k") {
    event.preventDefault();
    mail.selectPrev();
  }
}

onMounted(async () => {
  window.addEventListener("keydown", onKeydown);
  unsubscribe = getBackend().onMailEvent((event) => mail.onMailEvent(event));
  await mail.refresh();
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  unsubscribe?.();
});
</script>

<template>
  <TopBar />

  <div class="app-shell">
    <!-- Register rail: persistent pane on desktop, drawer below 1024px -->
    <aside
      class="flex min-h-0 flex-col bg-paper"
      :class="
        ui.railDrawerOpen
          ? 'max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-40 max-lg:w-72 max-lg:border-r max-lg:border-rule max-lg:shadow-[0_0_28px_var(--sheet-shadow)]'
          : 'max-lg:hidden lg:flex'
      "
      aria-label="Accounts and folders"
    >
      <SidebarPane />
    </aside>

    <div
      v-if="ui.railDrawerOpen"
      class="fixed inset-0 z-30 bg-[rgba(12,16,24,0.42)] lg:hidden"
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
    <AgendaView v-else class="min-h-0 flex-col lg:col-span-2" />
  </div>

  <PhoneNav v-if="ui.activeView === 'mail'" />
</template>
