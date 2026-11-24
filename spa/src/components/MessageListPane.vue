<script setup lang="ts">
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useVirtualizer } from "@tanstack/vue-virtual";
import { computed, ref, watch } from "vue";
import IconGlyph from "./IconGlyph.vue";
import MessageRow from "./MessageRow.vue";
import MoveMenu from "./MoveMenu.vue";
import { groupCount } from "../composables/format";
import { useComposeStore } from "../stores/compose";
import { useMailStore } from "../stores/mail";
import { useSettingsStore } from "../stores/settings";
import { useUiStore } from "../stores/ui";

const mail = useMailStore();
const ui = useUiStore();
const settings = useSettingsStore();
const compose = useComposeStore();

const scrollRef = ref<HTMLElement | null>(null);

const virtualizer = useVirtualizer(
  computed(() => ({
    count: mail.messages.length,
    getScrollElement: () => scrollRef.value,
    estimateSize: () => (settings.density === "compact" ? 46 : 66),
    overscan: 10,
    getItemKey: (index: number) => mail.messages[index]?.id ?? `idx-${index}`,
  })),
);

const virtualItems = computed(() => virtualizer.value.getVirtualItems());
const totalHeight = computed(() => virtualizer.value.getTotalSize());

watch(
  () => mail.selectedIndex,
  (index) => {
    if (index < 0) return;
    const items = virtualizer.value.getVirtualItems();
    if (items.length === 0) return;
    const first = items[0]!.index;
    const last = items[items.length - 1]!.index;
    if (index < first + 1 || index > last - 1) {
      virtualizer.value.scrollToIndex(index, { align: "auto" });
    }
  },
);

function onScroll() {
  if (!scrollRef.value || !mail.hasMore || mail.listAppending || mail.listLoading) return;
  const el = scrollRef.value;
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 480) {
    void mail.loadMore();
  }
}

function openRow(id: string) {
  void mail.select(id);
  // A Drafts-folder row re-opens in the composer (draftId update path) —
  // reading material and writing material are the same sheet there.
  const summary = mail.messages.find((m) => m.id === id);
  if (summary && compose.entryVisible && mail.selectedIsDraft && mail.selectedId === id) {
    void compose.openDraft(id);
    return;
  }
  if (ui.isPhone) ui.openReader();
}

function retry() {
  void mail.refresh();
}

/* ---- W1 organize: batch selection ---- */

const checkedRows = computed(() => mail.messages.filter((m) => mail.checkedIds.includes(m.id)));
const allCheckedRead = computed(
  () => checkedRows.value.length > 0 && checkedRows.value.every((m) => m.read),
);
const allCheckedFlagged = computed(
  () => checkedRows.value.length > 0 && checkedRows.value.every((m) => m.flagged),
);

function batchRead() {
  void mail.setRead(mail.checkedItems, !allCheckedRead.value);
}
function batchFlag() {
  void mail.setFlagged(mail.checkedItems, !allCheckedFlagged.value);
}
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col bg-base-200" aria-label="Message list">
    <!-- page head: scope, tally, filters — or the batch bar in select mode.
         Wraps when the pane runs narrow so no control (Done!) ever leaves
         the pane — leaving selection mode must work on a phone. -->
    <div class="flex min-h-10 flex-none flex-wrap items-center gap-x-2 gap-y-1 border-b border-base-300 px-3 py-1">
      <h2 class="min-w-0 truncate text-[13px] font-semibold">{{ mail.scopeLabel }}</h2>
      <span v-if="!mail.listLoading" class="agate flex-none">{{ groupCount(mail.totalMatches) }}</span>
      <!-- Stage 2: the implicit scope a typed query is filed under -->
      <span
        v-if="mail.typedScopeLabel"
        class="badge badge-ghost badge-sm agate max-w-[14ch] flex-none gap-1 truncate !font-normal"
        :title="`Search filed under ${mail.typedScopeLabel} (Settings → Search → Search scope)`"
      >
        <IconGlyph name="folder" :size="11" />
        <span class="truncate">{{ mail.typedScopeLabel }}</span>
      </span>
      <div class="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1">
        <!-- batch bar (selection mode) -->
        <template v-if="mail.selectMode">
          <span class="agate flex-none px-1" aria-live="polite">
            {{ mail.checkedCount }} selected
          </span>
          <MoveMenu :items="mail.checkedItems" :disabled="mail.checkedCount === 0" label="Move to" />
          <button
            class="btn btn-sm h-7 gap-1 px-2.5"
            :class="allCheckedRead ? 'btn-ghost text-base-content/70' : 'btn-primary'"
            :disabled="mail.checkedCount === 0 || mail.writeBusy"
            :aria-label="allCheckedRead ? 'Mark selected unread' : 'Mark selected read'"
            @click="batchRead"
          >
            <IconGlyph :name="allCheckedRead ? 'mail' : 'mail-open'" :size="12" />
            {{ allCheckedRead ? "Unread" : "Read" }}
          </button>
          <button
            class="btn btn-sm h-7 gap-1 px-2.5"
            :class="allCheckedFlagged ? 'btn-warning' : 'btn-ghost text-base-content/70'"
            :disabled="mail.checkedCount === 0 || mail.writeBusy"
            :aria-label="allCheckedFlagged ? 'Unflag selected' : 'Flag selected'"
            @click="batchFlag"
          >
            <IconGlyph name="flag" :size="12" />
            {{ allCheckedFlagged ? "Unflag" : "Flag" }}
          </button>
          <button
            class="btn btn-ghost btn-sm h-7 px-2.5 text-base-content/70"
            aria-label="Leave selection mode"
            title="Done"
            @click="mail.exitSelectMode()"
          >
            Done
          </button>
        </template>

        <!-- filters + selection entry -->
        <template v-else>
          <button
            class="btn btn-sm h-7 px-2.5"
            :class="mail.unreadOnly ? 'btn-primary' : 'btn-ghost text-base-content/70'"
            :aria-pressed="mail.unreadOnly"
            @click="mail.toggleUnreadFilter()"
          >
            Unread
          </button>
          <button
            class="btn btn-sm h-7 gap-1 px-2.5"
            :class="mail.flaggedOnly ? 'btn-warning' : 'btn-ghost text-base-content/70'"
            :aria-pressed="mail.flaggedOnly"
            @click="mail.toggleFlaggedFilter()"
          >
            <IconGlyph name="flag" :size="12" />
            Flagged
          </button>
          <button
            v-if="mail.actionsVisible"
            class="btn btn-sm h-7 gap-1 px-2.5 btn-ghost text-base-content/70"
            aria-label="Select entries for batch actions"
            title="Select"
            @click="mail.toggleSelectMode()"
          >
            <IconGlyph name="check" :size="12" />
            Select
          </button>
        </template>
      </div>
    </div>

    <!-- the register page -->
    <div
      ref="scrollRef"
      class="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      @scroll.passive="onScroll"
    >
      <!-- loading skeleton -->
      <div v-if="mail.listLoading && mail.messages.length === 0" class="space-y-3 px-3 py-3" aria-hidden="true">
        <div v-for="i in 9" :key="i" class="space-y-1.5 py-1">
          <div class="skeleton h-3 w-1/3" />
          <div class="skeleton h-3" :style="{ width: `${55 + ((i * 13) % 30)}%` }" />
        </div>
        <span class="sr-only">Loading messages…</span>
      </div>

      <!-- error -->
      <div v-else-if="mail.listError && mail.messages.length === 0" class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <IconGlyph name="alert" :size="26" class="text-base-content/55" />
        <p class="max-w-[36ch] text-[13px] text-base-content/70">{{ mail.listError }}</p>
        <button class="btn btn-neutral btn-sm" @click="retry">
          Try again
        </button>
      </div>

      <!-- empty -->
      <div v-else-if="!mail.listLoading && mail.messages.length === 0" class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <IconGlyph name="inbox" :size="26" class="text-base-content/55" />
        <p class="text-[13px] font-semibold">
          {{ mail.searchText ? "Nothing filed matches your search" : `Nothing filed under ${mail.scopeLabel}` }}
        </p>
        <p class="max-w-[34ch] text-[12.5px] text-base-content/55">
          {{
            mail.searchText
              ? "Check the spelling, or try fewer words — operators like from: or participant:@domain work here."
              : mail.unreadOnly || mail.flaggedOnly
                ? "A filter is active — turn it off to see the full page."
                : "New entries appear here as they arrive."
          }}
        </p>
        <button
          v-if="mail.searchText"
          class="btn btn-outline btn-sm text-base-content/70"
          @click="mail.setSearchText('')"
        >
          Clear search
        </button>
      </div>

      <!-- rows (virtualized) -->
      <div
        v-else
        class="relative w-full"
        :style="{ height: `${totalHeight}px` }"
        :data-density="settings.density"
        role="listbox"
        aria-label="Messages"
      >
        <div
          v-for="item in virtualItems"
          :key="item.index"
          :data-index="item.index"
          :ref="(el) => virtualizer.measureElement(el as Element | null)"
          class="absolute left-0 top-0 w-full"
          :style="{ transform: `translateY(${item.start}px)` }"
        >
          <MessageRow
            :summary="mail.messages[item.index]!"
            :selected="mail.messages[item.index]!.id === mail.selectedId"
            :derived-attachments="mail.derivedAttachments(mail.messages[item.index]!.id)"
            @open="openRow(mail.messages[item.index]!.id)"
          />
        </div>
      </div>

      <!-- pagination foot -->
      <div v-if="mail.messages.length > 0" class="px-3 pb-4 pt-1 text-center">
        <p v-if="mail.listAppending" class="agate" role="status">Filing more entries…</p>
        <button
          v-else-if="mail.hasMore"
          class="btn btn-outline btn-sm text-base-content/70"
          @click="mail.loadMore()"
        >
          Load more
          <span class="agate ml-1">of {{ groupCount(mail.totalMatches) }}</span>
        </button>
        <p v-else class="agate" role="status">End of the page · {{ groupCount(mail.totalMatches) }} entries</p>
      </div>
    </div>
  </section>
</template>
