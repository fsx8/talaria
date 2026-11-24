<script setup lang="ts">
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { computed, ref, watch } from "vue";
import IconGlyph, { type IconName } from "./IconGlyph.vue";
import PushControl from "./PushControl.vue";
import SaveSearchControl from "./SaveSearchControl.vue";
import ThemeMenu from "./ThemeMenu.vue";
import { clockTime, groupCount } from "../composables/format";
import { useAccountsStore } from "../stores/accounts";
import { useComposeStore } from "../stores/compose";
import { useMailStore } from "../stores/mail";
import { useUiStore } from "../stores/ui";

const ui = useUiStore();
const mail = useMailStore();
const accounts = useAccountsStore();
const compose = useComposeStore();

const searchInput = ref<HTMLInputElement | null>(null);
const today = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" }).format(new Date());

/** Live unread: the locally reconciled rail tally. Read/flag toggles and
 *  folder refreshes land here immediately (applyPatch → refreshUnread), so
 *  the folio never waits on the 60 s poll. The SSE value seeds the baseline
 *  (seedFolio) and drives the late-arrival stamp — it never overrides the
 *  rail. With hidden accounts this is the honest number anyway: the rail
 *  counts visible accounts only. */
const folioUnread = computed(() => accounts.registerUnread);

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

/* Stage 3: the posture chip grows a third state — with the draft tier live
 * (and its controls shown) this view drafts, files and flags. */
const posture = computed<{ label: string; icon: IconName; hint: string }>(() => {
  if (mail.actionsVisible && compose.entryVisible) {
    return { label: "drafts enabled", icon: "compose", hint: "W2 drafts: compose, reply, reply-all and forward save drafts. Sending stays in Thunderbird." };
  }
  if (mail.actionsVisible) {
    return { label: "organize enabled", icon: "folder-in", hint: "W1 organize: mark read/unread, flag, move to folder, create folder. Send and drafts stay in Thunderbird." };
  }
  return { label: "read-only view", icon: "book", hint: "File, flag and send live in Thunderbird." };
});
</script>

<template>
  <header
    class="relative z-20 border-b border-base-300 bg-base-200"
    role="banner"
  >
    <nav class="navbar h-14 min-h-14 gap-3 px-3 md:px-4">
      <!-- masthead -->
      <button
        class="flex items-center gap-2 rounded-sm max-lg:pr-1"
        :aria-label="ui.railDrawerOpen ? 'Close folders' : 'Open folders'"
        @click="ui.toggleRailDrawer()"
      >
        <IconGlyph :name="ui.railDrawerOpen ? 'close' : 'menu'" :size="18" class="text-base-content/70 lg:hidden" />
        <span class="hidden lg:inline-block">
          <span class="block font-sans text-[15px] font-bold leading-none tracking-[0.02em]">TALARIA</span>
          <span class="masthead-rule mt-1 w-full" aria-hidden="true" />
        </span>
      </button>
      <span class="flex items-center gap-1.5 lg:hidden">
        <span class="font-sans text-[15px] font-bold leading-none tracking-[0.02em]">TALARIA</span>
        <span class="masthead-rule mt-0.5 w-6" aria-hidden="true" />
      </span>

      <span
        class="badge badge-ghost badge-sm agate hidden gap-1 !font-normal md:inline-flex"
        :title="posture.hint"
      >
        <IconGlyph :name="posture.icon" :size="12" />
        {{ posture.label }}
      </span>

      <!-- Stage 3: the drafts composer entry (hidden when the backend or
           the courtesy switch says no) -->
      <button
        v-if="compose.entryVisible"
        type="button"
        class="btn btn-primary btn-sm h-8 gap-1.5 px-2.5 md:px-3"
        title="New message — saves as a draft (C)"
        @click="compose.openNew()"
      >
        <IconGlyph name="compose" :size="14" />
        <span class="hidden md:inline">Compose</span>
        <span class="md:hidden">New</span>
      </button>

      <!-- search: operators pass through to the sidecar; own row on phones -->
      <div class="hidden min-w-[110px] flex-1 md:block md:max-w-[460px]">
        <div class="flex w-full items-center">
          <label class="input input-sm h-8 min-w-0 flex-1 items-center gap-0 pl-2 pr-1">
            <IconGlyph
              name="search"
              :size="15"
              class="pointer-events-none text-base-content/55"
            />
            <input
              id="talaria-search"
              ref="searchInput"
              type="search"
              class="grow bg-transparent px-2 text-[13px]"
              placeholder="Search — from:, subject:, participant:@domain…"
              aria-label="Search mail"
              :value="mail.searchText"
              @input="onSearchInput"
              @keydown.escape="clearSearch"
            />
            <button
              v-if="mail.searchText"
              class="btn btn-ghost btn-xs btn-circle"
              aria-label="Clear search"
              @click="clearSearch"
            >
              <IconGlyph name="close" :size="13" />
            </button>
          </label>
          <SaveSearchControl />
        </div>
      </div>

      <!-- folio: date, live unread tally, late-entries stamp. The stamp
           stays above md — on phones the arrival toast carries the news
           and the bar must never clip the theme control. -->
      <div class="ml-auto flex min-w-0 flex-none items-center gap-2">
        <span class="agate hidden xl:inline">{{ today }}</span>
        <span
          class="flex items-center gap-1.5 rounded-field border border-base-300 bg-base-100 px-2 py-1"
          title="Unread across all accounts (Trash and Junk excluded)"
        >
          <span class="unread-dot" aria-hidden="true" />
          <span class="tabular text-[12px] font-semibold">{{ groupCount(folioUnread) }}</span>
          <span class="sr-only">unread messages</span>
        </span>
        <span
          v-if="lateEntryVisible && lateDelta > 0"
          :key="mail.lastMailEventAt"
          class="badge badge-soft badge-primary agate flip-step hidden gap-1 !font-semibold md:inline-flex"
          aria-live="polite"
        >
          <IconGlyph name="mail" :size="12" />
          +{{ lateDelta }} · {{ clockTime(mail.lastMailEvent!.ts) }}
        </span>
        <PushControl />
        <ThemeMenu />
        <button
          type="button"
          class="btn btn-ghost btn-square btn-sm h-7 w-7 flex-none"
          :class="ui.activeView === 'settings' ? 'bg-base-300 text-base-content' : ''"
          :aria-current="ui.activeView === 'settings' ? 'page' : undefined"
          aria-label="Settings"
          title="Settings"
          @click="ui.openView('settings')"
        >
          <IconGlyph name="gear" :size="14" />
        </button>
      </div>
    </nav>

    <!-- phone: full-width search row -->
    <div class="relative border-t border-base-300 px-3 py-2 md:hidden">
      <div class="flex w-full items-center">
        <label class="input input-sm h-9 min-w-0 flex-1 items-center gap-0 pl-2 pr-1">
          <IconGlyph
            name="search"
            :size="15"
            class="pointer-events-none text-base-content/55"
          />
          <input
            id="talaria-search-phone"
            type="search"
            class="grow bg-transparent px-2 text-[13px]"
            placeholder="Search — from:, subject:, participant:@domain…"
            aria-label="Search mail"
            :value="mail.searchText"
            @input="onSearchInput"
            @keydown.escape="clearSearch"
          />
          <button
            v-if="mail.searchText"
            class="btn btn-ghost btn-xs btn-circle"
            aria-label="Clear search"
            @click="clearSearch"
          >
            <IconGlyph name="close" :size="13" />
          </button>
        </label>
        <SaveSearchControl />
      </div>
    </div>
  </header>
</template>
