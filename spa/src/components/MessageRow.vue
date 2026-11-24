<script setup lang="ts">
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { computed } from "vue";
import IconGlyph from "./IconGlyph.vue";
import { listDate, parseAddress, senderName } from "../composables/format";
import type { MessageSummary } from "../api";
import { useAccountsStore } from "../stores/accounts";
import { useMailStore } from "../stores/mail";

/**
 * One register row. W1 organize (Round 3): hover-revealed read/flag
 * toggles (overlay — the row grid never shifts, the virtualizer keeps its
 * measurements) and, in batch mode, a leading checkbox column. Stage 3:
 * drafts-folder rows file under the recipient's name — the author of a
 * draft is always you.
 */

const props = defineProps<{ summary: MessageSummary; selected: boolean; derivedAttachments?: boolean }>();
const emit = defineEmits<{ open: [] }>();

const mail = useMailStore();
const accounts = useAccountsStore();

const isDraft = computed(() => accounts.folderByPath(props.summary.folderPath)?.kind === "drafts");
const line1 = computed(() => {
  if (isDraft.value) {
    const to = props.summary.recipients.trim();
    return to ? `To: ${parseAddress(to.split(/[,;]+/)[0]!.trim()).name}` : "To: (no recipient)";
  }
  return senderName(props.summary.author);
});
const dateLabel = computed(() => listDate(props.summary.date));
const hasClip = computed(() => props.summary.hasAttachments ?? props.derivedAttachments);

function toggleRead() {
  mail.setRead([{ id: props.summary.id, folderPath: props.summary.folderPath }], !props.summary.read);
}
function toggleFlag() {
  mail.setFlagged([{ id: props.summary.id, folderPath: props.summary.folderPath }], !props.summary.flagged);
}
</script>

<template>
  <div
    class="group/row relative border-b border-base-300"
    :class="selected ? 'bg-base-300/70' : 'bg-transparent'"
    role="option"
    :aria-selected="selected"
  >
    <button
      class="register-row grid w-full gap-x-2 px-3 text-left"
      :class="mail.selectMode ? 'grid-cols-[16px_20px_1fr]' : 'grid-cols-[16px_1fr]'"
      @click="mail.selectMode ? mail.toggleChecked(summary.id) : emit('open')"
    >
      <!-- unread dot column -->
      <span class="flex justify-center pt-[6px]" aria-hidden="true">
        <span v-if="!summary.read" class="unread-dot arrive-step" />
        <span v-else class="h-[7px] w-[7px]" />
      </span>

      <!-- batch checkbox column (selection mode only) -->
      <span
        v-if="mail.selectMode"
        class="flex justify-center pt-[7px]"
        @click.stop.prevent
      >
        <input
          type="checkbox"
          class="checkbox checkbox-primary checkbox-xs"
          :checked="mail.checkedIds.includes(summary.id)"
          :aria-label="mail.checkedIds.includes(summary.id) ? 'Remove from selection' : 'Add to selection'"
          @change="mail.toggleChecked(summary.id)"
          @click.stop
        />
      </span>

      <span class="min-w-0">
        <!-- line 1: sender · date -->
        <span class="flex items-baseline gap-2">
          <span
            class="min-w-0 flex-1 truncate text-[13px] leading-[1.45]"
            :class="summary.read ? 'font-normal text-base-content/70' : 'font-semibold'"
          >{{ line1 }}</span>
          <span class="flex flex-none items-center gap-1.5">
            <IconGlyph
              v-if="summary.flagged"
              name="flag"
              :size="12"
              class="text-warning"
              aria-label="Flagged"
            />
            <IconGlyph
              v-if="hasClip"
              name="paperclip"
              :size="12"
              class="text-base-content/55"
              aria-label="Has attachments"
            />
            <time class="agate" :datetime="summary.date">{{ dateLabel }}</time>
          </span>
        </span>

        <!-- line 2: subject -->
        <span
          class="mt-0.5 block truncate text-[13px] leading-[1.45]"
          :class="summary.read ? 'font-normal text-base-content/70' : 'font-semibold'"
        >{{ summary.subject }}</span>

        <!-- line 3: agate preview -->
        <span class="row-preview mt-0.5 block truncate text-[11.5px] leading-[1.4] text-base-content/55">{{ summary.preview }}</span>
      </span>
    </button>

    <!-- quick actions: hover overlay, right-aligned over the date slot.
         Confirmation-free by design — both toggles are reversible. -->
    <div
      v-if="mail.actionsVisible && !mail.selectMode"
      class="row-actions absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100"
    >
      <button
        type="button"
        class="btn btn-ghost btn-xs btn-circle border-base-300 bg-base-100/90"
        :class="summary.flagged ? 'text-warning' : 'text-base-content/60'"
        :title="summary.flagged ? 'Remove flag' : 'Flag'"
        :aria-label="summary.flagged ? 'Remove flag' : 'Flag'"
        @click.stop="toggleFlag"
      >
        <IconGlyph name="flag" :size="13" />
      </button>
      <button
        type="button"
        class="btn btn-ghost btn-xs btn-circle border-base-300 bg-base-100/90"
        :class="summary.read ? 'text-base-content/60' : 'text-primary'"
        :title="summary.read ? 'Mark unread' : 'Mark read'"
        :aria-label="summary.read ? 'Mark unread' : 'Mark read'"
        @click.stop="toggleRead"
      >
        <IconGlyph :name="summary.read ? 'mail' : 'mail-open'" :size="13" />
      </button>
    </div>
  </div>
</template>
