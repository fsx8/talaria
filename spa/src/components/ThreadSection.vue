<script setup lang="ts">
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import DOMPurify from "dompurify";
import { marked } from "marked";
import { computed, ref, watch } from "vue";
import IconGlyph from "./IconGlyph.vue";
import { byteSize, clockTime, dayMonthFormat, initials, parseAddress } from "../composables/format";
import type { MessageDetail } from "../api/types";
import { useMailStore } from "../stores/mail";

/**
 * The conversation panel of the record sheet: every message of the thread,
 * chronological, collapsed to an entry line except the opened ones. The
 * currently open record is marked in place (its body already fills the
 * sheet above); "Expand all" unfolds the whole transcript.
 */

const mail = useMailStore();

const openIds = ref<Set<string>>(new Set());

// A new selection resets the transcript's folds (the store resets its own
// expanded flag via resetThread()).
watch(
  () => mail.selectedId,
  () => {
    openIds.value = new Set();
  },
);

function toggle(id: string) {
  const next = new Set(openIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  openIds.value = next;
}

function expandAll() {
  if (mail.threadExpanded) {
    openIds.value = new Set();
    mail.toggleThreadExpanded();
  } else {
    const all = new Set(mail.thread.map((entry) => entry.summary.id));
    openIds.value = all;
    mail.threadExpanded = true;
  }
}

const allOpen = computed(() => mail.threadExpanded);

function isOpen(id: string): boolean {
  return openIds.value.has(id);
}

function retryThread() {
  void mail.loadThread();
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderBody(detail: MessageDetail): string {
  let raw: string;
  if (detail.bodyFormat === "markdown") {
    raw = marked.parse(detail.body, { async: false, gfm: true, breaks: true }) as string;
  } else if (detail.bodyFormat === "html") {
    // Thread transcripts never carry remote images (batch reads ask for
    // markdown) — but stay defensive: sanitize directly, images stripped.
    raw = detail.body;
  } else {
    raw = `<p>${escapeHtml(detail.body).replaceAll("\n", "<br />")}</p>`;
  }
  return DOMPurify.sanitize(raw, {
    FORBID_TAGS: ["img", "style", "form", "input"],
    FORBID_ATTR: ["style", "srcset"],
    ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i,
  });
}

function listStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const hour = date.getHours();
  const minute = date.getMinutes();
  if (hour === 0 && minute === 0) return dayMonthFormat.format(date);
  return `${dayMonthFormat.format(date)}, ${clockTime(iso)}`;
}
</script>

<template>
  <section v-if="mail.threadSummaries.length > 1 || mail.threadError" class="mt-6 border-t border-base-300 pt-3" aria-label="Conversation">
    <div class="flex items-baseline gap-2">
      <h3 class="text-[12px] font-semibold">
        Thread · {{ mail.threadSummaries.length }} messages
      </h3>
      <button
        class="btn btn-ghost btn-xs ml-auto"
        :aria-expanded="allOpen"
        @click="expandAll"
      >
        {{ allOpen ? "Collapse all" : "Expand all" }}
      </button>
    </div>

    <p v-if="mail.threadError" class="agate mt-2">
      {{ mail.threadError }}
      <button class="underline hover:text-base-content" @click="retryThread">Try again</button>
    </p>

    <!-- loading skeleton -->
    <div v-else-if="mail.threadLoading && mail.thread.length === 0" class="mt-2 space-y-1.5" aria-hidden="true">
      <div v-for="i in 3" :key="i" class="skeleton h-3" :style="{ width: `${50 + ((i * 17) % 40)}%` }" />
      <span class="sr-only">Loading conversation…</span>
    </div>

    <ol v-else class="mt-2 space-y-1">
      <li
        v-for="entry in mail.thread"
        :key="entry.summary.id"
        class="rounded-field"
        :class="entry.isCurrent ? 'border border-primary/40 bg-base-200' : 'border border-transparent'"
      >
        <!-- entry line -->
        <button
          class="flex w-full items-center gap-2 rounded-field px-2 py-1.5 text-left"
          :class="entry.isCurrent ? '' : 'hover:bg-base-300/50'"
          :aria-expanded="isOpen(entry.summary.id)"
          @click="entry.isCurrent ? undefined : toggle(entry.summary.id)"
        >
          <span
            class="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-base-300 text-[9px] font-bold text-base-content/70"
            aria-hidden="true"
          >
            {{ initials(parseAddress(entry.summary.author).name) }}
          </span>
          <span class="min-w-0 flex-1 line-clamp-1 text-[12.5px]" :class="entry.isCurrent ? 'font-semibold' : 'text-base-content/70'">
            {{ parseAddress(entry.summary.author).name }}
            <span v-if="!entry.isCurrent && entry.summary.subject !== mail.selectedDetail?.subject" class="text-base-content/55">
              — {{ entry.summary.subject }}
            </span>
          </span>
          <span v-if="entry.detail && entry.detail.attachments.length > 0" class="flex flex-none items-center gap-1">
            <IconGlyph name="paperclip" :size="11" class="text-base-content/55" />
            <span class="agate">{{ entry.detail.attachments.length }}</span>
          </span>
          <span v-if="!entry.summary.read" class="unread-dot flex-none" aria-label="unread" />
          <span class="agate flex-none tabular">{{ listStamp(entry.summary.date) }}</span>
          <IconGlyph
            v-if="!entry.isCurrent"
            :name="isOpen(entry.summary.id) ? 'chevron-down' : 'chevron-right'"
            :size="12"
            class="flex-none text-base-content/55"
          />
          <span v-if="entry.isCurrent" class="agate flex-none text-primary">this record</span>
        </button>

        <!-- expanded body -->
        <div v-if="entry.isCurrent ? false : isOpen(entry.summary.id) && entry.detail" class="px-2 pb-2">
          <p class="agate mb-1">
            To {{ entry.summary.recipients || "(unrecorded)" }}
            <template v-if="entry.summary.ccList"> · Cc {{ entry.summary.ccList }}</template>
          </p>
          <div class="thread-prose" v-html="renderBody(entry.detail!)" />
          <p v-if="entry.detail && entry.detail.attachments.length > 0" class="agate mt-1.5">
            {{ entry.detail.attachments.map((a) => a.name).join(", ") }}
            <template v-if="entry.detail.attachments[0] && entry.detail.attachments[0].size">
              · {{ byteSize(entry.detail.attachments[0].size) }}
            </template>
          </p>
        </div>
      </li>
    </ol>

    <p class="agate mt-2">
      The thread spans folders as filed — replies stay where Thunderbird keeps them.
    </p>
  </section>
</template>
