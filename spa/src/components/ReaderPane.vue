<script setup lang="ts">
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import DOMPurify from "dompurify";
import { marked } from "marked";
import { computed, nextTick, ref, watch } from "vue";
import IconGlyph from "./IconGlyph.vue";
import MoveMenu from "./MoveMenu.vue";
import ThreadSection from "./ThreadSection.vue";
import { byteSize, fullDate, groupCount, initials, parseAddress } from "../composables/format";
import type { AttachmentInfo, MessageRef } from "../api";
import { getBackend } from "../api";
import { countRemoteImages, isTrackingPixel } from "../api/mime";
import { useAccountsStore } from "../stores/accounts";
import { useComposeStore } from "../stores/compose";
import { useMailStore } from "../stores/mail";
import { useSettingsStore } from "../stores/settings";
import { useToastStore } from "../stores/toast";

const mail = useMailStore();
const accounts = useAccountsStore();
const settings = useSettingsStore();
const toast = useToastStore();
const compose = useComposeStore();

// Sanitized rendering: markdown from the sidecar is converted, then stripped
// through DOMPurify. Remote images are consent-gated (Stage 2): blocked by
// default, per-message "Load images" opt-in, "always" / "never ask" in
// Settings → Privacy. Tracking-pixel-sized images (≤2px) stay stripped even
// when allowed — no read-receipts over Access.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
  if (node.tagName === "IMG") {
    // Privacy hygiene: lazy, no Referer leak, no janky decode.
    node.setAttribute("loading", "lazy");
    node.setAttribute("decoding", "async");
    node.setAttribute("referrerpolicy", "no-referrer");
  }
});

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/* ---- Stage 2: the remote-image consent gate ---- */

/** silent = keep stripping without a placeholder ("never ask"); blocked =
 *  strip + placeholder + per-message button; allowed = render (minus pixels). */
const remoteImages = computed<"silent" | "blocked" | "allowed">(() => {
  const detail = mail.selectedDetail;
  if (!detail || settings.neverAskRemoteImages) return "silent";
  if (settings.alwaysLoadRemoteImages || mail.remoteImagesAllowedFor(detail.id)) return "allowed";
  return "blocked";
});

/** Remote, non-pixel images in the raw body — the number the card reports. */
const blockedImageCount = computed<number>(() => {
  const detail = mail.selectedDetail;
  if (!detail || remoteImages.value !== "blocked") return 0;
  return countRemoteImages(rawBodyHtml(detail));
});

function allowImages() {
  const detail = mail.selectedDetail;
  if (detail) mail.allowRemoteImages(detail.id);
}

/** Markdown/plain → HTML, before sanitization (for image counting). */
function rawBodyHtml(detail: { body: string; bodyFormat: "markdown" | "text" | "html" }): string {
  if (detail.bodyFormat === "html") {
    // Raw HTML from the sidecar (bodyIsHtml) — the sanitizer is the gate.
    return detail.body;
  }
  if (detail.bodyFormat === "markdown") {
    return marked.parse(detail.body, { async: false, gfm: true, breaks: true }) as string;
  }
  return `<p>${escapeHtml(detail.body).replaceAll("\n", "<br />")}</p>`;
}

/** Remove tracking-pixel images (≤2px) from sanitized HTML. */
function stripTrackingPixels(html: string): string {
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    for (const img of [...doc.querySelectorAll("img")]) {
      if (isTrackingPixel(img)) img.remove();
    }
    return doc.body.innerHTML;
  } catch {
    return html;
  }
}

const bodyHtml = computed(() => {
  const detail = mail.selectedDetail;
  if (!detail) return "";
  const raw = rawBodyHtml(detail);
  const sanitized = DOMPurify.sanitize(raw, {
    FORBID_TAGS: remoteImages.value === "allowed" ? ["style", "form", "input"] : ["img", "style", "form", "input"],
    FORBID_ATTR: ["style", "srcset"],
    ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i,
  });
  return remoteImages.value === "allowed" ? stripTrackingPixels(sanitized) : sanitized;
});

/* Pixels that only reveal their size on load (no width/height attributes)
 * are removed after the render pass — the sheet never keeps them visible. */
const sheetRef = ref<HTMLElement | null>(null);

function stripLoadedPixels() {
  const article = sheetRef.value;
  if (!article) return;
  for (const img of [...article.querySelectorAll("img")]) {
    const check = () => {
      if (img.isConnected && img.naturalWidth > 0 && img.naturalWidth <= 2 && img.naturalHeight > 0 && img.naturalHeight <= 2) {
        img.remove();
      }
    };
    if (img.complete) check();
    else img.addEventListener("load", check, { once: true });
  }
}

watch(bodyHtml, () => {
  void nextTick(stripLoadedPixels);
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

const sealStatus = (v: Verdict): "status-success" | "status-error" | "status-neutral" =>
  v === "pass" ? "status-success" : v === "fail" ? "status-error" : "status-neutral";

const position = computed(() =>
  mail.selectedIndex >= 0 ? `${mail.selectedIndex + 1} of ${groupCount(mail.messages.length)} shown` : "",
);

function retryDetail() {
  const summary = mail.selectedSummary;
  if (summary) void mail.select(summary.id);
}

/* ---- W1 organize (Round 3): reader-side write affordances ---- */

/** The open record as a movable reference (summary carries the folder). */
const currentRef = computed<MessageRef[]>(() => {
  const detail = mail.selectedDetail;
  if (!detail) return [];
  return [{ id: detail.id, folderPath: mail.selectedSummary?.folderPath || detail.folderPath }];
});

/** Read/flag state as visible in the register or the thread panel. */
const currentRow = computed(() => {
  const id = mail.selectedDetail?.id;
  if (!id) return null;
  return mail.messages.find((m) => m.id === id) ?? mail.threadSummaries.find((m) => m.id === id) ?? null;
});

const isRead = computed(() => currentRow.value?.read ?? false);
const isFlagged = computed(() => currentRow.value?.flagged ?? false);

function toggleRead() {
  void mail.setRead(currentRef.value, !isRead.value);
}
function toggleFlag() {
  void mail.setFlagged(currentRef.value, !isFlagged.value);
}

/* ---- Stage 3 (W2 drafts): reply / reply-all / forward entry points ----
 * Draft-only: the composer opens prefilled; nothing is ever sent here. */

const canCompose = computed(() => compose.entryVisible);
const isDraftRecord = computed(() => mail.selectedIsDraft);

/* ---- Stage 2: export, print, attachment download ---- */

/** The seam carries the read-for-export tier? */
const canExport = computed(() => typeof getBackend().getMessageSource === "function");
const canDownload = computed(() => typeof getBackend().getAttachment === "function");

const exporting = ref(false);
const downloadingName = ref<string | null>(null);

/** ~25 MB comfort cap before we refuse (paged raw-source reads are costly). */
const DOWNLOAD_MAX_BYTES = 25 * 1024 * 1024;

/** Filesystem-safe name: separators and control chars out, length capped. */
function sanitizeFilename(raw: string, fallback: string): string {
  const cleaned = raw
    .replace(/[\\/:*?"<>|]/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    .trim();
  return cleaned || fallback;
}

function saveBlob(bytes: Uint8Array, filename: string, contentType: string) {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const url = URL.createObjectURL(new Blob([buffer], { type: contentType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Export .eml: exact RFC 2822 bytes, named from subject (+ date). */
async function exportEml() {
  const detail = mail.selectedDetail;
  if (!detail || !canExport.value || exporting.value) return;
  exporting.value = true;
  try {
    const folderPath = mail.selectedSummary?.folderPath || detail.folderPath;
    const { bytes } = await getBackend().getMessageSource!(detail.id, folderPath);
    const stamp = detail.date ? ` — ${detail.date.slice(0, 10)}` : "";
    const filename = `${sanitizeFilename(detail.subject, "message")}${stamp}.eml`;
    saveBlob(bytes, filename, "message/rfc822");
    toast.ok(`Record exported as ${filename}`);
  } catch (cause) {
    toast.err(cause instanceof Error ? cause.message : "The export failed.");
  } finally {
    exporting.value = false;
  }
}

/** Download one attachment via the raw-source extraction (≤25 MB guard). */
async function downloadAttachment(attachment: AttachmentInfo) {
  const detail = mail.selectedDetail;
  if (!detail || !canDownload.value || downloadingName.value) return;
  if ((attachment.size ?? 0) > DOWNLOAD_MAX_BYTES) {
    toast.err(`“${attachment.name}” is over the 25 MB download limit — use Thunderbird.`);
    return;
  }
  downloadingName.value = attachment.name;
  try {
    const folderPath = mail.selectedSummary?.folderPath || detail.folderPath;
    const { bytes } = await getBackend().getAttachment!(detail.id, folderPath, attachment);
    saveBlob(
      bytes,
      sanitizeFilename(attachment.name, "attachment"),
      attachment.contentType || "application/octet-stream",
    );
    toast.ok(`Saved ${sanitizeFilename(attachment.name, "attachment")}`);
  } catch (cause) {
    toast.err(cause instanceof Error ? cause.message : "The download failed.");
  } finally {
    downloadingName.value = null;
  }
}

/** Print: the sheet only (dedicated print CSS isolates it from the chrome). */
function printSheet() {
  window.print();
}
</script>

<template>
  <section class="flex min-h-0 flex-1 bg-base-200 md:border-l md:border-base-300" aria-label="Message reader">
    <!-- nothing selected -->
    <div v-if="!mail.selectedDetail && !mail.detailLoading && !mail.detailError" class="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center">
      <IconGlyph name="book" :size="28" class="text-base-content/55" />
      <p class="text-[13px] font-semibold">Choose an entry from the register</p>
      <p class="max-w-[34ch] text-[12.5px] text-base-content/55">
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
      <IconGlyph name="alert" :size="26" class="text-base-content/55" />
      <p class="max-w-[36ch] text-[13px] text-base-content/70">{{ mail.detailError }}</p>
      <button class="btn btn-neutral btn-sm" @click="retryDetail">
        Try again
      </button>
    </div>

    <!-- the record sheet -->
    <article v-else-if="mail.selectedDetail" ref="sheetRef" class="record-sheet mx-2 my-2 mb-2 min-w-0 flex-1 overflow-y-auto rounded-field">
      <div class="px-5 pb-5 pt-4 md:px-7">
        <!-- toolbar -->
        <div class="mb-3 flex items-center gap-1">
          <button
            class="btn btn-ghost btn-sm gap-0.5 px-2 disabled:opacity-40"
            :disabled="!mail.prevId"
            @click="mail.selectPrev()"
          >
            <IconGlyph name="chevron-left" :size="14" /> Prev
          </button>
          <button
            class="btn btn-ghost btn-sm gap-0.5 px-2 disabled:opacity-40"
            :disabled="!mail.nextId"
            @click="mail.selectNext()"
          >
            Next <IconGlyph name="chevron-right" :size="14" />
          </button>

          <!-- W1 organize: reversible, confirmation-free toggles + filing -->
          <template v-if="mail.actionsVisible">
            <span class="mx-1 h-5 w-px flex-none bg-base-300" aria-hidden="true" />
            <button
              class="btn btn-ghost btn-sm gap-1 px-2"
              :class="isRead ? 'text-base-content/70' : 'text-primary'"
              :title="isRead ? 'Mark unread' : 'Mark read'"
              :aria-label="isRead ? 'Mark unread' : 'Mark read'"
              :aria-pressed="isRead"
              :disabled="mail.writeBusy"
              @click="toggleRead"
            >
              <IconGlyph :name="isRead ? 'mail' : 'mail-open'" :size="14" />
              <span class="hidden md:inline">{{ isRead ? "Unread" : "Read" }}</span>
            </button>
            <button
              class="btn btn-ghost btn-sm gap-1 px-2"
              :class="isFlagged ? 'text-warning' : 'text-base-content/70'"
              :title="isFlagged ? 'Remove flag' : 'Flag'"
              :aria-label="isFlagged ? 'Remove flag' : 'Flag'"
              :aria-pressed="isFlagged"
              :disabled="mail.writeBusy"
              @click="toggleFlag"
            >
              <IconGlyph name="flag" :size="14" />
              <span class="hidden md:inline">{{ isFlagged ? "Unflag" : "Flag" }}</span>
            </button>
            <MoveMenu :items="currentRef" />
          </template>

          <!-- W2 drafts: reply / reply-all / forward — the composer opens
               prefilled and saves a draft (never sends) -->
          <template v-if="canCompose && !isDraftRecord">
            <span class="mx-1 h-5 w-px flex-none bg-base-300" aria-hidden="true" />
            <button
              class="btn btn-ghost btn-sm gap-1 px-2"
              title="Reply — saves a draft (R)"
              aria-label="Reply as a draft"
              @click="compose.openReply(false)"
            >
              <IconGlyph name="reply" :size="14" />
              <span class="hidden lg:inline">Reply</span>
            </button>
            <button
              class="btn btn-ghost btn-sm gap-1 px-2"
              title="Reply all — saves a draft (A)"
              aria-label="Reply all as a draft"
              @click="compose.openReply(true)"
            >
              <IconGlyph name="reply-all" :size="14" />
              <span class="hidden lg:inline">All</span>
            </button>
            <button
              class="btn btn-ghost btn-sm gap-1 px-2"
              title="Forward — saves a draft (Shift+F)"
              aria-label="Forward as a draft"
              @click="compose.openForward()"
            >
              <IconGlyph name="forward" :size="14" />
              <span class="hidden lg:inline">Forward</span>
            </button>
          </template>

          <!-- Stage 2: export + print -->
          <span v-if="canExport" class="mx-1 h-5 w-px flex-none bg-base-300" aria-hidden="true" />
          <button
            v-if="canExport"
            class="btn btn-ghost btn-sm gap-1 px-2"
            title="Export as .eml — the raw message with every header and attachment"
            aria-label="Export as .eml"
            :disabled="exporting"
            @click="exportEml"
          >
            <IconGlyph name="download" :size="14" />
            <span class="hidden md:inline">Export</span>
          </button>
          <button
            class="btn btn-ghost btn-sm gap-1 px-2"
            title="Print this record"
            aria-label="Print this record"
            @click="printSheet"
          >
            <IconGlyph name="print" :size="14" />
            <span class="hidden md:inline">Print</span>
          </button>

          <span v-if="position" class="agate ml-auto">{{ position }}</span>
        </div>

        <!-- subject + meta -->
        <h2 class="text-[17px] font-semibold leading-snug tracking-[-0.01em] md:text-[19px]">
          {{ mail.selectedDetail.subject }}
        </h2>

        <p v-if="isDraftRecord && canCompose" class="agate mt-1.5" role="note">
          Draft — open it again from the register (or press O) to keep writing in the composer.
        </p>

        <div class="mt-3 grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1">
          <span class="w-10 text-right agate">From</span>
          <span class="flex min-w-0 items-center gap-2">
            <span
              class="flex h-6 w-6 flex-none items-center justify-center rounded-full text-[10.5px] font-bold"
              :style="{ background: `color-mix(in oklab, var(--acct-${accountColor}) 18%, var(--color-base-100))`, color: `var(--acct-${accountColor})` }"
              aria-hidden="true"
            >
              {{ initials(sender.name) }}
            </span>
            <span class="truncate text-[13px] font-semibold">{{ sender.name }}</span>
            <span v-if="sender.email !== sender.name" class="truncate text-[12px] text-base-content/55">{{ sender.email }}</span>
          </span>

          <span class="w-10 text-right agate">To</span>
          <span class="truncate text-[12.5px] text-base-content/70" :title="mail.selectedDetail.recipients">{{ recipients }}</span>

          <template v-if="mail.selectedDetail.ccList">
            <span class="w-10 text-right agate">Cc</span>
            <span class="truncate text-[12.5px] text-base-content/70" :title="mail.selectedDetail.ccList">{{ mail.selectedDetail.ccList }}</span>
          </template>

          <span class="w-10 text-right agate">Filed</span>
          <span class="text-[12.5px] tabular text-base-content/70">{{ fullDate(mail.selectedDetail.date) }}</span>
        </div>

        <!-- seals + tags -->
        <div v-if="seals.length > 0 || mail.selectedDetail.tags.length" class="mt-3 flex flex-wrap items-center gap-1.5">
          <span
            v-for="seal in seals"
            :key="seal.label"
            class="badge badge-outline badge-sm gap-1.5 font-normal"
            :title="`${seal.label}: ${seal.verdict} — ${seal.detail}`"
          >
            <span class="status" :class="sealStatus(seal.verdict)" aria-hidden="true" />
            <span class="font-semibold text-base-content/70">{{ seal.label }}</span>
            <span class="text-base-content/55">{{ seal.verdict }}</span>
          </span>
          <span
            v-for="tag in mail.selectedDetail.tags"
            :key="tag"
            class="badge badge-dash badge-sm agate !h-auto !py-0.5 !font-normal"
          >
            {{ tag }}
          </span>
        </div>

        <hr class="my-4 border-base-300" />

        <!-- Stage 2: the remote-image consent card -->
        <div
          v-if="blockedImageCount > 0"
          class="mb-3 flex items-center gap-2 rounded-field border border-base-300 bg-base-200 px-3 py-2 print:hidden"
        >
          <IconGlyph name="image-off" :size="15" class="text-base-content/55" />
          <span class="min-w-0 flex-1 text-[12.5px] text-base-content/70">
            {{ blockedImageCount }} remote {{ blockedImageCount === 1 ? "image" : "images" }} blocked — senders can track opens.
          </span>
          <button class="btn btn-outline btn-xs flex-none" @click="allowImages">
            Load images
          </button>
        </div>

        <!-- body -->
        <div class="register-prose" v-html="bodyHtml" />

        <div v-if="mail.selectedDetail.bodyTruncated" class="mt-4 flex items-center gap-2 print:hidden">
          <p class="agate">{{ mail.bodyError ?? "This record is truncated." }}</p>
          <button
            class="btn btn-outline btn-xs"
            :disabled="mail.loadingMoreBody"
            @click="mail.loadMoreBody()"
          >
            {{ mail.loadingMoreBody ? "Loading…" : "Load full message" }}
          </button>
        </div>

        <!-- the conversation this record belongs to -->
        <ThreadSection class="print:hidden" />

        <!-- attachments inventory (Stage 2: entries download via raw-source extraction) -->
        <div v-if="mail.selectedDetail.attachments.length > 0" class="mt-6 border-t border-base-300 pt-3">
          <h3 class="text-[12px] font-semibold">Attachments</h3>
          <ul class="mt-2 space-y-1">
            <li
              v-for="attachment in mail.selectedDetail.attachments"
              :key="attachment.part ?? attachment.name"
              class="group flex items-center gap-2 text-[12.5px]"
            >
              <IconGlyph name="paperclip" :size="13" class="text-base-content/55" />
              <span class="truncate font-medium">{{ attachment.name }}</span>
              <span class="agate flex-none">{{ byteSize(attachment.size) }}</span>
              <span v-if="attachment.contentType" class="agate flex-none hidden md:inline">{{ attachment.contentType }}</span>
              <button
                v-if="canDownload"
                class="btn btn-ghost btn-xs btn-circle ml-auto flex-none opacity-0 group-hover:opacity-100 focus:opacity-100 print:hidden"
                :class="downloadingName === attachment.name ? 'opacity-100' : ''"
                :title="downloadingName === attachment.name ? `Saving ${attachment.name}…` : `Download ${attachment.name}`"
                :aria-label="`Download ${attachment.name}`"
                :disabled="downloadingName !== null"
                @click="downloadAttachment(attachment)"
              >
                <IconGlyph
                  :name="downloadingName === attachment.name ? 'refresh' : 'download'"
                  :size="13"
                  :class="downloadingName === attachment.name ? 'animate-spin' : ''"
                />
              </button>
            </li>
          </ul>
          <p class="agate mt-2">
            {{ canDownload
              ? "Attachments download exactly as the sender saved them — 25 MB per file at most."
              : "Downloads stay in Thunderbird — this register only lists them." }}
          </p>
        </div>
      </div>
    </article>
  </section>
</template>
