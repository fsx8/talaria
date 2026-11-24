<script setup lang="ts">
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { computed } from "vue";
import IconGlyph from "./IconGlyph.vue";
import { useMailStore } from "../stores/mail";
import { useUiStore } from "../stores/ui";

const ui = useUiStore();
const mail = useMailStore();

const reading = computed(() => ui.phoneView === "reader");

function focusSearch() {
  const id = window.matchMedia("(max-width: 767px)").matches ? "talaria-search-phone" : "talaria-search";
  const input = document.getElementById(id) as HTMLInputElement | null;
  if (input) {
    window.scrollTo({ top: 0 });
    input.focus();
  }
}
</script>

<template>
  <nav
    class="flex h-14 flex-none items-stretch border-t border-base-300 bg-base-200 pb-[env(safe-area-inset-bottom)] md:hidden"
    aria-label="Phone navigation"
  >
    <template v-if="reading">
      <button
        class="flex flex-1 flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium"
        :class="ui.phoneView === 'reader' ? '' : 'text-base-content/55'"
        @click="ui.backToList()"
      >
        <IconGlyph name="arrow-left" :size="17" />
        Back
      </button>
      <button
        class="flex flex-1 flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium text-base-content/70 disabled:opacity-35"
        :disabled="!mail.prevId"
        @click="mail.selectPrev()"
      >
        <IconGlyph name="chevron-left" :size="17" />
        Prev
      </button>
      <button
        class="flex flex-1 flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium text-base-content/70 disabled:opacity-35"
        :disabled="!mail.nextId"
        @click="mail.selectNext()"
      >
        <IconGlyph name="chevron-right" :size="17" />
        Next
      </button>
    </template>
    <template v-else>
      <button
        class="flex flex-1 flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium text-base-content/70"
        @click="ui.toggleRailDrawer()"
      >
        <IconGlyph name="menu" :size="17" />
        Folders
      </button>
      <button
        class="flex flex-1 flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium text-base-content/70"
        @click="focusSearch"
      >
        <IconGlyph name="search" :size="17" />
        Search
      </button>
      <button
        class="flex flex-1 flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium"
        :class="mail.unreadOnly ? '' : 'text-base-content/55'"
        :aria-pressed="mail.unreadOnly"
        @click="mail.toggleUnreadFilter()"
      >
        <IconGlyph name="mail" :size="17" />
        Unread
      </button>
    </template>
  </nav>
</template>
