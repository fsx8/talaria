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
  | "folder-plus"
  | "folder-in"
  | "inbox"
  | "flag"
  | "flag-off"
  | "paperclip"
  | "chevron-left"
  | "chevron-right"
  | "chevron-down"
  | "arrow-left"
  | "sun"
  | "moon"
  | "monitor"
  | "mail"
  | "mail-open"
  | "alert"
  | "refresh"
  | "menu"
  | "close"
  | "book"
  | "people"
  | "calendar"
  | "bell"
  | "repeat"
  | "gear"
  | "check"
  | "download"
  | "print"
  | "image"
  | "image-off"
  | "eye-off"
  | "bookmark"
  | "keyboard"
  | "compose"
  | "reply"
  | "reply-all"
  | "forward"
  | "trash";

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
    <template v-else-if="name === 'folder-plus'">
      <path d="M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h4l2 2.5h8a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z" />
      <path d="M12 10.5v5M9.5 13h5" />
    </template>
    <template v-else-if="name === 'folder-in'">
      <path d="M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h4l2 2.5h8a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z" />
      <path d="M8.5 13h5" />
      <path d="m11.5 10.8 2.3 2.2-2.3 2.2" />
    </template>
    <template v-else-if="name === 'flag-off'">
      <path d="M6 3.8v16.4" />
      <path d="M6 4.5c4.5-2 7.5 2 12 0v8c-4.5 2-7.5-2-12 0" />
      <path d="m4 4 16 16" />
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
    <template v-else-if="name === 'mail-open'">
      <path d="M3.5 10 12 4l8.5 6" />
      <path d="M4 10h16v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18z" />
      <path d="m4 10.5 8 5.5 8-5.5" />
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
    <template v-else-if="name === 'gear'">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.2v2.4M12 18.4v2.4M5.1 5.1l1.7 1.7M17.2 17.2l1.7 1.7M3.2 12h2.4M18.4 12h2.4M5.1 18.9l1.7-1.7M17.2 6.8l1.7-1.7" />
    </template>
    <template v-else-if="name === 'check'">
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </template>
    <template v-else-if="name === 'download'">
      <path d="M12 4v10.5" />
      <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
      <path d="M4.5 16.5v2A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5v-2" />
    </template>
    <template v-else-if="name === 'print'">
      <path d="M7 8V4.5A1.5 1.5 0 0 1 8.5 3h7A1.5 1.5 0 0 1 17 4.5V8" />
      <path d="M7 17H5.5A1.5 1.5 0 0 1 4 15.5v-6A1.5 1.5 0 0 1 5.5 8h13A1.5 1.5 0 0 1 20 9.5v6a1.5 1.5 0 0 1-1.5 1.5H17" />
      <rect x="7" y="14" width="10" height="7" rx="1" />
    </template>
    <template v-else-if="name === 'image'">
      <rect x="3.5" y="5" width="17" height="14" rx="1.5" />
      <circle cx="9" cy="10" r="1.8" />
      <path d="m6 18.5 4.8-4.8a1.2 1.2 0 0 1 1.7 0l2.3 2.3" />
      <path d="m13.5 14.5 2-2a1.2 1.2 0 0 1 1.7 0l3.3 3.3" />
    </template>
    <template v-else-if="name === 'image-off'">
      <path d="M3.5 5A1.5 1.5 0 0 1 5 3.5h14A1.5 1.5 0 0 1 20.5 5v14a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19z" />
      <path d="m4 17 4.8-4.8a1.2 1.2 0 0 1 1.7 0l1.5 1.5" />
      <path d="m14 12.5 1.5-1.5a1.2 1.2 0 0 1 1.7 0l3.3 3.3" />
      <path d="m4.5 4.5 15 15" />
    </template>
    <template v-else-if="name === 'eye-off'">
      <path d="M4 5.5 19.5 19" />
      <path d="M9.5 6.7A8.6 8.6 0 0 1 12 6.3c4.5 0 7.6 3.6 8.5 5.7a11.8 11.8 0 0 1-2.6 3.4" />
      <path d="M6 8.3a11.5 11.5 0 0 0-2.5 3.7C4.4 14.1 7.5 17.7 12 17.7c1.2 0 2.3-.2 3.3-.7" />
      <path d="M9.8 9.9a3 3 0 0 0 4.2 4.3" />
    </template>
    <template v-else-if="name === 'bookmark'">
      <path d="M6.5 4.5A1.5 1.5 0 0 1 8 3h8a1.5 1.5 0 0 1 1.5 1.5V21l-5.5-4-5.5 4z" />
    </template>
    <template v-else-if="name === 'keyboard'">
      <rect x="3" y="6.5" width="18" height="11" rx="1.5" />
      <path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M8 13.5h8" />
    </template>
    <template v-else-if="name === 'compose'">
      <path d="M11 5H5a1.5 1.5 0 0 0-1.5 1.5V19A1.5 1.5 0 0 0 5 20.5h12.5A1.5 1.5 0 0 0 19 19v-6" />
      <path d="M17.6 3.7a1.9 1.9 0 0 1 2.7 2.7L12 14.7l-3.7.9.9-3.7z" />
    </template>
    <template v-else-if="name === 'reply'">
      <path d="M9.5 7.5 4.5 12l5 4.5" />
      <path d="M4.5 12h9a6 6 0 0 1 6 6v.5" />
    </template>
    <template v-else-if="name === 'reply-all'">
      <path d="m7.5 7.5-5 4.5 5 4.5" />
      <path d="m12.5 7.5-5 4.5 5 4.5" />
      <path d="M7.5 12h8a6 6 0 0 1 6 6v.5" />
    </template>
    <template v-else-if="name === 'forward'">
      <path d="m14.5 7.5 5 4.5-5 4.5" />
      <path d="M19.5 12h-9a6 6 0 0 0-6 6v.5" />
    </template>
    <template v-else-if="name === 'trash'">
      <path d="M4.5 6.5h15" />
      <path d="M8 6.5V5a1.5 1.5 0 0 1 1.5-1.5h5A1.5 1.5 0 0 1 16 5v1.5" />
      <path d="M6.5 6.5 7.3 19a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12.5" />
      <path d="M10 10.5v6M14 10.5v6" />
    </template>
  </svg>
</template>
