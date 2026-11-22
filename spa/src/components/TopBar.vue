<script setup lang="ts">
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { computed, ref, watch } from "vue";
import IconGlyph from "./IconGlyph.vue";
import PushControl from "./PushControl.vue";
import ThemeMenu from "./ThemeMenu.vue";
import { clockTime, groupCount } from "../composables/format";
import { useAccountsStore } from "../stores/accounts";
import { useMailStore } from "../stores/mail";
import { useUiStore } from "../stores/ui";

const ui = useUiStore();
const mail = useMailStore();
const accounts = useAccountsStore();

const searchInput = ref<HTMLInputElement | null>(null);
const today = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" }).format(new Date());

/** Live unread: the SSE tally once events flow, the folder tally before that. */
const folioUnread = computed(() => mail.lastMailEvent?.unread ?? accounts.registerUnread);

/** The folio flip: the last SSE arrival shows as a stamped correction for a while. */
const lateEntryVisible = ref(false);
let hideTimer: ReturnType<typeof setTimeout> | null = null;

watch(
  () => mail.lastMailEventAt,
  (at) => {
    if (!at) return;
    lateEntryVisible.value = true;
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      lateEntryVisible.value = false;
    }, 12_000);
  },
);

const lateDelta = computed(() => {
  const event = mail.lastMailEvent;
  if (!event) return 0;
  return Math.max(0, event.unread - event.previous);
});

function onSearchInput(event: Event) {
  mail.setSearchText((event.target as HTMLInputElement).value);
}

function clearSearch() {
  mail.setSearchText("");
  searchInput.value?.focus();
}
</script>

<template>
  <header
    class="relative z-20 border-b border-rule bg-paper"
    role="banner"
  >
    <div class="flex h-14 items-center gap-3 px-3 md:px-4">
      <!-- masthead -->
      <button
        class="flex items-center gap-2 rounded-sm text-ink max-lg:pr-1"
        :aria-label="ui.railDrawerOpen ? 'Close folders' : 'Open folders'"
        @click="ui.toggleRailDrawer()"
      >
        <IconGlyph :name="ui.railDrawerOpen ? 'close' : 'menu'" :size="18" class="lg:hidden text-ink-2" />
        <span class="hidden lg:inline-block">
          <span class="block font-sans text-[15px] font-bold leading-none tracking-[0.02em]">TALARIA</span>
          <span class="masthead-rule mt-1 w-full" aria-hidden="true" />
        </span>
      </button>
      <span class="lg:hidden flex items-center gap-1.5">
        <span class="font-sans text-[15px] font-bold leading-none tracking-[0.02em]">TALARIA</span>
        <span class="masthead-rule mt-0.5 w-6" aria-hidden="true" />
      </span>

      <span
        class="hidden md:inline-flex items-center gap-1 rounded-full border border-rule px-2 py-0.5 agate !text-ink-2"
        title="Every write tool is disabled server-side. File, flag and send live in Thunderbird."
      >
        <IconGlyph name="book" :size="12" />
        read-only view
      </span>

      <!-- search: operators pass through to the sidecar; own row on phones -->
      <div class="hidden min-w-[110px] flex-1 md:block md:max-w-[440px]">
        <div class="relative">
          <IconGlyph
            name="search"
            :size="15"
            class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3"
          />
          <input
            id="talaria-search"
            ref="searchInput"
            type="search"
            class="h-8 w-full rounded-[4px] border border-rule bg-sheet pl-8 pr-8 text-[13px] text-ink placeholder:text-ink-3 focus:border-rule-strong focus:outline-none"
            placeholder="Search — from:, subject:, participant:@domain…"
            aria-label="Search mail"
            :value="mail.searchText"
            @input="onSearchInput"
            @keydown.escape="clearSearch"
          />
          <button
            v-if="mail.searchText"
            class="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-1 text-ink-3 hover:text-ink"
            aria-label="Clear search"
            @click="clearSearch"
          >
            <IconGlyph name="close" :size="13" />
          </button>
        </div>
      </div>

      <!-- folio: date, live unread tally, late-entries stamp -->
      <div class="ml-auto flex flex-none items-center gap-2">
        <span class="agate hidden xl:inline">{{ today }}</span>
        <span
          class="flex items-center gap-1.5 rounded-[4px] border border-rule px-2 py-1"
          title="Unread across all accounts (Trash and Junk excluded)"
        >
          <span class="unread-dot" aria-hidden="true" />
          <span class="tabular text-[12px] font-semibold text-ink">{{ groupCount(folioUnread) }}</span>
          <span class="sr-only">unread messages</span>
        </span>
        <span
          v-if="lateEntryVisible && lateDelta > 0"
          :key="mail.lastMailEventAt"
          class="flip-step inline-flex items-center gap-1 rounded-[4px] px-1.5 py-1 text-[11px] font-semibold tabular"
          :style="{ background: 'var(--accent-soft)', color: 'var(--accent)' }"
          aria-live="polite"
        >
          <IconGlyph name="mail" :size="12" />
          +{{ lateDelta }} · {{ clockTime(mail.lastMailEvent!.ts) }}
        </span>
        <PushControl />
        <ThemeMenu />
      </div>
    </div>

    <!-- phone: full-width search row -->
    <div class="relative border-t border-rule px-3 py-2 md:hidden">
      <IconGlyph
        name="search"
        :size="15"
        class="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-ink-3"
      />
      <input
        id="talaria-search-phone"
        type="search"
        class="h-9 w-full rounded-[4px] border border-rule bg-sheet pl-8 pr-8 text-[13px] text-ink placeholder:text-ink-3 focus:border-rule-strong focus:outline-none"
        placeholder="Search — from:, subject:, participant:@domain…"
        aria-label="Search mail"
        :value="mail.searchText"
        @input="onSearchInput"
        @keydown.escape="clearSearch"
      />
      <button
        v-if="mail.searchText"
        class="absolute right-5 top-1/2 -translate-y-1/2 rounded-sm p-1 text-ink-3 hover:text-ink"
        aria-label="Clear search"
        @click="clearSearch"
      >
        <IconGlyph name="close" :size="13" />
      </button>
    </div>
  </header>
</template>
