/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { defineStore } from "pinia";

/**
 * Marginalia (Round 3): the small confirmation slips for the W1 organize
 * actions. Optimistic UI is the rule — the toast confirms what stuck and
 * reports what rolled back, in the register's agate voice.
 */

export interface Toast {
  id: number;
  kind: "ok" | "err";
  text: string;
}

const VISIBLE_MAX = 3;
const LIFETIME_MS = 4_200;

export const useToastStore = defineStore("toast", {
  state: () => ({
    items: [] as Toast[],
    nextId: 1,
  }),
  actions: {
    /** Confirm a settled action (optimistic update that survived the round-trip). */
    ok(text: string) {
      this.push({ kind: "ok", text });
    },
    /** Report a failed action that was rolled back. */
    err(text: string) {
      this.push({ kind: "err", text });
    },
    push(partial: { kind: Toast["kind"]; text: string }) {
      const toast: Toast = { id: this.nextId++, ...partial };
      this.items.push(toast);
      while (this.items.length > VISIBLE_MAX) this.items.shift();
      setTimeout(() => this.dismiss(toast.id), LIFETIME_MS);
    },
    dismiss(id: number) {
      this.items = this.items.filter((t) => t.id !== id);
    },
  },
});
