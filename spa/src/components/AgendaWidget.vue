<script setup lang="ts">
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { computed, onMounted } from "vue";
import IconGlyph from "./IconGlyph.vue";
import { groupCount } from "../composables/format";
import { useAgendaStore } from "../stores/agenda";
import { useUiStore } from "../stores/ui";

const agenda = useAgendaStore();
const ui = useUiStore();

const MAX_LINES = 5;

onMounted(() => {
  void agenda.load();
});

interface Line {
  id: string;
  dayLabel: string;
  timeLabel: string;
  title: string;
  colorIndex: number;
  allDay: boolean;
}

const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const todayKey = new Date(new Date().setHours(0, 0, 0, 0)).toDateString();
const tomorrowKey = new Date(Date.now() + 86_400_000).toDateString();

function dayLabelOf(date: Date): string {
  const key = date.toDateString();
  if (key === todayKey) return "Today";
  if (key === tomorrowKey) return "Tmrw";
  return dayNames[date.getDay()] ?? "";
}

const lines = computed<Line[]>(() => {
  const out: Line[] = [];
  for (const day of agenda.days) {
    for (const event of day.events) {
      if (out.length >= MAX_LINES) return out;
      const start = new Date(event.startDate);
      out.push({
        id: `${event.id}-${event.startDate}`,
        dayLabel: dayLabelOf(start),
        timeLabel: event.allDay ? "all-day" : timeFormat.format(start),
        title: event.title,
        colorIndex: agenda.calendarColorIndex(event.calendarId),
        allDay: event.allDay,
      });
    }
  }
  return out;
});
</script>

<template>
  <div class="border-t border-base-300 px-2 pb-2 pt-2">
    <div class="flex items-baseline gap-2 px-2 pb-1">
      <h3 class="agate flex-none uppercase tracking-[0.04em]">Next 7 days</h3>
      <span
        v-if="agenda.openTaskCount > 0"
        class="agate ml-auto flex-none tabular"
        :title="`${agenda.openTaskCount} open tasks in Thunderbird`"
      >
        {{ groupCount(agenda.openTaskCount) }} tasks
      </span>
    </div>

    <!-- loading skeleton -->
    <div v-if="agenda.loading && !lines.length" class="space-y-1.5 px-2 py-1" aria-hidden="true">
      <div class="skeleton h-3 w-11/12" />
      <div class="skeleton h-3 w-3/4" />
    </div>

    <!-- error -->
    <p v-else-if="agenda.error" class="agate px-2 py-1">{{ agenda.error }}</p>

    <!-- empty -->
    <p v-else-if="!lines.length" class="agate px-2 py-1">No entries this week.</p>

    <!-- event lines -->
    <ul v-else class="space-y-0.5">
      <li v-for="line in lines" :key="line.id" class="flex items-baseline gap-2 rounded-[3px] px-2 py-1">
        <span
          class="account-chip mt-[3px] flex-none self-start"
          :style="{ background: `var(--acct-${line.colorIndex})` }"
          aria-hidden="true"
        />
        <span class="agate w-[7.2em] flex-none tabular">
          {{ line.dayLabel }} <span class="text-base-content/55">{{ line.timeLabel }}</span>
        </span>
        <span class="min-w-0 flex-1 line-clamp-1 text-[12px] leading-[1.4] text-base-content/70" :title="line.title">
          {{ line.title }}
        </span>
      </li>
    </ul>

    <button
      class="mt-1 flex w-full items-center gap-1.5 rounded-field px-2 py-1 text-left text-[12px] text-base-content/70 hover:bg-base-300/50 hover:text-base-content"
      @click="ui.openView('agenda')"
    >
      <IconGlyph name="calendar" :size="13" class="text-base-content/55" />
      Open agenda
    </button>
  </div>
</template>
