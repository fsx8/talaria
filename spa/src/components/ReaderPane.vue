<script setup lang="ts">
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import DOMPurify from "dompurify";
import { marked } from "marked";
import { computed } from "vue";
import IconGlyph from "./IconGlyph.vue";
import ThreadSection from "./ThreadSection.vue";
import { byteSize, fullDate, groupCount, initials, parseAddress } from "../composables/format";
import { useAccountsStore } from "../stores/accounts";
import { useMailStore } from "../stores/mail";

const mail = useMailStore();
const accounts = useAccountsStore();

// Sanitized rendering: markdown from the sidecar is converted, then stripped
// through DOMPurify. Remote images are blocked (privacy: no tracking pixels
// over Access) — a "load images" affordance is deliberate Phase-4 scope.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const bodyHtml = computed(() => {
  const detail = mail.selectedDetail;
  if (!detail) return "";
  let raw: string;
  if (detail.bodyFormat === "markdown") {
    // Mail is written with hard newlines — render them as breaks.
    raw = marked.parse(detail.body, { async: false, gfm: true, breaks: true }) as string;
  } else {
    raw = `<p>${escapeHtml(detail.body).replaceAll("\n", "<br />")}</p>`;
  }
  return DOMPurify.sanitize(raw, {
    FORBID_TAGS: ["img", "style", "form", "input"],
    FORBID_ATTR: ["style", "srcset"],
    ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i,
  });
});

const sender = computed(() => parseAddress(mail.selectedDetail?.author ?? ""));
const recipients = computed(() => parseAddress(mail.selectedDetail?.recipients ?? "").name);

const accountColor = computed(() => {
  const folderPath = mail.selectedDetail?.folderPath;
  if (!folderPath) return 5;
  for (const folders of Object.values(accounts.foldersByAccount)) {
    const hit = folders.find((f) => folderPath.startsWith(f.path));
    if (hit) {
      const account = accounts.accounts.find((a) => a.id === hit.accountId);
      if (account) return account.colorIndex;
    }
  }
  return 5;
});

type Verdict = "pass" | "fail" | "other";

function verdict(result?: string): Verdict {
  if (!result) return "other";
  const r = result.toLowerCase();
  if (r === "pass") return "pass";
  if (r === "fail" || r === "hardfail") return "fail";
  return "other";
}

function dkimVerdict(): { verdict: Verdict; domains: string } {
  const dkim = mail.selectedDetail?.authentication?.dkim ?? [];
  if (dkim.length === 0) return { verdict: "other", domains: "no DKIM signature" };
  const domains = dkim.map((d) => d.domain ?? "?").join(", ");
  if (dkim.some((d) => verdict(d.result) === "fail")) return { verdict: "fail", domains };
  if (dkim.some((d) => verdict(d.result) === "pass")) return { verdict: "pass", domains };
  return { verdict: "other", domains };
}

const seals = computed(() => {
  const auth = mail.selectedDetail?.authentication;
  if (!auth) return [];
  const dkim = dkimVerdict();
  return [
    { label: "SPF", verdict: verdict(auth.spf?.result), detail: auth.spf?.domain ?? "no record" },
    { label: "DKIM", verdict: dkim.verdict, detail: dkim.domains },
    { label: "DMARC", verdict: verdict(auth.dmarc?.result), detail: auth.dmarc?.domain ?? "no record" },
  ];
});

const sealColor = (v: Verdict) => (v === "pass" ? "var(--pass)" : v === "fail" ? "var(--fail)" : "var(--ink-3)");

const position = computed(() =>
  mail.selectedIndex >= 0 ? `${mail.selectedIndex + 1} of ${groupCount(mail.messages.length)} shown` : "",
);

function retryDetail() {
  const summary = mail.selectedSummary;
  if (summary) void mail.select(summary.id);
}
</script>

<template>
  <section class="flex min-h-0 flex-1 bg-paper md:border-l md:border-rule" aria-label="Message reader">
    <!-- nothing selected -->
    <div v-if="!mail.selectedDetail && !mail.detailLoading && !mail.detailError" class="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center">
      <IconGlyph name="book" :size="28" class="text-ink-3" />
      <p class="text-[13px] font-semibold text-ink">Choose an entry from the register</p>
      <p class="max-w-[34ch] text-[12.5px] text-ink-3">
        The record sheet opens here — headers, delivery seals and attachments included.
      </p>
    </div>

    <!-- loading -->
    <div v-else-if="mail.detailLoading" class="w-full space-y-4 px-6 py-6" aria-hidden="true">
      <div class="skeleton h-4 w-2/3" />
      <div class="skeleton h-3 w-1/3" />
      <div class="space-y-2 pt-4">
        <div class="skeleton h-3 w-full" />
        <div class="skeleton h-3 w-11/12" />
        <div class="skeleton h-3 w-9/12" />
        <div class="skeleton h-3 w-10/12" />
      </div>
      <span class="sr-only">Opening record…</span>
    </div>

    <!-- error -->
    <div v-else-if="mail.detailError" class="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center">
      <IconGlyph name="alert" :size="26" class="text-ink-3" />
      <p class="max-w-[36ch] text-[13px] text-ink-2">{{ mail.detailError }}</p>
      <button
        class="rounded-[4px] px-3 py-1.5 text-[13px] font-semibold"
        :style="{ background: 'var(--ink)', color: 'var(--invoked-ink)' }"
        @click="retryDetail"
      >
        Try again
      </button>
    </div>

    <!-- the record sheet -->
    <article v-else-if="mail.selectedDetail" class="record-sheet mx-2 my-2 mb-2 min-w-0 flex-1 overflow-y-auto rounded-[4px]">
      <div class="px-5 pb-5 pt-4 md:px-7">
        <!-- toolbar -->
        <div class="mb-3 flex items-center gap-1">
          <button
            class="flex items-center gap-0.5 rounded-[4px] px-2 py-1 text-[12.5px] text-ink-2 enabled:hover:bg-tint-soft enabled:hover:text-ink disabled:opacity-40"
            :disabled="!mail.prevId"
            @click="mail.selectPrev()"
          >
            <IconGlyph name="chevron-left" :size="14" /> Prev
          </button>
          <button
            class="flex items-center gap-0.5 rounded-[4px] px-2 py-1 text-[12.5px] text-ink-2 enabled:hover:bg-tint-soft enabled:hover:text-ink disabled:opacity-40"
            :disabled="!mail.nextId"
            @click="mail.selectNext()"
          >
            Next <IconGlyph name="chevron-right" :size="14" />
          </button>
          <span v-if="position" class="agate ml-auto">{{ position }}</span>
        </div>

        <!-- subject + meta -->
        <h2 class="text-[17px] font-semibold leading-snug tracking-[-0.01em] text-ink md:text-[19px]">
          {{ mail.selectedDetail.subject }}
        </h2>

        <div class="mt-3 grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1">
          <span class="w-10 text-right agate !text-ink-3">From</span>
          <span class="flex min-w-0 items-center gap-2">
            <span
              class="flex h-6 w-6 flex-none items-center justify-center rounded-full text-[10.5px] font-bold"
              :style="{ background: `color-mix(in oklab, var(--acct-${accountColor}) 18%, var(--sheet))`, color: `var(--acct-${accountColor})` }"
              aria-hidden="true"
            >
              {{ initials(sender.name) }}
            </span>
            <span class="truncate text-[13px] font-semibold text-ink">{{ sender.name }}</span>
            <span v-if="sender.email !== sender.name" class="truncate text-[12px] text-ink-3">{{ sender.email }}</span>
          </span>

          <span class="w-10 text-right agate !text-ink-3">To</span>
          <span class="truncate text-[12.5px] text-ink-2" :title="mail.selectedDetail.recipients">{{ recipients }}</span>

          <template v-if="mail.selectedDetail.ccList">
            <span class="w-10 text-right agate !text-ink-3">Cc</span>
            <span class="truncate text-[12.5px] text-ink-2" :title="mail.selectedDetail.ccList">{{ mail.selectedDetail.ccList }}</span>
          </template>

          <span class="w-10 text-right agate !text-ink-3">Filed</span>
          <span class="text-[12.5px] tabular text-ink-2">{{ fullDate(mail.selectedDetail.date) }}</span>
        </div>

        <!-- seals + tags -->
        <div v-if="seals.length > 0 || mail.selectedDetail.tags.length" class="mt-3 flex flex-wrap items-center gap-1.5">
          <span
            v-for="seal in seals"
            :key="seal.label"
            class="inline-flex items-center gap-1.5 rounded-full border border-rule px-2 py-0.5 text-[11px]"
            :title="`${seal.label}: ${seal.verdict} — ${seal.detail}`"
          >
            <span class="h-1.5 w-1.5 rounded-full" :style="{ background: sealColor(seal.verdict) }" aria-hidden="true" />
            <span class="font-semibold text-ink-2">{{ seal.label }}</span>
            <span class="text-ink-3">{{ seal.verdict }}</span>
          </span>
          <span
            v-for="tag in mail.selectedDetail.tags"
            :key="tag"
            class="rounded-[3px] border border-rule-blue px-1.5 py-0.5 text-[11px] text-ink-2"
          >
            {{ tag }}
          </span>
        </div>

        <hr class="my-4 border-rule" />

        <!-- body -->
        <div class="register-prose" v-html="bodyHtml" />

        <div v-if="mail.selectedDetail.bodyTruncated" class="mt-4 flex items-center gap-2">
          <p class="agate">{{ mail.bodyError ?? "This record is truncated." }}</p>
          <button
            class="rounded-[4px] border border-rule px-2.5 py-1 text-[12.5px] text-ink-2 hover:bg-tint-soft hover:text-ink"
            :disabled="mail.loadingMoreBody"
            @click="mail.loadMoreBody()"
          >
            {{ mail.loadingMoreBody ? "Loading…" : "Load full message" }}
          </button>
        </div>

        <!-- the conversation this record belongs to -->
        <ThreadSection />

        <!-- attachments inventory (read-only: no downloads in this view) -->
        <div v-if="mail.selectedDetail.attachments.length > 0" class="mt-6 border-t border-rule pt-3">
          <h3 class="text-[12px] font-semibold text-ink">Attachments</h3>
          <ul class="mt-2 space-y-1">
            <li
              v-for="attachment in mail.selectedDetail.attachments"
              :key="attachment.part ?? attachment.name"
              class="flex items-center gap-2 text-[12.5px]"
            >
              <IconGlyph name="paperclip" :size="13" class="text-ink-3" />
              <span class="truncate font-medium text-ink">{{ attachment.name }}</span>
              <span class="agate flex-none">{{ byteSize(attachment.size) }}</span>
              <span v-if="attachment.contentType" class="agate flex-none hidden md:inline">{{ attachment.contentType }}</span>
            </li>
          </ul>
          <p class="agate mt-2">
            Downloads stay in Thunderbird — this register only lists them.
          </p>
        </div>
      </div>
    </article>
  </section>
</template>
