<script setup lang="ts">
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import DOMPurify from "dompurify";
import { computed, nextTick, ref, watch } from "vue";
import { EditorContent, useEditor } from "@tiptap/vue-3";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import IconGlyph from "./IconGlyph.vue";
import RecipientField from "./RecipientField.vue";
import { clockTime } from "../composables/format";
import { useAccountsStore } from "../stores/accounts";
import { useComposeStore } from "../stores/compose";

/**
 * The drafts composer (Round 3, Stage 3): a record sheet placed on top of
 * the register — same paper, same rules. Every path here ends in a DRAFT:
 * the footer says so, always, and there is no send affordance anywhere.
 *
 * Editor: Tiptap 3 (Vue binding). Its schema is the paste sanitizer —
 * scripts and styles cannot survive parsing — and stored draft bodies are
 * additionally round-tripped through DOMPurify when a draft is reopened
 * (images stripped: a draft must not phone home while it is being edited).
 */

const compose = useComposeStore();
const accounts = useAccountsStore();

/** Every identity of every visible account, flattened for the From select. */
const identities = computed(() =>
  accounts.visibleAccounts.flatMap((account) =>
    account.identities.map((identity) => ({
      email: identity.email,
      label:
        identity.name && identity.name !== identity.email ? `${identity.name} — ${identity.email}` : identity.email,
    })),
  ),
);

const showCc = ref(false);
const showBcc = ref(false);

watch(
  () => compose.open,
  (open) => {
    if (!open) return;
    showCc.value = compose.cc.length > 0;
    showBcc.value = compose.bcc.length > 0;
    void nextTick(() => editor.value?.commands.focus("end"));
  },
);

/** The sheet owns Escape and Ctrl+Enter even while the editor has focus —
 *  the app-level typing guard would otherwise swallow them. Escape closes
 *  (the draft saves first, or asks when the save failed); Ctrl+Enter saves. */
function onSheetKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && !compose.confirm) {
    event.preventDefault();
    event.stopPropagation();
    void compose.attemptClose();
    return;
  }
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    event.stopPropagation();
    saveDraft();
  }
}

/** Show Cc/Bcc rows on demand (agate links while both are empty). */
function revealCc() {
  showCc.value = true;
}
function revealBcc() {
  showBcc.value = true;
}

/* ---- the editor ---- */

/** Stored bodies are sanitized before they enter the editor (strip scripts,
 *  styles and images — the draft being edited must not fetch anything). */
function sanitizeBody(html: string): string {
  if (!html) return "";
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ["img", "style", "form", "input", "link", "meta"],
    FORBID_ATTR: ["style", "srcset"],
    ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i,
  });
}

const sanitizedOriginal = computed(() => sanitizeBody(compose.targetBodyHtml));

const lastEmitted = ref<string>("");

const editor = useEditor({
  content: "",
  extensions: [
    StarterKit.configure({
      heading: false,
      codeBlock: false,
      code: false,
      horizontalRule: false,
    }),
    Placeholder.configure({ placeholder: "Write your message…" }),
  ],
  editorProps: {
    attributes: {
      class: "compose-prose",
      "aria-label": "Message body",
      spellcheck: "true",
    },
  },
  onUpdate: ({ editor: instance }) => {
    const html = instance.getHTML();
    lastEmitted.value = html;
    compose.setBody(html);
  },
  onBlur: () => compose.flushOnBlur(),
});

/** Store-driven body changes (draft opened, reset) seed the editor;
 *  editor-driven changes come back identical and are ignored (no loop). */
watch(
  () => compose.body,
  (value) => {
    if (!editor.value) return;
    if (value === lastEmitted.value) return;
    lastEmitted.value = value;
    editor.value.commands.setContent(sanitizeBody(value), { emitUpdate: false });
  },
);

/* Reactive toolbar state: the editor instance is shallow, so transactions
 * bump a tick to re-evaluate the active/can queries. */
const tick = ref(0);

const editorReady = computed(() => {
  void tick.value;
  return editor.value !== undefined;
});

function isActive(kind: string): boolean {
  void tick.value;
  return editor.value?.isActive(kind) ?? false;
}

function canUndo(): boolean {
  void tick.value;
  return editor.value?.can().undo() ?? false;
}

function run(command: (chain: ReturnType<NonNullable<typeof editor.value>["chain"]>) => unknown) {
  const instance = editor.value;
  if (!instance) return;
  command(instance.chain().focus());
  tick.value += 1;
}

/* ---- saved indicator ---- */

const savedLabel = computed(() => {
  if (compose.saving) return "Saving…";
  if (compose.saveError) return "Not saved";
  if (compose.savedAt) return `Draft saved · ${clockTime(new Date(compose.savedAt).toISOString())}`;
  if (compose.draftId) return "Draft in your mailbox";
  return "";
});

const savedDot = computed(() =>
  compose.saving ? "status-warning" : compose.saveError ? "status-error" : "status-success",
);

function saveDraft() {
  void compose.save({ manual: true });
}

function onFromChange(event: Event) {
  compose.from = (event.target as HTMLSelectElement).value;
  compose.markDirty();
}

function onSubjectInput(event: Event) {
  compose.subject = (event.target as HTMLInputElement).value;
  compose.markDirty();
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="compose.open"
      class="compose-overlay fixed inset-0 z-50 flex flex-col items-center justify-center bg-[rgba(8,14,22,0.45)] md:p-6 print:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Drafts composer"
      @click.self="compose.attemptClose()"
    >
      <div
        class="compose-sheet flex h-full w-full max-w-[760px] flex-col overflow-hidden border border-base-300 bg-base-100 md:h-auto md:max-h-[min(88vh,780px)] md:rounded-field md:shadow-[0_18px_56px_var(--sheet-shadow)]"
        @keydown="onSheetKeydown"
      >
        <!-- head: what this sheet is, and where the last save stands -->
        <header class="flex flex-none items-center gap-2 border-b border-base-300 px-4 py-2.5">
          <IconGlyph :name="compose.mode === 'draft' ? 'mail' : 'compose'" :size="15" class="text-base-content/70" />
          <h2 class="text-[13px] font-semibold">{{ compose.title }}</h2>
          <span v-if="compose.mode !== 'new'" class="agate hidden min-w-0 truncate md:inline" :title="compose.targetSubject">
            {{ compose.targetSubject }}
          </span>
          <span v-if="savedLabel" class="ml-auto flex flex-none items-center gap-1.5" aria-live="polite">
            <span class="status" :class="savedDot" aria-hidden="true" />
            <span class="agate" :class="compose.saveError ? 'text-error' : ''">{{ savedLabel }}</span>
          </span>
          <button
            type="button"
            class="btn btn-ghost btn-xs btn-circle flex-none"
            :class="savedLabel ? '' : 'ml-auto'"
            :title="compose.dirty ? 'Close — the draft saves first' : 'Close'"
            aria-label="Close composer"
            @click="compose.attemptClose()"
          >
            <IconGlyph name="close" :size="13" />
          </button>
        </header>

        <!-- fields: the reader's meta grid, mirrored -->
        <div class="flex flex-none flex-col gap-0.5 px-4 pt-3">
          <div class="grid grid-cols-[52px_1fr] items-center gap-x-2">
            <label class="agate w-[52px] text-right" for="compose-from">From</label>
            <select
              id="compose-from"
              class="select h-8 w-full min-w-0 border-0 bg-transparent px-1 text-[12.5px] font-medium focus:outline-hidden"
              :value="compose.from"
              @change="onFromChange"
            >
              <option v-if="!identities.some((i) => i.email === compose.from)" :value="compose.from">
                {{ compose.from }}
              </option>
              <option v-for="identity in identities" :key="identity.email" :value="identity.email">
                {{ identity.label }}
              </option>
            </select>
          </div>

          <div class="grid grid-cols-[52px_1fr] items-start gap-x-2">
            <label class="agate w-[52px] pt-[7px] text-right">To</label>
            <div class="flex min-w-0 items-center gap-2">
              <RecipientField
                class="min-w-0 flex-1"
                :model-value="compose.to"
                aria-label="To recipients"
                placeholder="name@example.de"
                @change="(value) => { compose.to = value; compose.markDirty(); }"
              />
              <button
                v-if="!showCc && !showBcc"
                type="button"
                class="agate btn btn-ghost btn-xs h-7 flex-none px-1.5 text-base-content/60"
                aria-label="Show Cc field"
                @click="revealCc"
              >
                Cc
              </button>
              <button
                v-if="!showBcc"
                type="button"
                class="agate btn btn-ghost btn-xs h-7 flex-none px-1.5 text-base-content/60"
                aria-label="Show Bcc field"
                @click="revealBcc"
              >
                Bcc
              </button>
            </div>
          </div>

          <div v-if="showCc" class="grid grid-cols-[52px_1fr] items-start gap-x-2">
            <label class="agate w-[52px] pt-[7px] text-right">Cc</label>
            <RecipientField
              :model-value="compose.cc"
              aria-label="Cc recipients"
              placeholder="name@example.de"
              @change="(value) => { compose.cc = value; compose.markDirty(); }"
            />
          </div>

          <div v-if="showBcc" class="grid grid-cols-[52px_1fr] items-start gap-x-2">
            <label class="agate w-[52px] pt-[7px] text-right">Bcc</label>
            <RecipientField
              :model-value="compose.bcc"
              aria-label="Bcc recipients"
              placeholder="name@example.de"
              @change="(value) => { compose.bcc = value; compose.markDirty(); }"
            />
          </div>

          <div class="grid grid-cols-[52px_1fr] items-center gap-x-2">
            <label class="agate w-[52px] text-right" for="compose-subject">Subject</label>
            <input
              id="compose-subject"
              type="text"
              class="w-full border-0 border-b border-base-300 bg-transparent px-1 py-1.5 text-[13.5px] font-semibold transition-colors placeholder:text-base-content/40 focus:border-primary focus:outline-hidden"
              placeholder="Subject"
              :value="compose.subject"
              @input="onSubjectInput"
            />
          </div>
        </div>

        <!-- format bar: the four things email needs -->
        <div class="flex flex-none items-center gap-0.5 border-b border-base-300 px-4 py-1">
          <button
            type="button"
            class="btn btn-ghost btn-xs h-7 w-7 p-0 font-semibold"
            :class="isActive('bold') ? 'bg-base-300 text-base-content' : 'text-base-content/70'"
            :disabled="!editorReady"
            title="Bold (Ctrl+B)"
            aria-label="Bold"
            @click="run((chain) => chain.toggleBold().run())"
          >
            B
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-xs h-7 w-7 p-0 font-semibold italic"
            :class="isActive('italic') ? 'bg-base-300 text-base-content' : 'text-base-content/70'"
            :disabled="!editorReady"
            title="Italic (Ctrl+I)"
            aria-label="Italic"
            @click="run((chain) => chain.toggleItalic().run())"
          >
            I
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-xs h-7 w-7 p-0"
            :class="isActive('bulletList') ? 'bg-base-300 text-base-content' : 'text-base-content/70'"
            :disabled="!editorReady"
            title="Bullet list"
            aria-label="Bullet list"
            @click="run((chain) => chain.toggleBulletList().run())"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
              <path d="M9 6.5h11M9 12h11M9 17.5h11" />
              <circle cx="5" cy="6.5" r="1.1" fill="currentColor" stroke="none" />
              <circle cx="5" cy="12" r="1.1" fill="currentColor" stroke="none" />
              <circle cx="5" cy="17.5" r="1.1" fill="currentColor" stroke="none" />
            </svg>
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-xs h-7 w-7 p-0"
            :class="isActive('orderedList') ? 'bg-base-300 text-base-content' : 'text-base-content/70'"
            :disabled="!editorReady"
            title="Numbered list"
            aria-label="Numbered list"
            @click="run((chain) => chain.toggleOrderedList().run())"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
              <path d="M10 6.5h10M10 12h10M10 17.5h10" />
              <path d="M4 6h1.4v3M4 10.5h2M4 13.5h1.5a1 1 0 0 1 0 2H5a1 1 0 0 0 0 2h1.5" />
            </svg>
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-xs h-7 w-7 p-0"
            :class="isActive('blockquote') ? 'bg-base-300 text-base-content' : 'text-base-content/70'"
            :disabled="!editorReady"
            title="Quote"
            aria-label="Quote"
            @click="run((chain) => chain.toggleBlockquote().run())"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M8 6.5c-2.5 1-4 3-4 6V18h5v-5H6c0-2 .8-3.4 2-4.2z" />
              <path d="M19 6.5c-2.5 1-4 3-4 6V18h5v-5h-3c0-2 .8-3.4 2-4.2z" />
            </svg>
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-xs h-7 w-7 p-0"
            :disabled="!editorReady || !canUndo()"
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
            @click="run((chain) => chain.undo().run())"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M8.5 5.5 4 10l4.5 4.5" />
              <path d="M4 10h10a6 6 0 0 1 6 6v1.5" />
            </svg>
          </button>
          <span
            v-if="compose.mode === 'reply'"
            class="agate ml-auto hidden md:inline"
          >
            Thunderbird adds the quote + signature when the draft saves
          </span>
          <span v-else-if="compose.mode === 'forward'" class="agate ml-auto hidden xl:inline">
            Forwarded attachments are not copied — Thunderbird does that on send
          </span>
        </div>

        <!-- the writing surface -->
        <div class="min-h-0 flex-1 overflow-y-auto px-4">
          <EditorContent :editor="editor" class="compose-editor" />
        </div>

        <!-- reply: the original, for reference (Thunderbird builds the quote
             at save time; forwards carry theirs inside the editor) -->
        <details
          v-if="compose.mode === 'reply' || compose.mode === 'replyAll'"
          class="group flex-none border-t border-base-300"
        >
          <summary class="flex cursor-pointer list-none items-center gap-2 px-4 py-1.5 transition-colors hover:bg-base-300/40">
            <IconGlyph name="chevron-down" :size="12" class="text-base-content/55 transition-transform group-open:rotate-180" />
            <span class="agate font-semibold uppercase tracking-[0.06em]">Original message</span>
            <span class="agate min-w-0 truncate">{{ compose.targetAuthor }} · {{ compose.targetSubject }}</span>
          </summary>
          <div
            class="compose-original register-prose max-h-[220px] overflow-y-auto border-t border-base-300 px-5 py-3"
            v-html="sanitizedOriginal"
          />
        </details>

        <!-- footer: the honest contract (notice wraps above the buttons on phones) -->
        <footer class="flex flex-none flex-col gap-2 border-t border-base-300 px-4 py-2.5 sm:flex-row sm:items-center sm:gap-2">
          <div class="flex flex-none items-center gap-2">
            <button
              type="button"
              class="btn btn-ghost btn-sm h-8 gap-1 px-2 text-base-content/70 transition-colors hover:text-error"
              :title="compose.draftId ? 'Move this draft to Trash' : 'Close without saving'"
              @click="compose.confirmDiscard()"
            >
              <IconGlyph name="trash" :size="14" />
              <span class="hidden md:inline">Discard</span>
            </button>
          </div>

          <p class="agate mx-auto flex max-w-[52ch] items-center justify-center gap-1.5 text-center">
            <IconGlyph name="mail" :size="12" class="flex-none text-base-content/55" />
            Drafts save to your mailbox — sending happens in Thunderbird or on your phone.
          </p>

          <button
            type="button"
            class="btn btn-primary btn-sm ml-auto h-8 w-full gap-1.5 px-3.5 sm:ml-0 sm:w-auto"
            :disabled="compose.saving"
            @click="saveDraft"
          >
            <IconGlyph :name="compose.saving ? 'refresh' : 'check'" :size="14" :class="compose.saving ? 'animate-spin' : ''" />
            Save draft
          </button>
        </footer>
      </div>

      <!-- nested confirm: discard / close-unsaved -->
      <div
        v-if="compose.confirm"
        class="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(8,14,22,0.35)] p-4"
        role="alertdialog"
        aria-modal="true"
        :aria-label="compose.confirm === 'discard' ? 'Discard draft' : 'Draft not saved'"
        @click.self="compose.cancelConfirm()"
      >
        <div class="w-full max-w-[380px] rounded-field border border-base-300 bg-base-100 p-4 shadow-[0_16px_48px_var(--sheet-shadow)]">
          <template v-if="compose.confirm === 'discard'">
            <h3 class="text-[13px] font-semibold">Discard this draft?</h3>
            <p class="mt-1 text-[12.5px] leading-snug text-base-content/70">
              {{
                compose.draftId
                  ? "The saved copy moves to Trash — Thunderbird can still recover it there."
                  : "Nothing has been saved yet; closing loses what you typed."
              }}
            </p>
            <div class="mt-3 flex justify-end gap-2">
              <button type="button" class="btn btn-ghost btn-sm" @click="compose.cancelConfirm()">Keep editing</button>
              <button type="button" class="btn btn-error btn-sm" @click="compose.discard()">
                {{ compose.draftId ? "Move to Trash" : "Discard" }}
              </button>
            </div>
          </template>
          <template v-else>
            <h3 class="text-[13px] font-semibold">Draft not saved</h3>
            <p class="mt-1 text-[12.5px] leading-snug text-base-content/70">
              The last save failed — the mailbox does not have your latest text. Close anyway?
            </p>
            <div class="mt-3 flex justify-end gap-2">
              <button type="button" class="btn btn-ghost btn-sm" @click="compose.cancelConfirm()">Keep editing</button>
              <button type="button" class="btn btn-neutral btn-sm" @click="compose.close()">Close without saving</button>
            </div>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>
