<script setup lang="ts">
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { computed } from "vue";
import IconGlyph from "./IconGlyph.vue";
import { listDate, senderName } from "../composables/format";
import type { MessageSummary } from "../api";

const props = defineProps<{ summary: MessageSummary; selected: boolean; derivedAttachments?: boolean }>();
const emit = defineEmits<{ open: [] }>();

const sender = computed(() => senderName(props.summary.author));
const dateLabel = computed(() => listDate(props.summary.date));
const hasClip = computed(() => props.summary.hasAttachments ?? props.derivedAttachments);
</script>

<template>
  <div
    class="border-b border-rule-blue"
    :class="selected ? 'bg-tint' : 'bg-transparent'"
    role="option"
    :aria-selected="selected"
  >
    <button
      class="grid w-full grid-cols-[16px_1fr] gap-x-2 px-3 py-2 text-left"
      :class="selected ? 'bg-tint' : 'hover:bg-tint-soft'"
      @click="emit('open')"
    >
      <!-- unread dot column -->
      <span class="flex justify-center pt-[6px]" aria-hidden="true">
        <span v-if="!summary.read" class="unread-dot arrive-step" />
        <span v-else class="h-[7px] w-[7px]" />
      </span>

      <span class="min-w-0">
        <!-- line 1: sender · date -->
        <span class="flex items-baseline gap-2">
          <span
            class="min-w-0 flex-1 truncate text-[13px] leading-[1.45]"
            :class="summary.read ? 'font-normal text-ink-2' : 'font-semibold text-ink'"
          >{{ sender }}</span>
          <span class="flex flex-none items-center gap-1.5">
            <IconGlyph
              v-if="summary.flagged"
              name="flag"
              :size="12"
              class="text-[var(--warn)]"
              aria-label="Flagged"
            />
            <IconGlyph
              v-if="hasClip"
              name="paperclip"
              :size="12"
              class="text-ink-3"
              aria-label="Has attachments"
            />
            <time class="agate" :datetime="summary.date">{{ dateLabel }}</time>
          </span>
        </span>

        <!-- line 2: subject -->
        <span
          class="mt-0.5 block truncate text-[13px] leading-[1.45]"
          :class="summary.read ? 'font-normal text-ink-2' : 'font-semibold text-ink'"
        >{{ summary.subject }}</span>

        <!-- line 3: agate preview -->
        <span class="mt-0.5 block truncate text-[11.5px] leading-[1.4] text-ink-3">{{ summary.preview }}</span>
      </span>
    </button>
  </div>
</template>
