/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { defineStore } from "pinia";
import { backendKind } from "../api";

/** Top-level view behind the rail switcher: mail register, contacts, agenda, settings. */
export type ActiveView = "mail" | "contacts" | "agenda" | "settings";

export const useUiStore = defineStore("ui", {
  state: () => ({
    backendKind: backendKind(),
    /** Which view owns the content panes (switcher in the rail, gear in the top bar). */
    activeView: "mail" as ActiveView,
    /** Phone-only: which stacked view owns the screen. */
    phoneView: "list" as "list" | "reader",
    /** Tablet/phone: the register rail opens as a drawer. */
    railDrawerOpen: false,
    /** Stage 2: the keyboard-shortcuts help overlay. */
    shortcutsOpen: false,
  }),
  getters: {
    isPhone(state): boolean {
      void state;
      return window.matchMedia("(max-width: 767px)").matches;
    },
  },
  actions: {
    /** Deep-link + back/forward support for the one routed view (/settings).
     *  The sidecar's SPA fallback serves index.html for extension-less paths. */
    initViewRouting() {
      if (window.location.pathname === "/settings") this.activeView = "settings";
      window.addEventListener("popstate", () => {
        this.activeView = window.location.pathname === "/settings" ? "settings" : "mail";
        this.railDrawerOpen = false;
      });
    },
    openReader() {
      this.phoneView = "reader";
      this.railDrawerOpen = false;
    },
    backToList() {
      this.phoneView = "list";
    },
    openView(view: ActiveView) {
      if (this.activeView !== view) {
        this.activeView = view;
        const target = view === "settings" ? "/settings" : "/";
        if (window.location.pathname !== target) {
          window.history.pushState({ view }, "", target);
        }
      }
      this.railDrawerOpen = false;
    },
    toggleRailDrawer() {
      this.railDrawerOpen = !this.railDrawerOpen;
    },
    closeRailDrawer() {
      this.railDrawerOpen = false;
    },
    openShortcuts() {
      this.shortcutsOpen = true;
    },
    closeShortcuts() {
      this.shortcutsOpen = false;
    },
  },
});
