<script setup lang="ts">
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Authored icon set — one 24×24 grid, 1.6 stroke, round joins. No emoji,
 * no unicode glyph stand-ins; every icon is a drawn path.
 */
export type IconName =
  | "search"
  | "folder"
  | "inbox"
  | "flag"
  | "paperclip"
  | "chevron-left"
  | "chevron-right"
  | "chevron-down"
  | "arrow-left"
  | "sun"
  | "moon"
  | "monitor"
  | "mail"
  | "alert"
  | "refresh"
  | "menu"
  | "close"
  | "book"
  | "people"
  | "calendar"
  | "bell"
  | "repeat";

defineProps<{ name: IconName; size?: number }>();
</script>

<template>
  <svg
    :width="size ?? 18"
    :height="size ?? 18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class="shrink-0"
  >
    <template v-if="name === 'search'">
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5" />
    </template>
    <template v-else-if="name === 'folder'">
      <path d="M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h4l2 2.5h8a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z" />
    </template>
    <template v-else-if="name === 'inbox'">
      <path d="M4 13.5 6.2 5.6A1.5 1.5 0 0 1 7.65 4.5h8.7a1.5 1.5 0 0 1 1.45 1.1L20 13.5" />
      <path d="M4 13.5h4.5l1.5 2.5h4l1.5-2.5H20v5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5z" />
    </template>
    <template v-else-if="name === 'flag'">
      <path d="M6 3.8v16.4" />
      <path d="M6 4.5c4.5-2 7.5 2 12 0v8c-4.5 2-7.5-2-12 0" />
    </template>
    <template v-else-if="name === 'paperclip'">
      <path d="M8.5 12.5 15 6a3.2 3.2 0 0 1 4.5 4.5l-8 8a5 5 0 0 1-7-7l8.5-8.5" />
    </template>
    <template v-else-if="name === 'chevron-left'">
      <path d="m14.5 5.5-7 6.5 7 6.5" />
    </template>
    <template v-else-if="name === 'chevron-right'">
      <path d="m9.5 5.5 7 6.5-7 6.5" />
    </template>
    <template v-else-if="name === 'chevron-down'">
      <path d="m5.5 9.5 6.5 7 6.5-7" />
    </template>
    <template v-else-if="name === 'arrow-left'">
      <path d="M19 12H5.5" />
      <path d="m11 5.5-6.5 6.5L11 18.5" />
    </template>
    <template v-else-if="name === 'sun'">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
    </template>
    <template v-else-if="name === 'moon'">
      <path d="M19.5 14.2A8 8 0 0 1 9.8 4.5a8 8 0 1 0 9.7 9.7z" />
    </template>
    <template v-else-if="name === 'monitor'">
      <rect x="3.5" y="5" width="17" height="11.5" rx="1.5" />
      <path d="M9 20h6M12 16.5V20" />
    </template>
    <template v-else-if="name === 'mail'">
      <rect x="3.5" y="5.5" width="17" height="13" rx="1.5" />
      <path d="m4.5 7 7.5 6 7.5-6" />
    </template>
    <template v-else-if="name === 'alert'">
      <path d="M12 4 3.5 19h17z" />
      <path d="M12 10v4M12 16.6v.1" />
    </template>
    <template v-else-if="name === 'refresh'">
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M19.5 3.5v3.7h-3.7" />
    </template>
    <template v-else-if="name === 'menu'">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </template>
    <template v-else-if="name === 'close'">
      <path d="m6 6 12 12M18 6 6 18" />
    </template>
    <template v-else-if="name === 'book'">
      <path d="M4.5 5.5A2 2 0 0 1 6.5 3.5H19.5v14H6.5a2 2 0 0 0-2 2z" />
      <path d="M4.5 19.5a2 2 0 0 1 2-2h13" />
    </template>
    <template v-else-if="name === 'people'">
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3.5 19.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <path d="M15.5 5.8a3.2 3.2 0 0 1 0 5.4" />
      <path d="M17.2 14.9c1.9.7 3.3 2.3 3.3 4.6" />
    </template>
    <template v-else-if="name === 'calendar'">
      <rect x="3.5" y="5" width="17" height="15.5" rx="1.5" />
      <path d="M3.5 9.5h17" />
      <path d="M8 3v3.5M16 3v3.5" />
      <path d="M7.5 13.5h3M13.5 13.5h3M7.5 17h3" />
    </template>
    <template v-else-if="name === 'bell'">
      <path d="M6 16.5v-6a6 6 0 0 1 12 0v6l1.8 2.3a.5.5 0 0 1-.4.8H4.6a.5.5 0 0 1-.4-.8z" />
      <path d="M10 21.2a2.2 2.2 0 0 0 4 0" />
    </template>
    <template v-else-if="name === 'repeat'">
      <path d="M17 4.5 19.5 7 17 9.5" />
      <path d="M19.5 7H8.5A4.5 4.5 0 0 0 4 11.5v1" />
      <path d="M7 19.5 4.5 17 7 14.5" />
      <path d="M4.5 17h11a4.5 4.5 0 0 0 4.5-4.5v-1" />
    </template>
  </svg>
</template>
