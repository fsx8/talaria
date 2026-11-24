<script setup lang="ts">
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { computed, ref } from "vue";
import IconGlyph from "./IconGlyph.vue";
import type { MessageRef } from "../api";
import type { Folder } from "../api/types";
import { useAccountsStore } from "../stores/accounts";
import { useMailStore } from "../stores/mail";
import { useSettingsStore } from "../stores/settings";

/**
 * The filing menu (Round 3, W1 organize): a dropdown register of folders,
 * grouped per account, with inline subfolder creation. Move targets
 * deliberately exclude the delete-ish folders (Trash, Junk, Drafts,
 * Outbox) — deletion stays Thunderbird-only in W1; a move onto the
 * entries' current folder is a no-op.
 */

const props = defineProps<{
  /** The entries being filed. */
  items: MessageRef[];
  label?: string;
  disabled?: boolean;
}>();

const accounts = useAccountsStore();
const mail = useMailStore();
const settings = useSettingsStore();

const root = ref<HTMLDetailsElement | null>(null);
const creatingUnder = ref<string | null>(null);
const creatingUnderName = ref("");
const newFolderInput = ref<HTMLInputElement | null>(null);

/** Folders can change server-side between panel openings (other clients,
 *  Thunderbird itself, API tests) — refetch when the panel opens so the
 *  tree is never stale. Cheap: listFolders is a fast in-memory walk. */
function onToggle() {
  if (root.value?.open) void accounts.loadFolders().catch(() => {});
}

/** Folders a move may target: real mail places only — no delete-ish ends. */
const MOVABLE_KINDS = new Set(["inbox", "sent", "archive", "folder", "savedsearch"]);

interface FolderGroup {
  accountId: string;
  label: string;
  rootPath: string | null;
  folders: Folder[];
}

const groups = computed<FolderGroup[]>(() => {
  const out: FolderGroup[] = [];
  // Hidden accounts (Stage 2) are not offered as move targets either.
  for (const account of accounts.visibleAccounts) {
    const folders = (accounts.foldersByAccount[account.id] ?? []).filter((f) => MOVABLE_KINDS.has(f.kind));
    if (folders.length === 0) continue;
    const top = folders.find((f) => f.depth === 0);
    out.push({
      accountId: account.id,
      label: settings.accountLabel(account),
      // The account root URI: a depth-0 path minus its last segment.
      rootPath: top ? top.path.slice(0, top.path.lastIndexOf("/")) : null,
      folders,
    });
  }
  return out;
});

/** The (uniform) current folder of the entries — marked, not clickable. */
const currentPaths = computed(() => new Set(props.items.map((i) => i.folderPath)));

function currentFolderName(): string {
  const first = props.items[0];
  if (!first) return "";
  for (const group of groups.value) {
    const hit = group.folders.find((f) => f.path === first.folderPath);
    if (hit) return hit.name;
  }
  return "";
}

function depthIndent(depth: number): string {
  return `${10 + Math.min(depth, 4) * 13}px`;
}

function openCreateUnder(path: string) {
  creatingUnder.value = path;
  creatingUnderName.value = "";
  requestAnimationFrame(() => newFolderInput.value?.focus());
}

function cancelCreate() {
  creatingUnder.value = null;
  creatingUnderName.value = "";
}

async function submitCreate() {
  const parent = creatingUnder.value;
  const name = creatingUnderName.value.trim();
  if (!parent || !name) return;
  const ok = await mail.createFolderUnder(parent, name);
  if (ok) cancelCreate();
}

function pick(folder: Folder) {
  if (currentPaths.value.has(folder.path)) return;
  const movable = props.items.filter((i) => i.folderPath !== folder.path);
  if (movable.length === 0) return;
  void mail.moveTo(movable, folder);
  close();
}

function close() {
  cancelCreate();
  root.value?.removeAttribute("open");
}
</script>

<template>
  <details ref="root" class="dropdown" :class="disabled || items.length === 0 ? 'pointer-events-none opacity-40' : ''" @toggle="onToggle">
    <summary class="btn btn-ghost btn-sm gap-1 px-2 text-base-content/80">
      <IconGlyph name="folder-in" :size="14" />
      <span>{{ label ?? "Move" }}</span>
      <IconGlyph name="chevron-down" :size="12" class="opacity-60" />
    </summary>

    <div class="dropdown-content z-30 mt-1 max-h-[400px] w-[288px] overflow-y-auto overscroll-contain rounded-field border border-base-300 bg-base-100 p-1.5 shadow-[0_8px_28px_var(--sheet-shadow)]" role="menu" aria-label="Move to folder">
      <p class="agate px-2 pb-1 pt-0.5">
        File {{ items.length > 1 ? `${items.length} entries` : "entry" }}{{ currentFolderName() ? ` — from ${currentFolderName()}` : "" }}
      </p>

      <div>
        <div v-for="group in groups" :key="group.accountId" class="pb-1">
          <div class="flex items-center gap-1 border-b border-base-300 px-2 py-1">
            <span class="agate flex-1 font-semibold text-base-content/70">{{ group.label }}</span>
            <button
              v-if="group.rootPath"
              type="button"
              class="btn btn-ghost btn-xs btn-circle"
              :title="`New folder under ${group.label}`"
              :aria-label="`New folder under ${group.label}`"
              @click.prevent="creatingUnder === group.rootPath ? cancelCreate() : openCreateUnder(group.rootPath)"
            >
              <IconGlyph name="folder-plus" :size="13" />
            </button>
          </div>

          <template v-for="folder in group.folders" :key="folder.path">
            <div class="group flex items-center rounded-sm pr-1 hover:bg-base-300/60">
              <button
                type="button"
                class="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-[5px] text-left"
                :data-folder-path="folder.path"
                :disabled="currentPaths.has(folder.path)"
                :class="currentPaths.has(folder.path) ? 'cursor-default text-base-content/40' : 'hover:text-primary'"
                :title="currentPaths.has(folder.path) ? 'Current folder' : folder.name"
                @click.prevent="pick(folder)"
              >
                <IconGlyph
                  name="folder"
                  :size="13"
                  :class="currentPaths.has(folder.path) ? 'text-base-content/40' : 'text-base-content/55'"
                />
                <span class="truncate text-[12.5px]" :style="{ paddingLeft: `${Math.min(folder.depth, 4) * 11}px` }">
                  {{ folder.name }}
                </span>
                <span v-if="folder.unread > 0" class="agate ml-auto flex-none">{{ folder.unread }}</span>
                <span
                  v-else-if="currentPaths.has(folder.path)"
                  class="ml-auto mr-1 flex-none"
                  aria-hidden="true"
                ><span class="status status-neutral" /></span>
              </button>
              <button
                v-if="creatingUnder !== folder.path"
                type="button"
                class="btn btn-ghost btn-xs btn-circle opacity-0 group-hover:opacity-100 focus:opacity-100"
                :title="`New folder under ${folder.name}`"
                :aria-label="`New folder under ${folder.name}`"
                @click.prevent="openCreateUnder(folder.path)"
              >
                <IconGlyph name="folder-plus" :size="12" />
              </button>
            </div>

            <!-- inline create: registers a new subfolder of the clicked folder -->
            <div v-if="creatingUnder === folder.path" class="mx-1 mb-1 flex items-center gap-1 rounded-field border border-primary/40 bg-primary/5 px-1.5 py-1" :style="{ marginLeft: depthIndent(folder.depth) }">
              <IconGlyph name="folder-plus" :size="13" class="text-primary" />
              <input
                ref="newFolderInput"
                v-model="creatingUnderName"
                type="text"
                class="input input-ghost input-xs h-6 min-h-6 w-full px-1 text-[12.5px]"
                :placeholder="`Name — under ${folder.name}`"
                aria-label="New folder name"
                @keydown.enter.prevent="submitCreate"
                @keydown.escape.prevent="cancelCreate"
              />
              <button
                type="button"
                class="btn btn-primary btn-xs btn-circle"
                :disabled="!creatingUnderName.trim() || mail.writeBusy"
                aria-label="Create folder"
                @click.prevent="submitCreate"
              >
                <IconGlyph name="check" :size="12" />
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-xs btn-circle"
                aria-label="Cancel"
                @click.prevent="cancelCreate"
              >
                <IconGlyph name="close" :size="12" />
              </button>
            </div>
          </template>
        </div>
      </div>

      <p class="agate border-t border-base-300 px-2 pb-0.5 pt-1 text-base-content/55">
        Trash, junk and drafts are not offered — deletion stays in Thunderbird.
      </p>
    </div>
  </details>
</template>
