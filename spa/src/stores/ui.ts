/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { defineStore } from "pinia";
import { backendKind } from "../api";

export type ThemePreference = "system" | "light" | "dark";

/** Top-level view behind the rail switcher: mail register, contacts, agenda. */
export type ActiveView = "mail" | "contacts" | "agenda";

const STORAGE_KEY = "talaria.theme";

function readPreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    /* storage unavailable — system default */
  }
  return "system";
}

function resolveTheme(pref: ThemePreference): "light" | "dark" {
  if (pref !== "system") return pref;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(resolved: "light" | "dark") {
  document.documentElement.dataset.theme = resolved;
}

export const useUiStore = defineStore("ui", {
  state: () => ({
    backendKind: backendKind(),
    themePreference: readPreference() as ThemePreference,
    /** Which view owns the content panes (switcher in the rail). */
    activeView: "mail" as ActiveView,
    /** Phone-only: which stacked view owns the screen. */
    phoneView: "list" as "list" | "reader",
    /** Tablet/phone: the register rail opens as a drawer. */
    railDrawerOpen: false,
  }),
  getters: {
    resolvedTheme(): "light" | "dark" {
      return resolveTheme(this.themePreference);
    },
    isPhone(): boolean {
      return window.matchMedia("(max-width: 767px)").matches;
    },
  },
  actions: {
    initTheme() {
      applyTheme(this.resolvedTheme);
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
        if (this.themePreference === "system") applyTheme(this.resolvedTheme);
      });
    },
    setTheme(pref: ThemePreference) {
      this.themePreference = pref;
      try {
        localStorage.setItem(STORAGE_KEY, pref);
      } catch {
        /* ignore */
      }
      applyTheme(this.resolvedTheme);
    },
    openReader() {
      this.phoneView = "reader";
      this.railDrawerOpen = false;
    },
    backToList() {
      this.phoneView = "list";
    },
    openView(view: ActiveView) {
      this.activeView = view;
      this.railDrawerOpen = false;
    },
    toggleRailDrawer() {
      this.railDrawerOpen = !this.railDrawerOpen;
    },
    closeRailDrawer() {
      this.railDrawerOpen = false;
    },
  },
});
