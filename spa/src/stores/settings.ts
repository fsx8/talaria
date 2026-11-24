/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { defineStore } from "pinia";
import type { Account } from "../api/types";
import { resolveThemeId, themeEntry } from "../theming";

/**
 * User preferences (Round 2): theme, account-label mode, list density —
 * typed, with defaults, persisted in localStorage. Every consumer (rail
 * account rows, TopBar gear, Settings page) reads this store reactively.
 */

export type AccountLabelMode = "email" | "identity";
export type Density = "comfortable" | "compact";
/** Stage 2: the implicit scope a typed query is filed under. */
export type SearchScope = "all" | "account" | "folder";

export interface SettingsSnapshot {
  /** "system" (OS preference) or a concrete theme id from the registry. */
  themeId: string;
  accountLabelMode: AccountLabelMode;
  density: Density;
  /** W1 organize: opening a message marks it read after a short delay. */
  markReadOnOpen: boolean;
  /** W1 organize: show the move/flag/read-unread controls at all. */
  showActions: boolean;
  /* ---- Stage 2 ---- */
  /** Implicit scope for typed searches (All mail / Current account / Current folder). */
  searchScope: SearchScope;
  /** Remote images: load for every message (default OFF — consent per message). */
  alwaysLoadRemoteImages: boolean;
  /** Remote images: keep stripping silently, hide the per-message button. */
  neverAskRemoteImages: boolean;
  /** Accounts hidden from the rail, the register and the tallies (client-side). */
  hiddenAccountIds: string[];
  /* ---- Stage 3 (W2 drafts) ---- */
  /** Drafts composer: show the compose button and reply/forward entry points. */
  showComposer: boolean;
}

const STORAGE_KEY = "talaria.settings";
const LEGACY_THEME_KEY = "talaria.theme";

const DEFAULTS: SettingsSnapshot = {
  themeId: "system",
  accountLabelMode: "email",
  density: "comfortable",
  markReadOnOpen: true,
  showActions: true,
  searchScope: "all",
  alwaysLoadRemoteImages: false,
  neverAskRemoteImages: false,
  hiddenAccountIds: [],
  showComposer: true,
};

function isValidThemeId(id: unknown): id is string {
  return typeof id === "string" && (id === "system" || themeEntry(id) !== undefined);
}

function load(): SettingsSnapshot {
  try {
    // Round-1 migration: the old key held light|dark|system with no theme
    // system — map it onto the Talaria identities once, then remove it.
    if (!localStorage.getItem(STORAGE_KEY)) {
      const legacy = localStorage.getItem(LEGACY_THEME_KEY);
      if (legacy === "light" || legacy === "dark" || legacy === "system") {
        const migrated: SettingsSnapshot = {
          ...DEFAULTS,
          themeId: legacy === "light" ? "talaria-light" : legacy === "dark" ? "talaria-dark" : "system",
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        localStorage.removeItem(LEGACY_THEME_KEY);
        return migrated;
      }
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SettingsSnapshot>;
      return {
        themeId: isValidThemeId(parsed.themeId) ? parsed.themeId : DEFAULTS.themeId,
        accountLabelMode: parsed.accountLabelMode === "identity" ? "identity" : DEFAULTS.accountLabelMode,
        density: parsed.density === "compact" ? "compact" : DEFAULTS.density,
        markReadOnOpen: parsed.markReadOnOpen === undefined ? DEFAULTS.markReadOnOpen : parsed.markReadOnOpen === true,
        showActions: parsed.showActions === undefined ? DEFAULTS.showActions : parsed.showActions === true,
        searchScope: parsed.searchScope === "account" || parsed.searchScope === "folder" ? parsed.searchScope : DEFAULTS.searchScope,
        alwaysLoadRemoteImages:
          parsed.alwaysLoadRemoteImages === undefined ? DEFAULTS.alwaysLoadRemoteImages : parsed.alwaysLoadRemoteImages === true,
        neverAskRemoteImages:
          parsed.neverAskRemoteImages === undefined ? DEFAULTS.neverAskRemoteImages : parsed.neverAskRemoteImages === true,
        hiddenAccountIds: Array.isArray(parsed.hiddenAccountIds)
          ? parsed.hiddenAccountIds.filter((id): id is string => typeof id === "string")
          : DEFAULTS.hiddenAccountIds,
        showComposer: parsed.showComposer === undefined ? DEFAULTS.showComposer : parsed.showComposer === true,
      };
    }
  } catch {
    /* storage unavailable or corrupt — defaults */
  }
  return { ...DEFAULTS };
}

function persist(snapshot: SettingsSnapshot) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    /* ignore */
  }
}

export const useSettingsStore = defineStore("settings", {
  state: () => ({ ...load() }),

  getters: {
    /** The concrete theme id behind the preference (system → Talaria). */
    resolvedThemeId(state): string {
      return resolveThemeId(state.themeId);
    },
    isDark(state): boolean {
      const entry = themeEntry(state.themeId === "system" ? this.resolvedThemeId : state.themeId);
      return entry?.scheme === "dark";
    },
  },

  actions: {
    init() {
      this.apply();
      // While on "system", follow the OS preference live.
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
        if (this.themeId === "system") this.apply();
      });
    },

    /** Paint-side application: data-theme + density on <html>, browser chrome color. */
    apply() {
      document.documentElement.dataset.theme = this.resolvedThemeId;
      document.documentElement.dataset.density = this.density;
      requestAnimationFrame(() => {
        try {
          const ground = getComputedStyle(document.documentElement).getPropertyValue("--color-base-200").trim();
          if (ground) {
            for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
              meta.setAttribute("content", ground);
            }
          }
        } catch {
          /* cosmetic only */
        }
      });
    },

    snapshot(): SettingsSnapshot {
      return {
        themeId: this.themeId,
        accountLabelMode: this.accountLabelMode,
        density: this.density,
        markReadOnOpen: this.markReadOnOpen,
        showActions: this.showActions,
        searchScope: this.searchScope,
        alwaysLoadRemoteImages: this.alwaysLoadRemoteImages,
        neverAskRemoteImages: this.neverAskRemoteImages,
        hiddenAccountIds: [...this.hiddenAccountIds],
        showComposer: this.showComposer,
      };
    },

    setTheme(id: string) {
      if (!isValidThemeId(id)) return;
      this.themeId = id;
      persist(this.snapshot());
      this.apply();
    },

    setAccountLabelMode(mode: AccountLabelMode) {
      this.accountLabelMode = mode;
      persist(this.snapshot());
    },

    setDensity(density: Density) {
      this.density = density;
      persist(this.snapshot());
      this.apply();
    },

    /** W1 organize: mark a freshly opened record as read after a beat. */
    setMarkReadOnOpen(on: boolean) {
      this.markReadOnOpen = on;
      persist(this.snapshot());
    },

    /** W1 organize: show or hide every move/flag/read-unread control
     *  (client-side only — the add-on keeps its tools enabled either way,
     *  so this is a courtesy switch, not a safety boundary). */
    setShowActions(on: boolean) {
      this.showActions = on;
      persist(this.snapshot());
    },

    /* ---- Stage 2 ---- */

    /** The implicit scope typed queries are filed under. */
    setSearchScope(scope: SearchScope) {
      this.searchScope = scope;
      persist(this.snapshot());
    },

    /* ---- Stage 3 (W2 drafts) ---- */

    /** Show or hide the drafts composer entry points (a courtesy switch —
     *  the add-on keeps its draft tools enabled either way). */
    setShowComposer(on: boolean) {
      this.showComposer = on;
      persist(this.snapshot());
    },

    /** Consent gate for remote images (tracking pixels are always stripped). */
    setAlwaysLoadRemoteImages(on: boolean) {
      this.alwaysLoadRemoteImages = on;
      persist(this.snapshot());
    },

    /** "Never ask": keep stripping silently and hide the per-message button. */
    setNeverAskRemoteImages(on: boolean) {
      this.neverAskRemoteImages = on;
      persist(this.snapshot());
    },

    /**
     * Hide or re-show one account (client-side filtering only — the backend
     * keeps indexing it). Guardrail: at least one account must stay visible,
     * so the caller passes the registered account count. Returns false when
     * the hide was refused (it would hide the last one).
     */
    setAccountHidden(accountId: string, hidden: boolean, totalAccounts: number): boolean {
      const next = new Set(this.hiddenAccountIds);
      if (hidden) next.add(accountId);
      else next.delete(accountId);
      if (hidden && next.size >= Math.max(totalAccounts, 1)) return false;
      this.hiddenAccountIds = [...next];
      persist(this.snapshot());
      return true;
    },

    /** The rail label for an account, per the label mode (the Round-2 fix:
     *  email addresses are distinct where identity names collide). */
    accountLabel(account: Account): string {
      if (this.accountLabelMode === "email") return account.email || account.label;
      return account.label || account.email;
    },
  },
});
