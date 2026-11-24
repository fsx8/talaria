<script setup lang="ts">
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { nextTick, ref } from "vue";
import IconGlyph from "./IconGlyph.vue";
import { useMailStore } from "../stores/mail";
import { useSearchesStore } from "../stores/searches";
import { useToastStore } from "../stores/toast";

/**
 * "Keep this search" (Stage 2): a bookmark control inside the search bar.
 * Appears only when a query is typed; the popover asks for a display name
 * (pre-filled from the query), saves into the searches store, and the rail
 * gains an entry under "Searches".
 */

const mail = useMailStore();
const searches = useSearchesStore();
const toast = useToastStore();

const root = ref<HTMLDetailsElement | null>(null);
const nameInput = ref<HTMLInputElement | null>(null);
const draftName = ref("");

function onToggle() {
  if (!root.value?.open) return;
  draftName.value = searches.items.find((item) => item.query === mail.searchText.trim())?.name ?? "";
  void nextTick(() => nameInput.value?.focus());
}

async function save() {
  const saved = searches.add(draftName.value || mail.searchText.trim(), mail.searchText.trim());
  if (saved) {
    toast.ok(`Search kept as “${saved.name}”`);
    close();
  }
}

function close() {
  draftName.value = "";
  root.value?.removeAttribute("open");
}
</script>

<template>
  <details
    ref="root"
    class="dropdown dropdown-end flex-none"
    :class="mail.searchText.trim() ? '' : 'hidden'"
    @toggle="onToggle"
  >
    <summary
      class="btn btn-ghost btn-xs btn-circle m-0.5"
      title="Keep this search"
      aria-label="Keep this search"
    >
      <IconGlyph name="bookmark" :size="13" />
    </summary>

    <div
      class="dropdown-content z-30 mt-1 w-[240px] rounded-field border border-base-300 bg-base-100 p-2.5 shadow-[0_8px_28px_var(--sheet-shadow)]"
      role="form"
      aria-label="Save the current search"
    >
      <label class="agate mb-1 block font-semibold uppercase tracking-[0.08em]">Keep this search</label>
      <p class="agate mb-2 truncate" :title="mail.searchText">“{{ mail.searchText }}”</p>
      <input
        ref="nameInput"
        v-model="draftName"
        type="text"
        class="input input-ghost input-sm h-8 w-full border border-base-300 px-2 text-[12.5px]"
        placeholder="Name — e.g. Insurance 2026"
        aria-label="Name for the saved search"
        @keydown.enter.prevent="save"
        @keydown.escape.prevent="close"
      />
      <div class="mt-2 flex items-center justify-between gap-2">
        <span class="agate">Listed in the rail</span>
        <button
          type="button"
          class="btn btn-primary btn-sm h-7 px-3"
          :disabled="!mail.searchText.trim()"
          @click="save"
        >
          Keep
        </button>
      </div>
    </div>
  </details>
</template>
