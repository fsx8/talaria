<script setup lang="ts">
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { computed } from "vue";
import IconGlyph from "./IconGlyph.vue";
import { ALL_THEMES, TALARIA_THEMES, THEME_GROUPS, themeEntry, type ThemeEntry } from "../theming";
import { useSettingsStore } from "../stores/settings";

/**
 * The Settings-page theme picker: one card per theme, grouped Talaria /
 * Light / Dark / Colorful, each with a live swatch (nested `data-theme`
 * scopes that theme's real tokens) and a scheme marker. "System" sits with
 * the Talaria group and resolves through the OS preference.
 */

const settings = useSettingsStore();

const groups = computed(() => THEME_GROUPS);
const systemActive = computed(() => settings.themeId === "system");

function isActive(entry: ThemeEntry): boolean {
  return settings.themeId === entry.id;
}

function pick(id: string) {
  settings.setTheme(id);
}

function nameOf(id: string): string {
  return themeEntry(id)?.name ?? id;
}
</script>

<template>
  <div class="space-y-4">
    <!-- system + the two Talaria identities -->
    <div class="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
      <button
        type="button"
        class="flex items-center gap-2.5 rounded-field border px-2.5 py-2 text-left transition-colors"
        :class="
          systemActive
            ? 'border-primary bg-primary/10'
            : 'border-base-300 bg-base-100 hover:bg-base-300/50'
        "
        :aria-pressed="systemActive"
        @click="pick('system')"
      >
        <span class="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-base-300">
          <IconGlyph name="monitor" :size="14" />
        </span>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-[12.5px] font-semibold">System</span>
          <span class="agate block">Follows the OS setting</span>
        </span>
        <IconGlyph v-if="systemActive" name="check" :size="14" class="flex-none text-primary" />
      </button>

      <button
        v-for="entry in TALARIA_THEMES"
        :key="entry.id"
        type="button"
        class="flex items-center gap-2.5 rounded-field border px-2.5 py-2 text-left transition-colors"
        :class="
          isActive(entry)
            ? 'border-primary bg-primary/10'
            : 'border-base-300 bg-base-100 hover:bg-base-300/50'
        "
        :aria-pressed="isActive(entry)"
        @click="pick(entry.id)"
      >
        <span class="theme-swatch h-7 w-9 !rounded-full" :data-theme="entry.id" aria-hidden="true">
          <span class="w-2/5" :style="{ background: 'var(--color-base-100)' }" />
          <span class="w-1/5" :style="{ background: 'var(--color-base-300)' }" />
          <span class="w-2/5" :style="{ background: 'var(--color-primary)' }" />
        </span>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-[12.5px] font-semibold">{{ entry.name }}</span>
          <span class="agate flex items-center gap-1">
            <IconGlyph :name="entry.scheme === 'dark' ? 'moon' : 'sun'" :size="10" />
            {{ entry.scheme }}
          </span>
        </span>
        <IconGlyph v-if="isActive(entry)" name="check" :size="14" class="flex-none text-primary" />
      </button>
    </div>

    <!-- built-ins, grouped -->
    <div v-for="group in groups" :key="group.label">
      <h4 class="agate mb-1.5 uppercase tracking-[0.04em]">
        {{ group.label }}
        <span class="tabular">· {{ group.entries.length }}</span>
      </h4>
      <div class="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
        <button
          v-for="entry in group.entries"
          :key="entry.id"
          type="button"
          class="flex items-center gap-2.5 rounded-field border px-2.5 py-2 text-left transition-colors"
          :class="
            isActive(entry)
              ? 'border-primary bg-primary/10'
              : 'border-base-300 bg-base-100 hover:bg-base-300/50'
          "
          :aria-pressed="isActive(entry)"
          @click="pick(entry.id)"
        >
          <span class="theme-swatch h-6 w-8" :data-theme="entry.id" aria-hidden="true">
            <span class="w-2/5" :style="{ background: 'var(--color-base-100)' }" />
            <span class="w-1/5" :style="{ background: 'var(--color-base-300)' }" />
            <span class="w-2/5" :style="{ background: 'var(--color-primary)' }" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[12.5px]">{{ entry.name }}</span>
            <span class="sr-only">({{ entry.scheme }} scheme)</span>
          </span>
          <IconGlyph
            :name="entry.scheme === 'dark' ? 'moon' : 'sun'"
            :size="11"
            class="flex-none text-base-content/50"
          />
          <IconGlyph
            v-if="isActive(entry)"
            name="check"
            :size="14"
            class="flex-none text-primary"
          />
        </button>
      </div>
    </div>

    <p class="agate" aria-live="polite">
      Active theme: {{ settings.themeId === "system" ? `System → ${nameOf(settings.resolvedThemeId)}` : nameOf(settings.themeId) }}
      · {{ ALL_THEMES.length }} themes + system
    </p>
  </div>
</template>
