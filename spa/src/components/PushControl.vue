<script setup lang="ts">
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { onMounted, ref } from "vue";
import IconGlyph from "./IconGlyph.vue";
import { getBackend } from "../api";
import type { PushBackend } from "../api/backend-interface";

/**
 * The web-push control (real backend only): one bell, honest states.
 * Off → click asks permission + subscribes via the service worker; on →
 * click unsubscribes. Denied/unsupported states stay visible but inert,
 * with the reason in the tooltip.
 */

const push = getBackend().push as PushBackend | undefined;

const state = ref<"off" | "subscribed" | "denied" | "unsupported" | "unconfigured" | "busy">("off");

onMounted(async () => {
  if (!push) return; // mock backend: no push surface at all
  if (!push.isSupported()) {
    state.value = "unsupported";
    return;
  }
  const key = await push.getPublicKey();
  if (!key) {
    state.value = "unconfigured";
    return;
  }
  state.value = await push.currentState();
});

async function toggle() {
  if (!push || state.value === "busy") return;
  if (state.value === "subscribed") {
    state.value = "busy";
    await push.disable();
    state.value = "off";
    return;
  }
  if (state.value !== "off") return; // denied/unsupported are inert
  state.value = "busy";
  const result = await push.enable();
  state.value = result === "subscribed" ? "subscribed" : result === "denied" ? "denied" : "off";
}

const title = (): string => {
  switch (state.value) {
    case "off":
      return "Enable push for new mail";
    case "subscribed":
      return "Push is on — click to turn it off";
    case "denied":
      return "Notifications are blocked in this browser's site settings";
    case "unsupported":
      return "This browser has no service-worker push";
    case "unconfigured":
      return "The sidecar has no VAPID keys — push is disabled";
    case "busy":
      return "Working…";
  }
};
</script>

<template>
  <button
    v-if="push && state !== 'unconfigured'"
    class="btn btn-ghost btn-square btn-sm h-7 w-7"
    :class="state === 'subscribed' ? 'bg-base-300' : ''"
    :disabled="state === 'denied' || state === 'unsupported' || state === 'busy'"
    :aria-pressed="state === 'subscribed'"
    :aria-label="`Push notifications: ${title()}`"
    :title="title()"
    @click="toggle"
  >
    <IconGlyph :name="state === 'busy' ? 'refresh' : 'bell'" :size="14" :class="state === 'busy' ? 'animate-spin' : ''" />
    <span v-if="state === 'subscribed'" class="sr-only">on</span>
  </button>
</template>
