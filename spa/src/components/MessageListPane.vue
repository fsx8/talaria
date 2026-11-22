<script setup lang="ts">
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useVirtualizer } from "@tanstack/vue-virtual";
import { computed, ref, watch } from "vue";
import IconGlyph from "./IconGlyph.vue";
import MessageRow from "./MessageRow.vue";
import { groupCount } from "../composables/format";
import { useMailStore } from "../stores/mail";
import { useUiStore } from "../stores/ui";

const mail = useMailStore();
const ui = useUiStore();

const scrollRef = ref<HTMLElement | null>(null);

const virtualizer = useVirtualizer(
  computed(() => ({
    count: mail.messages.length,
    getScrollElement: () => scrollRef.value,
    estimateSize: () => 66,
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
  if (ui.isPhone) ui.openReader();
}

function retry() {
  void mail.refresh();
}
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col bg-paper" aria-label="Message list">
    <!-- page head: scope, tally, filters -->
    <div class="flex h-10 flex-none items-center gap-2 border-b border-rule px-3">
      <h2 class="flex-none text-[13px] font-semibold text-ink">{{ mail.scopeLabel }}</h2>
      <span v-if="!mail.listLoading" class="agate flex-none">{{ groupCount(mail.totalMatches) }}</span>
      <div class="ml-auto flex flex-none items-center gap-1">
        <button
          class="rounded-[4px] border px-2 py-0.5 text-[12px]"
          :class="mail.unreadOnly ? 'border-transparent font-semibold text-invoked' : 'border-rule text-ink-2 hover:text-ink'"
          :style="mail.unreadOnly ? { background: 'var(--accent)', color: 'var(--invoked-ink)' } : {}"
          :aria-pressed="mail.unreadOnly"
          @click="mail.toggleUnreadFilter()"
        >
          Unread
        </button>
        <button
          class="flex items-center gap-1 rounded-[4px] border px-2 py-0.5 text-[12px]"
          :class="mail.flaggedOnly ? 'border-transparent font-semibold' : 'border-rule text-ink-2 hover:text-ink'"
          :style="mail.flaggedOnly ? { background: 'var(--warn)', color: 'var(--invoked-ink)' } : {}"
          :aria-pressed="mail.flaggedOnly"
          @click="mail.toggleFlaggedFilter()"
        >
          <IconGlyph name="flag" :size="12" />
          Flagged
        </button>
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
        <IconGlyph name="alert" :size="26" class="text-ink-3" />
        <p class="max-w-[36ch] text-[13px] text-ink-2">{{ mail.listError }}</p>
        <button
          class="rounded-[4px] px-3 py-1.5 text-[13px] font-semibold"
          :style="{ background: 'var(--ink)', color: 'var(--invoked-ink)' }"
          @click="retry"
        >
          Try again
        </button>
      </div>

      <!-- empty -->
      <div v-else-if="!mail.listLoading && mail.messages.length === 0" class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <IconGlyph name="inbox" :size="26" class="text-ink-3" />
        <p class="text-[13px] font-semibold text-ink">
          {{ mail.searchText ? "Nothing filed matches your search" : `Nothing filed under ${mail.scopeLabel}` }}
        </p>
        <p class="max-w-[34ch] text-[12.5px] text-ink-3">
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
          class="rounded-[4px] border border-rule px-3 py-1.5 text-[13px] text-ink-2 hover:text-ink"
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
          class="rounded-[4px] border border-rule px-3 py-1.5 text-[12.5px] text-ink-2 hover:bg-tint-soft hover:text-ink"
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
