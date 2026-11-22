/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { defineStore } from "pinia";
import { getBackend } from "../api";
import type { CalendarInfo, EventInfo, TaskInfo } from "../api/types";

/**
 * The docked agenda: the next seven days of events (recurring expansion is
 * the server's job — we only pass a range) plus the open-task count.
 */

const DAY_MS = 86_400_000;
const DAYS_AHEAD = 7;

export interface AgendaDay {
  /** Local midnight of the day. */
  key: string;
  events: EventInfo[];
}

export const useAgendaStore = defineStore("agenda", {
  state: () => ({
    calendars: [] as CalendarInfo[],
    events: [] as EventInfo[],
    tasks: [] as TaskInfo[],
    eventsTruncated: false,
    loading: false,
    error: null as string | null,
    loadedAt: 0,
  }),

  getters: {
    /** Enabled calendars that carry events; the chip legend for the agenda. */
    eventCalendars(state): CalendarInfo[] {
      return state.calendars.filter((c) => !c.disabled && c.supportsEvents);
    },
    calendarName(state) {
      return (id: string): string => state.calendars.find((c) => c.id === id)?.name ?? "Calendar";
    },
    calendarColorIndex(state) {
      return (id: string): number => state.calendars.find((c) => c.id === id)?.colorIndex ?? 5;
    },
    openTaskCount(state): number {
      return state.tasks.length;
    },
    /** Events grouped into the next 7 local days, today first. */
    days(state): AgendaDay[] {
      const buckets = new Map<string, EventInfo[]>();
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      for (let i = 0; i < DAYS_AHEAD; i++) {
        const day = new Date(today.getTime() + i * DAY_MS);
        buckets.set(day.toDateString(), []);
      }
      for (const event of state.events) {
        const date = new Date(event.startDate);
        if (Number.isNaN(date.getTime())) continue;
        const key = new Date(date.getFullYear(), date.getMonth(), date.getDate()).toDateString();
        const bucket = buckets.get(key);
        if (bucket) bucket.push(event);
      }
      const days: AgendaDay[] = [];
      for (const [key, events] of buckets) {
        events.sort((a, b) => {
          if (a.allDay !== b.allDay) return a.allDay ? 1 : -1; // timed first, all-day pinned
          return a.startDate.localeCompare(b.startDate);
        });
        days.push({ key, events });
      }
      return days;
    },
  },

  actions: {
    async load(force = false) {
      const backend = getBackend();
      if (!backend.listCalendars) return;
      if (this.loading) return;
      // Refresh at most every five minutes (or on demand).
      if (!force && this.loadedAt && Date.now() - this.loadedAt < 5 * 60_000) return;
      this.loading = true;
      this.error = null;
      try {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const end = new Date(start.getTime() + DAYS_AHEAD * DAY_MS);
        const [calendars, events, tasks] = await Promise.all([
          backend.listCalendars(),
          backend.listEvents({ start: start.toISOString(), end: end.toISOString() }),
          backend.listTasks(),
        ]);
        this.calendars = calendars;
        this.events = events;
        this.eventsTruncated = events.length >= 100;
        this.tasks = tasks;
        this.loadedAt = Date.now();
      } catch (cause) {
        this.error = cause instanceof Error ? cause.message : "The agenda could not be loaded.";
      } finally {
        this.loading = false;
      }
    },
  },
});
