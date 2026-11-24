/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { defineStore } from "pinia";

/**
 * Saved searches (Stage 2): named, client-side query bookmarks, persisted
 * in localStorage via the same pattern as the settings store — typed,
 * validated on load, written back on every change. Server-side saved or
 * virtual folders do not exist in commonpost v0.26.1's listFolders, so this
 * is the honest MVP: the query text is stored, the scope is whatever the
 * user's Search-scope setting implies when it re-runs.
 */

export interface SavedSearch {
  /** Short stable id (nanoid-style timestamp+random, no dependency). */
  id: string;
  name: string;
  /** The query text exactly as typed — operators pass through verbatim. */
  query: string;
  createdAt: string;
}

const STORAGE_KEY = "talaria.searches";
const MAX_SEARCHES = 30;

function isValidSnapshot(value: unknown): SavedSearch[] {
  if (!Array.isArray(value)) return [];
  const out: SavedSearch[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as Partial<SavedSearch>;
    if (typeof row.id !== "string" || typeof row.query !== "string") continue;
    if (typeof row.name !== "string" || !row.name.trim()) continue;
    out.push({
      id: row.id,
      name: row.name.trim().slice(0, 60),
      query: row.query,
      createdAt: typeof row.createdAt === "string" ? row.createdAt : new Date().toISOString(),
    });
  }
  return out.slice(0, MAX_SEARCHES);
}

function load(): SavedSearch[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return isValidSnapshot(JSON.parse(raw));
  } catch {
    /* storage unavailable or corrupt — start empty */
    return [];
  }
}

function persist(items: SavedSearch[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* ignore */
  }
}

function newId(): string {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useSearchesStore = defineStore("searches", {
  state: () => ({
    items: load() as SavedSearch[],
  }),

  getters: {
    /** Newest first — the rail lists the freshest bookmark on top. */
    sorted(state): SavedSearch[] {
      return [...state.items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
  },

  actions: {
    /** Save (or rename-overwrite) a query under a display name. */
    add(name: string, query: string): SavedSearch | null {
      const trimmedName = name.trim().slice(0, 60);
      const trimmedQuery = query.trim();
      if (!trimmedName || !trimmedQuery) return null;
      const existing = this.items.find((item) => item.query === trimmedQuery);
      if (existing) {
        existing.name = trimmedName;
        persist(this.items);
        return existing;
      }
      if (this.items.length >= MAX_SEARCHES) this.items.pop(); // drop the oldest
      const entry: SavedSearch = {
        id: newId(),
        name: trimmedName,
        query: trimmedQuery,
        createdAt: new Date().toISOString(),
      };
      this.items.push(entry);
      persist(this.items);
      return entry;
    },

    remove(id: string) {
      this.items = this.items.filter((item) => item.id !== id);
      persist(this.items);
    },

    /** A short label for empty queries (defensive — saving is gated anyway). */
    displayName(entry: SavedSearch): string {
      return entry.name || entry.query.slice(0, 40);
    },
  },
});
