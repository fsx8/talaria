<script setup lang="ts">
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { computed, onMounted } from "vue";
import IconGlyph from "./IconGlyph.vue";
import { groupCount } from "../composables/format";
import { useAgendaStore } from "../stores/agenda";

const agenda = useAgendaStore();

onMounted(() => {
  void agenda.load(true);
});

const dayHeading = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  day: "numeric",
  month: "long",
});
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

const today = new Date();
today.setHours(0, 0, 0, 0);
const shortDate = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });

function dayLabel(key: string): string {
  const date = new Date(key);
  const diff = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return dayHeading.format(date);
}

function timeRange(startIso: string, endIso: string, allDay: boolean): string {
  if (allDay) return "all-day";
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime())) return "";
  if (!Number.isNaN(end.getTime()) && start.toDateString() !== end.toDateString()) {
    return `${timeFormat.format(start)} → ${dayHeading.format(end)}`;
  }
  return `${timeFormat.format(start)} – ${Number.isNaN(end.getTime()) ? "" : timeFormat.format(end)}`;
}

/** Task due dates are date-only in practice; a time range would be noise. */
function dueLabel(iso: string): string {
  if (!iso) return "no due date";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "no due date";
  if (date.getHours() === 0 && date.getMinutes() === 0) {
    const overdue = date.getTime() < today.getTime();
    return `${shortDate.format(date)}${overdue ? " · overdue" : ""}`;
  }
  return timeFormat.format(date);
}

const rangeLabel = computed(() => {
  const first = agenda.days[0]?.key;
  const last = agenda.days[agenda.days.length - 1]?.key;
  if (!first || !last) return "";
  const short = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
  return `${short.format(new Date(first))} – ${short.format(new Date(last))}`;
});
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col bg-base-200" aria-label="Agenda">
    <!-- page head -->
    <div class="flex h-10 flex-none items-center gap-2 border-b border-base-300 px-3">
      <h2 class="flex-none text-[13px] font-semibold">Agenda</h2>
      <span v-if="rangeLabel" class="agate flex-none tabular">{{ rangeLabel }}</span>
      <span
        v-if="agenda.openTaskCount > 0"
        class="agate flex-none tabular"
        :title="`${agenda.openTaskCount} open tasks in Thunderbird`"
      >
        · {{ groupCount(agenda.openTaskCount) }} open tasks
      </span>
      <button
        type="button"
        class="btn btn-ghost btn-xs btn-circle ml-auto"
        :aria-label="agenda.loading ? 'Loading agenda' : 'Refresh agenda'"
        :title="agenda.loading ? 'Loading…' : 'Refresh'"
        @click="agenda.load(true)"
      >
        <IconGlyph name="refresh" :size="13" :class="agenda.loading ? 'animate-spin' : ''" />
      </button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <!-- loading skeleton -->
      <div v-if="agenda.loading && agenda.events.length === 0 && agenda.tasks.length === 0" class="max-w-[720px] space-y-3 px-4 py-4" aria-hidden="true">
        <div class="skeleton h-3.5 w-40" />
        <div class="skeleton h-10 w-full max-w-[480px]" />
        <div class="skeleton h-10 w-2/3 max-w-[420px]" />
        <span class="sr-only">Loading agenda…</span>
      </div>

      <!-- error -->
      <div v-else-if="agenda.error" class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <IconGlyph name="alert" :size="26" class="text-base-content/55" />
        <p class="max-w-[36ch] text-[13px] text-base-content/70">{{ agenda.error }}</p>
        <button class="btn btn-neutral btn-sm" @click="agenda.load(true)">
          Try again
        </button>
      </div>

      <div v-else class="max-w-[720px] px-4 pb-8 pt-4">
        <!-- calendar legend: stable chips, one hue per calendar -->
        <div v-if="agenda.eventCalendars.length > 0" class="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span v-for="calendar in agenda.eventCalendars" :key="calendar.id" class="flex items-center gap-1.5">
            <span
              class="account-chip"
              :style="{ background: `var(--acct-${calendar.colorIndex})` }"
              aria-hidden="true"
            />
            <span class="agate">{{ calendar.name }}</span>
          </span>
        </div>

        <!-- day sections -->
        <section v-for="day in agenda.days" :key="day.key" class="mb-5">
          <h3 class="mb-1.5 text-[12px] font-semibold">{{ dayLabel(day.key) }}</h3>
          <div v-if="day.events.length === 0" class="agate border-l border-base-300 pl-3">No entries.</div>
          <ul v-else class="space-y-1">
            <li
              v-for="event in day.events"
              :key="`${event.id}-${event.startDate}`"
              class="record-sheet flex items-baseline gap-3 rounded-field px-3 py-2"
            >
              <span
                class="account-chip flex-none self-center"
                :style="{ background: `var(--acct-${agenda.calendarColorIndex(event.calendarId)})` }"
                :title="agenda.calendarName(event.calendarId)"
                aria-hidden="true"
              />
              <span class="agate w-[11em] flex-none whitespace-nowrap tabular">{{ timeRange(event.startDate, event.endDate, event.allDay) }}</span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-[13px]" :class="event.allDay ? 'font-normal text-base-content/70' : 'font-semibold'">
                  {{ event.title }}
                </span>
                <span v-if="event.location" class="block truncate agate">{{ event.location }}</span>
              </span>
              <span v-if="event.isRecurring" class="flex flex-none items-center text-base-content/55" title="Recurring entry">
                <IconGlyph name="repeat" :size="12" />
                <span class="sr-only">recurring</span>
              </span>
            </li>
          </ul>
        </section>

        <!-- open tasks -->
        <section v-if="agenda.tasks.length > 0" class="mt-6 border-t border-base-300 pt-3">
          <h3 class="mb-1.5 text-[12px] font-semibold">Open tasks</h3>
          <ul class="space-y-1">
            <li v-for="task in agenda.tasks" :key="task.id" class="flex items-baseline gap-3 rounded-field px-3 py-1.5 hover:bg-base-300/50">
              <span class="agate w-[11em] flex-none whitespace-nowrap tabular">{{ dueLabel(task.dueDate) }}</span>
              <span class="text-[13px] text-base-content/70">{{ task.title }}</span>
            </li>
          </ul>
        </section>

        <p v-if="agenda.eventsTruncated" class="agate mt-4">
          More than 100 entries this week — the list is cut; narrow the calendar in Thunderbird.
        </p>
        <p v-else-if="agenda.events.length === 0 && agenda.tasks.length === 0" class="agate">
          No calendar entries in the next 7 days.
        </p>
      </div>
    </div>
  </section>
</template>
