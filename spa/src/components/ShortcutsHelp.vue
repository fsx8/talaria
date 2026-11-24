<script setup lang="ts">
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import IconGlyph from "./IconGlyph.vue";
import { useUiStore } from "../stores/ui";

/**
 * The keyboard map, on one card (Stage 2). Opened with `?`, closed with
 * Escape or the backdrop — same stacking rules as the rail drawer.
 */

const ui = useUiStore();

interface Row {
  keys: string[];
  label: string;
}

const groups: Array<{ title: string; rows: Row[] }> = [
  {
    title: "Register",
    rows: [
      { keys: ["J", "↓"], label: "Next entry" },
      { keys: ["K", "↑"], label: "Previous entry" },
      { keys: ["Enter", "O"], label: "Open the highlighted record" },
      { keys: ["X"], label: "Toggle batch selection on the row" },
      { keys: ["F"], label: "Flag / unflag the record" },
      { keys: ["M"], label: "Open the move menu" },
    ],
  },
  {
    title: "Compose (drafts)",
    rows: [
      { keys: ["C"], label: "New message — saves as a draft" },
      { keys: ["R"], label: "Reply to the open record as a draft" },
      { keys: ["A"], label: "Reply all as a draft" },
      { keys: ["Shift", "F"], label: "Forward the record as a draft" },
      { keys: ["Esc"], label: "Close the composer — the draft saves first" },
    ],
  },
  {
    title: "Search & views",
    rows: [
      { keys: ["/"], label: "Focus the search field" },
      { keys: ["G", "I"], label: "Go to the inbox" },
      { keys: ["G", "S"], label: "Go to sent" },
      { keys: ["G", "D"], label: "Go to drafts" },
      { keys: ["G", "T"], label: "Go to the agenda & tasks" },
    ],
  },
  {
    title: "Sheets & overlays",
    rows: [{ keys: ["Esc"], label: "Close the reader, a menu or this overlay" }],
  },
];
</script>

<template>
  <Teleport to="body">
    <div
      v-if="ui.shortcutsOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(8,14,22,0.45)] p-4"
      @click.self="ui.closeShortcuts()"
    >
      <div
        class="w-full max-w-[560px] rounded-field border border-base-300 bg-base-100 shadow-[0_16px_48px_var(--sheet-shadow)]"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
      >
        <div class="flex items-center gap-2 border-b border-base-300 px-4 py-3">
          <IconGlyph name="keyboard" :size="16" class="text-base-content/70" />
          <h2 class="flex-1 text-[13px] font-semibold">Keyboard map</h2>
          <button
            type="button"
            class="btn btn-ghost btn-xs btn-circle"
            aria-label="Close shortcuts"
            @click="ui.closeShortcuts()"
          >
            <IconGlyph name="close" :size="13" />
          </button>
        </div>

        <div class="max-h-[70vh] overflow-y-auto px-4 py-3">
          <div class="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            <section v-for="group in groups" :key="group.title">
              <h3 class="agate mb-1.5 font-semibold uppercase tracking-[0.08em]">{{ group.title }}</h3>
              <dl class="space-y-1">
                <div v-for="row in group.rows" :key="row.label" class="flex items-baseline gap-2">
                  <dt class="flex flex-none items-center gap-1">
                    <kbd
                      v-for="key in row.keys"
                      :key="key"
                      class="kbd kbd-sm min-w-[1.7em] border border-base-300 bg-base-200 px-1.5 font-sans text-[11px] font-semibold"
                    >{{ key }}</kbd>
                  </dt>
                  <dd class="text-[12.5px] leading-snug text-base-content/75">{{ row.label }}</dd>
                </div>
              </dl>
            </section>
          </div>
        </div>

        <p class="agate border-t border-base-300 px-4 py-2">
          Single keys pause while you type in a field or select text in a record.
        </p>
      </div>
    </div>
  </Teleport>
</template>
