<script setup lang="ts">
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { computed, onMounted, ref } from "vue";
import IconGlyph from "./IconGlyph.vue";
import ThemePicker from "./ThemePicker.vue";
import { getBackend } from "../api";
import type { HealthInfo } from "../api";
import { useAccountsStore } from "../stores/accounts";
import { useComposeStore } from "../stores/compose";
import { useMailStore } from "../stores/mail";
import { useToastStore } from "../stores/toast";
import { useSettingsStore, type AccountLabelMode, type Density, type SearchScope } from "../stores/settings";
import { useUiStore } from "../stores/ui";

/**
 * Settings (Round 2): Appearance (theme, account labels, density) and
 * About & status (app version, sidecar/commonpost health, poll cadence,
 * the read-only notice). Preferences persist via the settings store.
 * Round 3 (W1 organize) adds the Actions section. Stage 2 adds Search
 * (typed-query scope), Privacy (remote-image consent) and Accounts
 * (per-account visibility, client-side). Stage 3 (W2 drafts) adds the
 * drafts-composer switch to Actions.
 */

const settings = useSettingsStore();
const ui = useUiStore();
const mail = useMailStore();
const accounts = useAccountsStore();
const toast = useToastStore();
const compose = useComposeStore();

const appVersion = __APP_VERSION__;

const health = ref<HealthInfo | null>(null);
const healthChecking = ref(false);

async function checkHealth() {
  healthChecking.value = true;
  try {
    health.value = await getBackend().getHealth();
  } catch {
    health.value = { ok: false };
  } finally {
    healthChecking.value = false;
  }
}

onMounted(() => {
  void checkHealth();
});

const labelModes: Array<{ value: AccountLabelMode; label: string; hint: string }> = [
  {
    value: "email",
    label: "Email address",
    hint: "Distinct even where several accounts share one identity name — the default",
  },
  {
    value: "identity",
    label: "Identity name",
    hint: "The display name of each account's default identity",
  },
];

const densities: Array<{ value: Density; label: string; hint: string }> = [
  { value: "comfortable", label: "Comfortable", hint: "Full rows with preview lines" },
  { value: "compact", label: "Compact", hint: "Tighter rows, previews hidden" },
];

/* ---- Stage 2 ---- */

const scopeModes: Array<{ value: SearchScope; label: string; hint: string }> = [
  { value: "all", label: "All mail", hint: "Every visible account — Trash and Junk skipped. The default." },
  { value: "account", label: "Current account", hint: "Whatever the register rail has selected" },
  { value: "folder", label: "Current folder", hint: "The folder the rail is filed under (All mail when none)" },
];

/** Hide one account client-side; guardrail refuses the last visible one. */
function toggleAccountHidden(accountId: string, event: Event) {
  // The toggle's checked state means VISIBLE — hidden is its negation.
  const hidden = !(event.target as HTMLInputElement).checked;
  const ok = settings.setAccountHidden(accountId, hidden, accounts.accounts.length);
  if (!ok) {
    // Refused: the checkbox must snap back to its true state (still visible).
    (event.target as HTMLInputElement).checked = true;
    toast.err("At least one account must stay visible.");
    return;
  }
  accounts.reconcileVisibility();
  if (mail.messages.length > 0) void mail.refresh();
}

/** The honest posture line in About & status, per the active tier. */
const posture = computed<"read-only" | "organize" | "organize-drafts" | "organize-hidden">(() => {
  if (!mail.canOrganize) return "read-only";
  if (!settings.showActions) return "organize-hidden";
  return compose.available && settings.showComposer ? "organize-drafts" : "organize";
});
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col bg-base-200" aria-label="Settings">
    <!-- page head -->
    <div class="flex h-10 flex-none items-center gap-2 border-b border-base-300 px-3">
      <button
        type="button"
        class="btn btn-ghost btn-sm gap-1 px-2 lg:hidden"
        aria-label="Back to the register"
        @click="ui.openView('mail')"
      >
        <IconGlyph name="arrow-left" :size="14" />
      </button>
      <h2 class="flex-none text-[13px] font-semibold">Settings</h2>
      <span class="badge badge-ghost badge-sm agate ml-auto font-normal">
        v{{ appVersion }}
      </span>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div class="mx-auto w-full max-w-[680px] px-4 pb-10 pt-4">
        <!-- Appearance -->
        <div class="card border border-base-300 bg-base-100">
          <div class="card-body gap-4 p-4 md:p-5">
            <h3 class="card-title text-[13px] font-semibold">Appearance</h3>

            <!-- theme -->
            <fieldset class="space-y-2">
              <legend class="text-[12.5px] font-medium">Theme</legend>
              <ThemePicker />
            </fieldset>

            <hr class="border-base-300" />

            <!-- account labels -->
            <fieldset class="space-y-2">
              <legend class="text-[12.5px] font-medium">Account labels</legend>
              <p class="agate">How accounts are named in the register rail.</p>
              <div class="space-y-1.5">
                <label
                  v-for="mode in labelModes"
                  :key="mode.value"
                  class="flex cursor-pointer items-start gap-2.5 rounded-field border px-3 py-2 transition-colors"
                  :class="
                    settings.accountLabelMode === mode.value
                      ? 'border-primary bg-primary/5'
                      : 'border-base-300 hover:bg-base-300/50'
                  "
                >
                  <input
                    class="radio radio-primary radio-sm mt-0.5"
                    type="radio"
                    name="talaria-account-label-mode"
                    :value="mode.value"
                    :checked="settings.accountLabelMode === mode.value"
                    @change="settings.setAccountLabelMode(mode.value)"
                  />
                  <span class="min-w-0">
                    <span class="block text-[12.5px] font-medium">{{ mode.label }}</span>
                    <span class="agate block">{{ mode.hint }}</span>
                  </span>
                </label>
              </div>
            </fieldset>

            <hr class="border-base-300" />

            <!-- density -->
            <fieldset class="space-y-2">
              <legend class="text-[12.5px] font-medium">List density</legend>
              <div class="flex flex-wrap gap-2">
                <label
                  v-for="option in densities"
                  :key="option.value"
                  class="flex cursor-pointer items-center gap-2.5 rounded-field border px-3 py-2 transition-colors"
                  :class="
                    settings.density === option.value
                      ? 'border-primary bg-primary/5'
                      : 'border-base-300 hover:bg-base-300/50'
                  "
                >
                  <input
                    class="radio radio-primary radio-sm"
                    type="radio"
                    name="talaria-density"
                    :value="option.value"
                    :checked="settings.density === option.value"
                    @change="settings.setDensity(option.value)"
                  />
                  <span class="min-w-0">
                    <span class="block text-[12.5px] font-medium">{{ option.label }}</span>
                    <span class="agate block">{{ option.hint }}</span>
                  </span>
                </label>
              </div>
            </fieldset>
          </div>
        </div>

        <!-- Actions (W1 organize, Round 3) -->
        <div class="card mt-4 border border-base-300 bg-base-100">
          <div class="card-body gap-4 p-4 md:p-5">
            <h3 class="card-title text-[13px] font-semibold">Actions</h3>

            <fieldset class="space-y-2" :disabled="!mail.canOrganize">
              <legend class="sr-only">Organize actions</legend>

              <label
                class="flex cursor-pointer items-center justify-between gap-3 rounded-field border border-base-300 px-3 py-2 transition-colors hover:bg-base-300/50"
              >
                <span class="min-w-0">
                  <span class="block text-[12.5px] font-medium">Mark as read on open</span>
                  <span class="agate block">Opening a record files it as read after a moment; if that fails it simply stays unread.</span>
                </span>
                <input
                  class="toggle toggle-primary toggle-sm flex-none"
                  type="checkbox"
                  :checked="settings.markReadOnOpen"
                  :aria-label="settings.markReadOnOpen ? 'Mark as read on open is on' : 'Mark as read on open is off'"
                  @change="settings.setMarkReadOnOpen(($event.target as HTMLInputElement).checked)"
                />
              </label>

              <label
                class="flex cursor-pointer items-center justify-between gap-3 rounded-field border px-3 py-2 transition-colors"
                :class="settings.showActions ? 'border-primary bg-primary/5' : 'border-base-300 hover:bg-base-300/50'"
              >
                <span class="min-w-0">
                  <span class="block text-[12.5px] font-medium">Show move &amp; organize controls</span>
                  <span class="agate block">Read/unread, flag, move to folder, new folder. Turn off to return to a pure reading view — the Thunderbird add-on keeps its tools enabled either way; this switch hides the controls only.</span>
                </span>
                <input
                  class="toggle toggle-primary toggle-sm flex-none"
                  type="checkbox"
                  :checked="settings.showActions"
                  :aria-label="settings.showActions ? 'Organize controls are shown' : 'Organize controls are hidden'"
                  @change="settings.setShowActions(($event.target as HTMLInputElement).checked)"
                />
              </label>

              <label
                class="flex cursor-pointer items-center justify-between gap-3 rounded-field border px-3 py-2 transition-colors"
                :class="settings.showComposer ? 'border-primary bg-primary/5' : 'border-base-300 hover:bg-base-300/50'"
              >
                <span class="min-w-0">
                  <span class="block text-[12.5px] font-medium">Drafts composer</span>
                  <span class="agate block">Compose, reply, reply-all and forward — every path saves into the Drafts folder. There is no send in Talaria: sending stays in Thunderbird or on your phone, and the add-on keeps sendMail disabled regardless of this switch.</span>
                </span>
                <input
                  class="toggle toggle-primary toggle-sm flex-none"
                  type="checkbox"
                  :checked="settings.showComposer"
                  :aria-label="settings.showComposer ? 'The drafts composer is shown' : 'The drafts composer is hidden'"
                  @change="settings.setShowComposer(($event.target as HTMLInputElement).checked)"
                />
              </label>
            </fieldset>

            <div v-if="!mail.canOrganize" class="alert alert-soft py-2.5" role="note">
              <IconGlyph name="book" :size="16" class="text-base-content/60" />
              <span class="text-[12.5px]">
                This backend does not carry the write tier — actions stay off.
              </span>
            </div>

            <div v-else class="alert alert-soft py-2.5" role="note">
              <IconGlyph :name="compose.available && settings.showComposer ? 'compose' : 'folder-in'" :size="16" class="text-base-content/60" />
              <span class="text-[12.5px]">
                <template v-if="compose.available && settings.showComposer">
                  <strong class="font-semibold">W1 organize + W2 drafts enabled</strong> — moves, folders,
                  flags, and draft-only composition from the register and the reader. Sending and
                  deletion remain Thunderbird-only: trash, junk and drafts are never offered as move
                  targets, and no send path exists.
                </template>
                <template v-else>
                  <strong class="font-semibold">W1 organize enabled</strong> — moves, folders and
                  flags are available from the register and the reader. Deletion remains
                  Thunderbird-only: trash, junk and drafts are never offered as move targets.
                </template>
              </span>
            </div>
          </div>
        </div>

        <!-- Search (Stage 2): the implicit scope of typed queries -->
        <div class="card mt-4 border border-base-300 bg-base-100">
          <div class="card-body gap-4 p-4 md:p-5">
            <h3 class="card-title text-[13px] font-semibold">Search</h3>

            <fieldset class="space-y-2">
              <legend class="text-[12.5px] font-medium">Search scope</legend>
              <p class="agate">Where a typed query is filed — the chip next to the results shows it.</p>
              <div class="space-y-1.5">
                <label
                  v-for="mode in scopeModes"
                  :key="mode.value"
                  class="flex cursor-pointer items-start gap-2.5 rounded-field border px-3 py-2 transition-colors"
                  :class="
                    settings.searchScope === mode.value
                      ? 'border-primary bg-primary/5'
                      : 'border-base-300 hover:bg-base-300/50'
                  "
                >
                  <input
                    class="radio radio-primary radio-sm mt-0.5"
                    type="radio"
                    name="talaria-search-scope"
                    :value="mode.value"
                    :checked="settings.searchScope === mode.value"
                    @change="settings.setSearchScope(mode.value)"
                  />
                  <span class="min-w-0">
                    <span class="block text-[12.5px] font-medium">{{ mode.label }}</span>
                    <span class="agate block">{{ mode.hint }}</span>
                  </span>
                </label>
              </div>
            </fieldset>

            <p class="agate">
              Saved searches live in the rail under “Searches” — keep one from the
              search field’s bookmark icon; right-click removes it.
            </p>
          </div>
        </div>

        <!-- Privacy (Stage 2): the remote-image consent gate -->
        <div class="card mt-4 border border-base-300 bg-base-100">
          <div class="card-body gap-4 p-4 md:p-5">
            <h3 class="card-title text-[13px] font-semibold">Privacy</h3>

            <label
              class="flex cursor-pointer items-center justify-between gap-3 rounded-field border px-3 py-2 transition-colors"
              :class="settings.alwaysLoadRemoteImages ? 'border-primary bg-primary/5' : 'border-base-300 hover:bg-base-300/50'"
            >
              <span class="min-w-0">
                <span class="block text-[12.5px] font-medium">Always load remote images</span>
                <span class="agate block">Render external images in every record without asking. Tracking pixels declared at 2 px or smaller are never requested; pixels that only reveal their size on load are removed from the record.</span>
              </span>
              <input
                class="toggle toggle-primary toggle-sm flex-none"
                type="checkbox"
                :checked="settings.alwaysLoadRemoteImages"
                :aria-label="settings.alwaysLoadRemoteImages ? 'Remote images always load' : 'Remote images load per message'"
                @change="settings.setAlwaysLoadRemoteImages(($event.target as HTMLInputElement).checked)"
              />
            </label>

            <label
              class="flex cursor-pointer items-center justify-between gap-3 rounded-field border px-3 py-2 transition-colors"
              :class="settings.neverAskRemoteImages ? 'border-primary bg-primary/5' : 'border-base-300 hover:bg-base-300/50'"
            >
              <span class="min-w-0">
                <span class="block text-[12.5px] font-medium">Never ask</span>
                <span class="agate block">Keep remote images stripped silently — no placeholder card, no per-message “Load images”.</span>
              </span>
              <input
                class="toggle toggle-primary toggle-sm flex-none"
                type="checkbox"
                :checked="settings.neverAskRemoteImages"
                :aria-label="settings.neverAskRemoteImages ? 'Remote images never load, no prompt' : 'Remote images ask per message'"
                @change="settings.setNeverAskRemoteImages(($event.target as HTMLInputElement).checked)"
              />
            </label>

            <p class="agate">
              Default: images are blocked per record with a “Load images” button —
              consent lasts for the session, then the record asks again.
            </p>
          </div>
        </div>

        <!-- Accounts (Stage 2): per-account visibility -->
        <div class="card mt-4 border border-base-300 bg-base-100">
          <div class="card-body gap-4 p-4 md:p-5">
            <h3 class="card-title text-[13px] font-semibold">Accounts</h3>
            <p class="agate">
              Hidden accounts drop out of the rail, the register and the tallies —
              in this browser only. Thunderbird keeps indexing them; a search or
              the live tally can still surface their mail elsewhere.
            </p>

            <div class="space-y-1.5">
              <label
                v-for="account in accounts.accounts"
                :key="account.id"
                class="flex cursor-pointer items-center justify-between gap-3 rounded-field border px-3 py-2 transition-colors"
                :class="
                  settings.hiddenAccountIds.includes(account.id)
                    ? 'border-base-300 bg-base-300/40 opacity-75'
                    : 'border-base-300 hover:bg-base-300/50'
                "
              >
                <span class="flex min-w-0 items-center gap-2">
                  <span
                    class="account-chip flex-none"
                    :style="{ background: `var(--acct-${account.colorIndex})` }"
                    aria-hidden="true"
                  />
                  <span class="min-w-0">
                    <span class="block truncate text-[12.5px] font-medium">{{ settings.accountLabel(account) }}</span>
                    <span class="agate block truncate">{{ account.email }} · {{ accounts.accountUnread(account.id) }} unread</span>
                  </span>
                </span>
                <input
                  class="toggle toggle-sm flex-none"
                  type="checkbox"
                  :checked="!settings.hiddenAccountIds.includes(account.id)"
                  :aria-label="settings.hiddenAccountIds.includes(account.id) ? `Show ${account.email}` : `Hide ${account.email}`"
                  @change="toggleAccountHidden(account.id, $event)"
                />
              </label>
            </div>

            <div v-if="accounts.hasHiddenAccounts" class="alert alert-soft py-2.5" role="note">
              <IconGlyph name="eye-off" :size="16" class="text-base-content/60" />
              <span class="text-[12.5px]">
                {{ settings.hiddenAccountIds.length }} of {{ accounts.accounts.length }} accounts hidden.
                The folio in the top bar counts visible accounts only; the sidecar’s
                live feed still sees everything.
              </span>
            </div>
          </div>
        </div>

        <!-- About / status -->
        <div class="card mt-4 border border-base-300 bg-base-100">
          <div class="card-body gap-3 p-4 md:p-5">
            <h3 class="card-title text-[13px] font-semibold">About &amp; status</h3>

            <dl class="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1.5">
              <dt class="agate w-28 text-right">Version</dt>
              <dd class="text-[12.5px] tabular">Talaria v{{ appVersion }}</dd>

              <dt class="agate w-28 text-right">Backend</dt>
              <dd class="flex min-w-0 items-center gap-2">
                <span
                  v-if="health"
                  class="status"
                  :class="health.commonpost?.reachable ? 'status-success' : 'status-error'"
                  aria-hidden="true"
                />
                <span class="min-w-0 truncate text-[12.5px]">
                  <template v-if="health?.commonpost?.reachable">
                    sidecar up · {{ health.commonpost.serverInfo?.name ?? "commonpost" }}
                    <template v-if="health.commonpost.serverInfo?.version">
                      v{{ health.commonpost.serverInfo.version }}</template>
                    <template v-if="health.commonpost.port"> · port {{ health.commonpost.port }}</template>
                  </template>
                  <template v-else-if="health">sidecar unreachable</template>
                  <template v-else>checking…</template>
                </span>
                <button
                  type="button"
                  class="btn btn-ghost btn-xs btn-circle"
                  :aria-label="healthChecking ? 'Checking backend' : 'Check backend status'"
                  :title="healthChecking ? 'Checking…' : 'Check status'"
                  @click="checkHealth"
                >
                  <IconGlyph name="refresh" :size="12" :class="healthChecking ? 'animate-spin' : ''" />
                </button>
              </dd>

              <dt class="agate w-28 text-right">Live updates</dt>
              <dd class="min-w-0 text-[12.5px]">
                SSE stream with a 15 s heartbeat; the unread tally is re-checked every 60 s.
              </dd>

              <dt class="agate w-28 text-right">Uptime</dt>
              <dd class="min-w-0 text-[12.5px] tabular">
                <template v-if="health?.uptime">{{ Math.round(health.uptime / 60) }} min sidecar uptime</template>
                <template v-else>—</template>
              </dd>
            </dl>

            <div class="alert alert-soft py-2.5" role="note">
              <IconGlyph name="book" :size="16" class="text-base-content/60" />
              <span v-if="posture === 'organize-drafts'" class="text-[12.5px]">
                <strong class="font-semibold">Organize + drafts tier (W1 + W2).</strong>
                Read/unread, flag, move, folder creation and draft-only composition
                (reply, reply-all, forward, new mail) are enabled. Sending is not part
                of Talaria — drafts wait in your mailbox for Thunderbird or your phone.
                Deletion stays in Thunderbird.
              </span>
              <span v-else-if="posture === 'organize'" class="text-[12.5px]">
                <strong class="font-semibold">Organize tier (W1).</strong>
                Mark read/unread, flag, move and folder creation are enabled
                server-side and in this view. Compose, drafts and every kind of
                deletion stay in Thunderbird.
              </span>
              <span v-else-if="posture === 'organize-hidden'" class="text-[12.5px]">
                <strong class="font-semibold">Reading view.</strong>
                The organize controls are hidden (Actions, above); send, drafts
                and deletion stay in Thunderbird regardless.
              </span>
              <span v-else class="text-[12.5px]">
                <strong class="font-semibold">Read-only view.</strong>
                Every write tool is disabled server-side. Reading, searching and
                filing views only — compose, move and delete stay in Thunderbird.
              </span>
            </div>

            <p v-if="ui.backendKind === 'mock'" class="agate text-warning" role="status">
              Demo data — mock backend. Settings still persist, but nothing here
              talks to Thunderbird.
            </p>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
