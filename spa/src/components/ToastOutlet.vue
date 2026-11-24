<script setup lang="ts">
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import IconGlyph from "./IconGlyph.vue";
import { useToastStore } from "../stores/toast";

/**
 * Marginalia outlet (Round 3, W1 organize): the confirmation slips for
 * write actions — bottom-end, agate voice, status dot instead of emoji.
 */
const toast = useToastStore();
</script>

<template>
  <div class="toast toast-end toast-bottom z-50 mb-16 md:mb-4" aria-live="polite">
    <div
      v-for="item in toast.items"
      :key="item.id"
      class="marginalia flex items-center gap-2 rounded-field border bg-base-100 px-3 py-2 shadow-[0_4px_18px_var(--sheet-shadow)]"
      :class="item.kind === 'ok' ? 'border-base-300' : 'border-error/50'"
    >
      <span class="status" :class="item.kind === 'ok' ? 'status-success' : 'status-error'" aria-hidden="true" />
      <span class="text-[12.5px]">{{ item.text }}</span>
      <button
        type="button"
        class="btn btn-ghost btn-xs btn-circle ml-0.5"
        aria-label="Dismiss"
        @click="toast.dismiss(item.id)"
      >
        <IconGlyph name="close" :size="11" />
      </button>
    </div>
  </div>
</template>
