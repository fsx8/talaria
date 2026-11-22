<script setup lang="ts">
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { onBeforeUnmount, onMounted, ref } from "vue";
import IconGlyph from "./IconGlyph.vue";
import { groupCount, initials } from "../composables/format";
import { useContactsStore } from "../stores/contacts";

const contacts = useContactsStore();

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
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col bg-paper" aria-label="Contacts">
    <!-- page head -->
    <div class="flex h-10 flex-none items-center gap-2 border-b border-rule px-3">
      <h2 class="flex-none text-[13px] font-semibold text-ink">Contacts</h2>
      <span v-if="!contacts.loading" class="agate flex-none">{{ groupCount(contacts.totalKnown) }}</span>
      <div class="relative ml-auto w-full max-w-[300px] flex-none">
        <IconGlyph
          name="search"
          :size="14"
          class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-3"
        />
        <input
          ref="searchInput"
          type="search"
          class="h-7 w-full rounded-[4px] border border-rule bg-sheet pl-7 pr-7 text-[12.5px] text-ink placeholder:text-ink-3 focus:border-rule-strong focus:outline-none"
          placeholder="Search name, address, organization…"
          aria-label="Search contacts"
          :value="contacts.query"
          @input="onSearchInput"
          @keydown.escape="clearSearch"
        />
        <button
          v-if="contacts.query"
          class="absolute right-1 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-ink-3 hover:text-ink"
          aria-label="Clear contact search"
          @click="clearSearch"
        >
          <IconGlyph name="close" :size="12" />
        </button>
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
          <IconGlyph name="alert" :size="26" class="text-ink-3" />
          <p class="max-w-[36ch] text-[13px] text-ink-2">{{ contacts.error }}</p>
          <button
            class="rounded-[4px] px-3 py-1.5 text-[13px] font-semibold"
            :style="{ background: 'var(--ink)', color: 'var(--invoked-ink)' }"
            @click="contacts.load()"
          >
            Try again
          </button>
        </div>

        <!-- empty -->
        <div v-else-if="!contacts.loading && contacts.contacts.length === 0" class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <IconGlyph name="people" :size="26" class="text-ink-3" />
          <p class="text-[13px] font-semibold text-ink">
            {{ contacts.query ? "No contact matches your search" : "The address books are empty" }}
          </p>
          <p v-if="contacts.query" class="max-w-[34ch] text-[12.5px] text-ink-3">
            Fewer words match more — the search covers names, addresses and organizations.
          </p>
          <button
            v-if="contacts.query"
            class="rounded-[4px] border border-rule px-3 py-1.5 text-[13px] text-ink-2 hover:text-ink"
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
            class="grid w-full grid-cols-[32px_1fr] items-center gap-x-2 border-b border-rule-blue px-3 py-2 text-left"
            :class="contacts.selectedId === contact.id ? 'bg-tint' : 'hover:bg-tint-soft'"
            role="option"
            :aria-selected="contacts.selectedId === contact.id"
            @click="contacts.select(contact.id)"
          >
            <span
              class="col-span-1 flex h-7 w-7 items-center justify-center rounded-full bg-tint text-[10px] font-bold text-ink-2"
              aria-hidden="true"
            >
              {{ initials(contact.displayName) }}
            </span>
            <span class="min-w-0">
              <span class="block truncate text-[13px] font-semibold text-ink">{{ contact.displayName }}</span>
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
              class="rounded-[4px] border border-rule px-3 py-1.5 text-[12.5px] text-ink-2 hover:bg-tint-soft hover:text-ink"
              @click="contacts.loadMore()"
            >
              Load more
            </button>
          </div>
        </div>
      </div>

      <!-- the contact card -->
      <div
        class="min-h-0 w-full overflow-y-auto border-l border-rule md:flex-1"
        :class="contacts.selectedId ? '' : 'max-md:hidden md:flex'"
      >
        <!-- phone back row -->
        <div v-if="contacts.selectedId" class="flex h-10 items-center gap-1 border-b border-rule px-2 md:hidden">
          <button
            class="flex items-center gap-0.5 rounded-[4px] px-2 py-1 text-[12.5px] text-ink-2 hover:bg-tint-soft hover:text-ink"
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
          <p class="text-[13px] text-ink-2">{{ contacts.detailError }}</p>
        </div>

        <article v-else-if="contacts.selectedDetail" class="record-sheet mx-2 my-2 rounded-[4px] px-5 py-4 md:mx-2">
          <div class="flex items-center gap-3">
            <span
              class="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-tint text-[14px] font-bold text-ink-2"
              aria-hidden="true"
            >
              {{ initials(contacts.selectedDetail.displayName) }}
            </span>
            <div class="min-w-0">
              <h2 class="truncate text-[17px] font-semibold leading-snug tracking-[-0.01em] text-ink">
                {{ contacts.selectedDetail.displayName }}
              </h2>
              <p v-if="contacts.selectedDetail.organization || contacts.selectedDetail.title" class="truncate text-[12.5px] text-ink-2">
                <template v-if="contacts.selectedDetail.title">{{ contacts.selectedDetail.title }}, </template>
                {{ contacts.selectedDetail.organization }}
              </p>
            </div>
          </div>

          <hr class="my-4 border-rule" />

          <dl class="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5">
            <template v-for="line in contacts.selectedDetail.emails" :key="`e-${line.value}`">
              <dt class="w-14 text-right agate !text-ink-3">{{ line.type }}</dt>
              <dd class="min-w-0 truncate text-[13px] text-ink">{{ line.value }}</dd>
            </template>
            <template v-for="line in contacts.selectedDetail.phones" :key="`p-${line.value}`">
              <dt class="w-14 text-right agate !text-ink-3">{{ line.type }}</dt>
              <dd class="min-w-0 truncate text-[13px] tabular text-ink">{{ line.value }}</dd>
            </template>
            <template v-for="line in contacts.selectedDetail.addresses" :key="`a-${line.value}`">
              <dt class="w-14 text-right agate !text-ink-3">{{ line.type }}</dt>
              <dd class="text-[13px] text-ink">{{ line.value }}</dd>
            </template>
            <template v-if="contacts.selectedDetail.birthday">
              <dt class="w-14 text-right agate !text-ink-3">Birthday</dt>
              <dd class="text-[13px] tabular text-ink">{{ birthdayLabel(contacts.selectedDetail.birthday) }}</dd>
            </template>
          </dl>

          <p v-if="contacts.selectedDetail.note" class="mt-4 border-t border-rule pt-3 text-[12.5px] leading-relaxed text-ink-2">
            {{ contacts.selectedDetail.note }}
          </p>

          <div class="mt-4 flex items-center gap-2 border-t border-rule pt-3">
            <span class="agate flex-1">Filed under {{ contacts.selectedDetail.addressBookName }}</span>
            <span class="agate" title="The address book is managed in Thunderbird">read-only</span>
          </div>
        </article>

        <!-- nothing selected (desktop) -->
        <div v-else-if="!contacts.selectedId" class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <IconGlyph name="people" :size="28" class="text-ink-3" />
          <p class="text-[13px] font-semibold text-ink">Choose a contact</p>
          <p class="max-w-[34ch] text-[12.5px] text-ink-3">
            The card opens here — addresses, phones and notes, exactly as Thunderbird files them.
          </p>
        </div>
      </div>
    </div>
  </section>
</template>
