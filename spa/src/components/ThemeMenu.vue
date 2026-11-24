<script setup lang="ts">
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { ref } from "vue";
import IconGlyph from "./IconGlyph.vue";
import { THEME_GROUPS, type ThemeEntry } from "../theming";
import { useSettingsStore } from "../stores/settings";

/**
 * The TopBar theme entry point (Round 2): a grouped picker of the two
 * Talaria identities plus every daisyUI built-in. Each row carries a live
 * swatch (a nested `data-theme` scope reads that theme's real tokens) and a
 * sun/moon marker for its color-scheme. "System" resets to the OS preference.
 */

const settings = useSettingsStore();
const dropdown = ref<HTMLDetailsElement | null>(null);

function pick(id: string) {
  settings.setTheme(id);
  if (dropdown.value) dropdown.value.open = false;
}

function iconFor(entry: ThemeEntry): "sun" | "moon" {
  return entry.scheme === "dark" ? "moon" : "sun";
}
</script>

<template>
  <details ref="dropdown" class="dropdown dropdown-end">
    <summary
      class="btn btn-ghost btn-square btn-sm h-7 w-7 list-none [&::-webkit-details-marker]:hidden"
      aria-label="Choose theme"
      title="Theme"
    >
      <IconGlyph :name="settings.isDark ? 'moon' : 'sun'" :size="14" />
    </summary>

    <ul
      class="menu menu-sm dropdown-content z-40 mt-1 max-h-[70vh] w-60 overflow-y-auto rounded-field border border-base-300 bg-base-100 p-1 shadow-lg"
    >
      <li>
        <button
          :class="settings.themeId === 'system' ? 'menu-active' : ''"
          aria-label="Follow the OS preference"
          @click="pick('system')"
        >
          <IconGlyph name="monitor" :size="14" />
          <span class="flex-1 text-left">System</span>
          <span class="agate">OS setting</span>
        </button>
      </li>

      <template v-for="group in THEME_GROUPS" :key="group.label">
        <li class="menu-title agate !mt-1.5 !mb-0.5 !px-2 !py-0.5 uppercase tracking-[0.04em]">
          {{ group.label }}
        </li>
        <li v-for="entry in group.entries" :key="entry.id">
          <button
            :class="settings.themeId === entry.id ? 'menu-active' : ''"
            :aria-label="`${entry.name} theme`"
            @click="pick(entry.id)"
          >
            <span class="theme-swatch" :data-theme="entry.id" aria-hidden="true">
              <span class="w-2/5" :style="{ background: 'var(--color-base-100)' }" />
              <span class="w-1/5" :style="{ background: 'var(--color-base-300)' }" />
              <span class="w-2/5" :style="{ background: 'var(--color-primary)' }" />
            </span>
            <span class="flex-1 truncate text-left">{{ entry.name }}</span>
            <IconGlyph :name="iconFor(entry)" :size="12" class="text-base-content/55" />
            <IconGlyph
              v-if="settings.themeId === entry.id"
              name="check"
              :size="12"
              class="text-primary"
            />
          </button>
        </li>
      </template>
    </ul>
  </details>
</template>
