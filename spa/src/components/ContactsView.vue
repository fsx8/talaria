<script setup lang="ts">
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { onBeforeUnmount, onMounted, ref } from "vue";
import IconGlyph from "./IconGlyph.vue";
import { groupCount, initials } from "../composables/format";
import { useContactsStore } from "../stores/contacts";
import { useMailStore } from "../stores/mail";
import { useUiStore } from "../stores/ui";

const contacts = useContactsStore();
const mail = useMailStore();
const ui = useUiStore();

const searchInput = ref<HTMLInputElement | null>(null);
let debounce: ReturnType<typeof setTimeout> | null = null;

onMounted(() => {
  void contacts.load();
});

onBeforeUnmount(() => {
  if (debounce) clearTimeout(debounce);
});

function onSearchInput(event: Event) {
  const value = (event.target as HTMLInputElement).value;
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => void contacts.search(value, 0), 250);
}

function clearSearch() {
  contacts.query = "";
  void contacts.search("", 0);
  searchInput.value?.focus();
}

function backToList() {
  contacts.selectedId = null;
}

function birthdayLabel(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long" }).format(date);
}

/* ---- Stage 2: contact → mail integration ---- */

/** Jump into the register with this contact's address as a from: query. */
function showMail() {
  const detail = contacts.selectedDetail;
  if (!detail) return;
  const email = detail.emails[0]?.value || detail.email;
  if (!email || !email.includes("@")) return;
  ui.openView("mail");
  mail.setSearchText(`from:"${email}"`);
}
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col bg-base-200" aria-label="Contacts">
    <!-- page head -->
    <div class="flex h-10 flex-none items-center gap-2 border-b border-base-300 px-3">
      <h2 class="flex-none text-[13px] font-semibold">Contacts</h2>
      <span v-if="!contacts.loading" class="agate flex-none">{{ groupCount(contacts.totalKnown) }}</span>
      <div class="relative ml-auto w-full max-w-[300px] flex-none">
        <label class="input input-sm h-7 w-full items-center gap-0 pl-1.5 pr-0.5">
          <IconGlyph
            name="search"
            :size="14"
            class="pointer-events-none text-base-content/55"
          />
          <input
            ref="searchInput"
            type="search"
            class="grow bg-transparent px-1.5 text-[12.5px]"
            placeholder="Search name, address, organization…"
            aria-label="Search contacts"
            :value="contacts.query"
            @input="onSearchInput"
            @keydown.escape="clearSearch"
          />
          <button
            v-if="contacts.query"
            class="btn btn-ghost btn-xs btn-circle"
            aria-label="Clear contact search"
            @click="clearSearch"
          >
            <IconGlyph name="close" :size="12" />
          </button>
        </label>
      </div>
    </div>

    <div class="flex min-h-0 flex-1">
      <!-- the contacts register page -->
      <div
        class="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        :class="contacts.selectedId ? 'max-md:hidden' : ''"
      >
        <!-- loading skeleton -->
        <div v-if="contacts.loading && contacts.contacts.length === 0" class="space-y-3 px-3 py-3" aria-hidden="true">
          <div v-for="i in 8" :key="i" class="flex items-center gap-3 py-1">
            <div class="skeleton h-7 w-7 rounded-full" />
            <div class="space-y-1.5" :style="{ width: `${40 + ((i * 11) % 35)}%` }">
              <div class="skeleton h-3" />
            </div>
          </div>
          <span class="sr-only">Loading contacts…</span>
        </div>

        <!-- error -->
        <div v-else-if="contacts.error && contacts.contacts.length === 0" class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <IconGlyph name="alert" :size="26" class="text-base-content/55" />
          <p class="max-w-[36ch] text-[13px] text-base-content/70">{{ contacts.error }}</p>
          <button class="btn btn-neutral btn-sm" @click="contacts.load()">
            Try again
          </button>
        </div>

        <!-- empty -->
        <div v-else-if="!contacts.loading && contacts.contacts.length === 0" class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <IconGlyph name="people" :size="26" class="text-base-content/55" />
          <p class="text-[13px] font-semibold">
            {{ contacts.query ? "No contact matches your search" : "The address books are empty" }}
          </p>
          <p v-if="contacts.query" class="max-w-[34ch] text-[12.5px] text-base-content/55">
            Fewer words match more — the search covers names, addresses and organizations.
          </p>
          <button
            v-if="contacts.query"
            class="btn btn-outline btn-sm text-base-content/70"
            @click="clearSearch"
          >
            Clear search
          </button>
        </div>

        <!-- rows -->
        <div v-else role="listbox" aria-label="Contacts">
          <button
            v-for="contact in contacts.contacts"
            :key="contact.id"
            class="grid w-full grid-cols-[32px_1fr] items-center gap-x-2 border-b border-base-300 px-3 py-2 text-left"
            :class="contacts.selectedId === contact.id ? 'bg-base-300/70' : 'hover:bg-base-300/50'"
            role="option"
            :aria-selected="contacts.selectedId === contact.id"
            @click="contacts.select(contact.id)"
          >
            <span
              class="col-span-1 flex h-7 w-7 items-center justify-center rounded-full bg-base-300 text-[10px] font-bold text-base-content/70"
              aria-hidden="true"
            >
              {{ initials(contact.displayName) }}
            </span>
            <span class="min-w-0">
              <span class="block truncate text-[13px] font-semibold">{{ contact.displayName }}</span>
              <span class="block truncate agate">
                {{ contact.email || "—"}}<template v-if="contact.organization"> · {{ contact.organization }}</template>
              </span>
            </span>
          </button>

          <!-- pagination foot -->
          <div v-if="contacts.contacts.length > 0" class="px-3 pb-4 pt-2 text-center">
            <p v-if="contacts.appending" class="agate" role="status">Filing more contacts…</p>
            <button
              v-else-if="contacts.hasMore"
              class="btn btn-outline btn-sm text-base-content/70"
              @click="contacts.loadMore()"
            >
              Load more
            </button>
          </div>
        </div>
      </div>

      <!-- the contact card -->
      <div
        class="min-h-0 w-full overflow-y-auto border-l border-base-300 md:flex-1"
        :class="contacts.selectedId ? '' : 'max-md:hidden md:flex'"
      >
        <!-- phone back row -->
        <div v-if="contacts.selectedId" class="flex h-10 items-center gap-1 border-b border-base-300 px-2 md:hidden">
          <button
            class="btn btn-ghost btn-sm gap-0.5 px-2"
            @click="backToList"
          >
            <IconGlyph name="arrow-left" :size="14" /> Contacts
          </button>
        </div>

        <div v-if="contacts.detailLoading" class="space-y-4 px-6 py-6" aria-hidden="true">
          <div class="skeleton h-4 w-1/2" />
          <div class="skeleton h-3 w-1/3" />
          <div class="space-y-2 pt-4">
            <div class="skeleton h-3 w-2/3" />
            <div class="skeleton h-3 w-1/2" />
          </div>
        </div>

        <div v-else-if="contacts.detailError" class="px-6 py-6">
          <p class="text-[13px] text-base-content/70">{{ contacts.detailError }}</p>
        </div>

        <article v-else-if="contacts.selectedDetail" class="record-sheet mx-2 my-2 rounded-field px-5 py-4 md:mx-2">
          <div class="flex items-center gap-3">
            <span
              class="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-base-300 text-[14px] font-bold text-base-content/70"
              aria-hidden="true"
            >
              {{ initials(contacts.selectedDetail.displayName) }}
            </span>
            <div class="min-w-0">
              <h2 class="truncate text-[17px] font-semibold leading-snug tracking-[-0.01em]">
                {{ contacts.selectedDetail.displayName }}
              </h2>
              <p v-if="contacts.selectedDetail.organization || contacts.selectedDetail.title" class="truncate text-[12.5px] text-base-content/70">
                <template v-if="contacts.selectedDetail.title">{{ contacts.selectedDetail.title }}, </template>
                {{ contacts.selectedDetail.organization }}
              </p>
            </div>
          </div>

          <hr class="my-4 border-base-300" />

          <dl class="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5">
            <template v-for="line in contacts.selectedDetail.emails" :key="`e-${line.value}`">
              <dt class="w-14 text-right agate">{{ line.type }}</dt>
              <dd class="min-w-0 truncate text-[13px]">{{ line.value }}</dd>
            </template>
            <template v-for="line in contacts.selectedDetail.phones" :key="`p-${line.value}`">
              <dt class="w-14 text-right agate">{{ line.type }}</dt>
              <dd class="min-w-0 truncate text-[13px] tabular">{{ line.value }}</dd>
            </template>
            <template v-for="line in contacts.selectedDetail.addresses" :key="`a-${line.value}`">
              <dt class="w-14 text-right agate">{{ line.type }}</dt>
              <dd class="text-[13px]">{{ line.value }}</dd>
            </template>
            <template v-if="contacts.selectedDetail.birthday">
              <dt class="w-14 text-right agate">Birthday</dt>
              <dd class="text-[13px] tabular">{{ birthdayLabel(contacts.selectedDetail.birthday) }}</dd>
            </template>
          </dl>

          <p v-if="contacts.selectedDetail.note" class="mt-4 border-t border-base-300 pt-3 text-[12.5px] leading-relaxed text-base-content/70">
            {{ contacts.selectedDetail.note }}
          </p>

          <div class="mt-4 flex items-center gap-2 border-t border-base-300 pt-3">
            <span class="agate flex-1">Filed under {{ contacts.selectedDetail.addressBookName }}</span>
            <button
              v-if="contacts.selectedDetail.emails.length > 0"
              class="btn btn-outline btn-sm h-7 gap-1 px-2.5"
              title="Show all mail from this contact in the register"
              @click="showMail"
            >
              <IconGlyph name="search" :size="13" />
              Show mail
            </button>
            <span class="agate" title="The address book is managed in Thunderbird">read-only</span>
          </div>
        </article>

        <!-- nothing selected (desktop) -->
        <div v-else-if="!contacts.selectedId" class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <IconGlyph name="people" :size="28" class="text-base-content/55" />
          <p class="text-[13px] font-semibold">Choose a contact</p>
          <p class="max-w-[34ch] text-[12.5px] text-base-content/55">
            The card opens here — addresses, phones and notes, exactly as Thunderbird files them.
          </p>
        </div>
      </div>
    </div>
  </section>
</template>
