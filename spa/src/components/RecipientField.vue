<script setup lang="ts">
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { computed, ref, useAttrs, watch } from "vue";
import { getBackend } from "../api";
import type { Recipient } from "../api";
import { parseAddress } from "../composables/format";

/**
 * One recipient line of the composer: chips with an inline editor.
 * Typing queries the address books (searchContacts, debounced) — a picked
 * suggestion or any committed "Name <addr>" becomes a chip; paste splits
 * comma/semicolon lists. Entries without an @ simply don't commit — the
 * line stays as typed instead of storing something Thunderbird couldn't
 * send later.
 */

const props = defineProps<{
  modelValue: Recipient[];
  placeholder: string;
}>();
const emit = defineEmits<{ change: [value: Recipient[]]; pending: [value: boolean] }>();

// attrs (the aria-label) are bound explicitly on the input — no duplicate
// fallthrough onto the wrapper div.
defineOptions({ inheritAttrs: false });

/** The accessible name arrives as the `aria-label` attribute (fallthrough). */
const attrs = useAttrs();
const accessibleLabel = computed(() => (attrs["aria-label"] as string) ?? "Recipients");

const input = ref<HTMLInputElement | null>(null);
const draft = ref("");
const suggestions = ref<Recipient[]>([]);
const suggestOpen = ref(false);
const suggestIndex = ref(0);

const hasText = computed(() => draft.value.trim().length > 0);

function commit(text: string) {
  const parsed = parseAddress(text.trim().replace(/[,;]+$/, ""));
  if (!parsed.email || !parsed.email.includes("@")) return false;
  if (props.modelValue.some((r) => r.email.toLowerCase() === parsed.email.toLowerCase())) {
    draft.value = "";
    return true;
  }
  emit("change", [...props.modelValue, parsed]);
  draft.value = "";
  return true;
}

function removeChip(index: number) {
  const next = [...props.modelValue];
  next.splice(index, 1);
  emit("change", next);
  input.value?.focus();
}

function removeLast() {
  if (props.modelValue.length === 0) return;
  emit("change", props.modelValue.slice(0, -1));
}

function onKeydown(event: KeyboardEvent) {
  if (suggestOpen.value && suggestions.value.length > 0) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      suggestIndex.value = Math.min(suggestIndex.value + 1, suggestions.value.length - 1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      suggestIndex.value = Math.max(suggestIndex.value - 1, 0);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      addSuggestion(suggestions.value[suggestIndex.value]!);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      suggestOpen.value = false;
      return;
    }
  }
  if (event.key === "Enter" || event.key === "," || event.key === ";") {
    event.preventDefault();
    commit(draft.value);
    return;
  }
  if (event.key === "Backspace" && !hasText.value) {
    event.preventDefault();
    removeLast();
  }
}

function onPaste(event: ClipboardEvent) {
  const text = event.clipboardData?.getData("text") ?? "";
  if (!/[,;]/.test(text)) return; // single address: let the input handle it
  event.preventDefault();
  const added: Recipient[] = [...props.modelValue];
  for (const piece of text.split(/[,;]+/)) {
    const parsed = parseAddress(piece.trim());
    if (parsed.email.includes("@") && !added.some((r) => r.email.toLowerCase() === parsed.email.toLowerCase())) {
      added.push(parsed);
    }
  }
  emit("change", added);
}

/* ---- contact autocomplete (the address books are the learned contacts) ---- */

let queryTimer: ReturnType<typeof setTimeout> | null = null;
let querySeq = 0;

watch(draft, (value) => {
  // Honest dirty signal: typed-but-uncommitted text is not in the draft yet
  // (the composer's close guard asks before dropping it).
  emit("pending", value.trim().length > 0);
  if (queryTimer) clearTimeout(queryTimer);
  const query = value.trim();
  if (!query || query.includes(" ")) {
    // free text mid-word: only search the leading token-like query
    if (!query) {
      suggestions.value = [];
      suggestOpen.value = false;
      return;
    }
  }
  queryTimer = setTimeout(() => void queryContacts(query), 200);
});

async function queryContacts(query: string) {
  const seq = ++querySeq;
  try {
    const result = await getBackend().searchContacts(query, 0);
    if (seq !== querySeq) return; // superseded
    suggestions.value = result.contacts
      .filter((c) => c.email && !props.modelValue.some((r) => r.email.toLowerCase() === c.email.toLowerCase()))
      .slice(0, 6)
      .map((c) => ({ name: c.displayName, email: c.email }));
    suggestIndex.value = 0;
    suggestOpen.value = suggestions.value.length > 0;
  } catch {
    if (seq === querySeq) {
      suggestions.value = [];
      suggestOpen.value = false;
    }
  }
}

function addSuggestion(suggestion: Recipient) {
  if (!suggestion) return;
  emit("change", [...props.modelValue, suggestion]);
  draft.value = "";
  suggestions.value = [];
  suggestOpen.value = false;
  input.value?.focus();
}

function chipLabel(recipient: Recipient): string {
  return recipient.name && recipient.name !== recipient.email ? recipient.name : recipient.email;
}

function onBlur() {
  suggestOpen.value = false;
  // Commit what the line can hold on blur — a fully typed address must not
  // be lost to a missed Enter. Text without an @ cannot become a chip; it
  // stays in the field (pending) and the close guard asks before dropping.
  if (hasText.value) commit(draft.value);
}

defineExpose({
  focus() {
    input.value?.focus();
  },
});
</script>

<template>
  <div class="recipient-field relative min-w-0 flex-1">
    <div
      class="flex min-h-[30px] flex-wrap items-center gap-1 border-b border-base-300 px-0.5 py-0.5 transition-colors focus-within:border-primary"
      @click="input?.focus()"
    >
      <span
        v-for="(recipient, index) in modelValue"
        :key="recipient.email"
        class="recipient-chip"
        :title="recipient.name && recipient.name !== recipient.email ? `${recipient.name} <${recipient.email}>` : recipient.email"
      >
        <span class="max-w-[20ch] truncate">{{ chipLabel(recipient) }}</span>
        <span v-if="recipient.name && recipient.name !== recipient.email" class="agate hidden md:inline">{{ recipient.email }}</span>
        <button
          type="button"
          class="flex flex-none items-center rounded-full p-0.5 text-base-content/55 transition-colors hover:text-error"
          :aria-label="`Remove ${chipLabel(recipient)}`"
          @click.stop="removeChip(index)"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </span>
      <input
        ref="input"
        v-model="draft"
        type="text"
        class="min-w-[12ch] flex-1 grow bg-transparent px-1 py-0.5 text-[12.5px] outline-none placeholder:text-base-content/40"
        :placeholder="modelValue.length === 0 ? placeholder : ''"
        :aria-label="accessibleLabel"
        autocomplete="off"
        spellcheck="false"
        @keydown="onKeydown"
        @paste="onPaste"
        @blur="onBlur"
      />
    </div>

    <!-- address-book suggestions -->
    <ul
      v-if="suggestOpen"
      class="absolute left-0 right-0 top-full z-30 mt-1 max-h-[190px] overflow-y-auto rounded-field border border-base-300 bg-base-100 py-1 shadow-[0_10px_28px_var(--sheet-shadow)]"
      role="listbox"
      :aria-label="`${accessibleLabel} suggestions`"
    >
      <li v-for="(suggestion, index) in suggestions" :key="suggestion.email" role="option" :aria-selected="index === suggestIndex">
        <button
          type="button"
          class="flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-[12.5px] transition-colors"
          :class="index === suggestIndex ? 'bg-base-300/60' : 'hover:bg-base-300/40'"
          @mousedown.prevent="addSuggestion(suggestion)"
          @mouseenter="suggestIndex = index"
        >
          <span class="min-w-0 flex-1 truncate font-medium">{{ suggestion.name }}</span>
          <span class="agate flex-none">{{ suggestion.email }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>
