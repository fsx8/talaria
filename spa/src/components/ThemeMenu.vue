<script setup lang="ts">
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import IconGlyph from "./IconGlyph.vue";
import { useUiStore } from "../stores/ui";
import type { ThemePreference } from "../stores/ui";

const ui = useUiStore();

const options: Array<{ value: ThemePreference; icon: "sun" | "monitor" | "moon"; label: string }> = [
  { value: "light", icon: "sun", label: "Light" },
  { value: "system", icon: "monitor", label: "System" },
  { value: "dark", icon: "moon", label: "Dark" },
];
</script>

<template>
  <div
    class="flex items-center rounded-[4px] border border-rule"
    role="radiogroup"
    aria-label="Theme"
  >
    <button
      v-for="option in options"
      :key="option.value"
      class="flex h-7 w-7 items-center justify-center rounded-[3px] first:rounded-l-[3px] last:rounded-r-[3px]"
      :class="ui.themePreference === option.value ? 'bg-tint text-ink' : 'text-ink-3 hover:text-ink'"
      :aria-pressed="ui.themePreference === option.value"
      :aria-label="`${option.label} theme`"
      :title="`${option.label} theme`"
      @click="ui.setTheme(option.value)"
    >
      <IconGlyph :name="option.icon" :size="14" />
    </button>
  </div>
</template>
