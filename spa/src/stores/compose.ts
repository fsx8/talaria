/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { defineStore } from "pinia";
import DOMPurify from "dompurify";
import { getBackend } from "../api";
import type { ComposeTarget, DraftFields, Recipient } from "../api/backend-interface";
import { parseAddress } from "../composables/format";
import { useAccountsStore } from "./accounts";
import { useMailStore } from "./mail";
import { useSettingsStore } from "./settings";
import { useToastStore } from "./toast";

/**
 * The drafts composer (Round 3, Stage 3): reply, reply-all, forward and
 * new mail — all saving as DRAFTS into the identity's Drafts folder.
 * Sending stays outside Talaria by design (sendMail is disabled server-side
 * and the addon's skipReview block refuses direct send behind these tools;
 * this store never even builds a send call).
 *
 * Save routing per mode:
 * - new/draft   → saveDraft (draftId rewrites; keepQuote=false — the editor
 *                 holds the full body, so what it shows is what stores)
 * - reply, first save → replyToMessage mode:"draft" (Thunderbird computes
 *                 Re: subject, references, quote, signature — verified live)
 * - reply, later saves → saveDraft with draftId and keepQuote=true
 *                 (replaces only the typed text, keeps the TB quote block)
 * - forward     → saveDraft, quote composed client-side (the addon's
 *                 forwardMessage mode:"draft" hangs on IMAP here — see
 *                 openForward); the composer then behaves exactly like a
 *                 new draft, quote included in the editable body.
 *
 * Autosave: debounced (20 s) after any change + on editor blur; failures
 * surface honestly (indicator + toast) — nothing is queued.
 */

export type ComposeMode = "new" | "reply" | "replyAll" | "forward" | "draft";

/** Debounce window for the autosave while typing. */
const AUTO_SAVE_MS = 20_000;

/** Cap for the quoted original in a client-side forward — the register's
 *  bodies are already capped at 200 KB; drafts stay well under that. */
const FORWARD_QUOTE_MAX = 40_000;

/** The forward quote block, built from the READER's sanitized body (the
 *  html pipeline already stripped scripts; images are stripped here). What
 *  the editor shows is exactly what the draft stores — Thunderbird renders
 *  this structure like its own inline forwards. */
function forwardQuoteHtml(detail: { author: string; date: string; subject: string; recipients: string; body: string; bodyTruncated: boolean }): string {
  // Same sanitizer posture as the reader: no scripts, no remote images.
  const quoted = DOMPurify.sanitize(detail.body, {
    FORBID_TAGS: ["img", "style", "form", "input", "link", "meta"],
    FORBID_ATTR: ["style", "srcset"],
    ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i,
  }).trim();
  const capped = quoted.length > FORWARD_QUOTE_MAX ? `${quoted.slice(0, FORWARD_QUOTE_MAX)} …` : quoted;
  const truncation = detail.bodyTruncated ? `<p>[The full original is longer — it stays in the register.]</p>` : "";
  return [
    "<p></p>",
    "<p>-------- Original Message --------</p>",
    `<p>From: ${escapeText(detail.author)}<br />`,
    `Date: ${escapeText(detail.date)}<br />`,
    `Subject: ${escapeText(detail.subject)}<br />`,
    `To: ${escapeText(detail.recipients || "(no recipients)")}</p>`,
    truncation,
    `<blockquote><p>${capped}</p></blockquote>`,
  ].join("\n");
}

/** The reply quote block: Thunderbird's classic "On <date>, <author> wrote:"
 *  inline form, built from the READER's sanitized body (same posture as the
 *  forward quote — no scripts, no remote images). */
function replyQuoteHtml(detail: { author: string; date: string; subject: string; recipients: string; body: string; bodyTruncated: boolean }): string {
  const quoted = DOMPurify.sanitize(detail.body, {
    FORBID_TAGS: ["img", "style", "form", "input", "link", "meta"],
    FORBID_ATTR: ["style", "srcset"],
    ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i,
  }).trim();
  const capped = quoted.length > FORWARD_QUOTE_MAX ? `${quoted.slice(0, FORWARD_QUOTE_MAX)} …` : quoted;
  const truncation = detail.bodyTruncated ? `<p>[The full original is longer — it stays in the register.]</p>` : "";
  return [
    "<p></p>",
    `<p>On ${escapeText(detail.date)}, ${escapeText(detail.author)} wrote:</p>`,
    truncation,
    `<blockquote><p>${capped}</p></blockquote>`,
  ].join("\n");
}

function escapeText(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export const useComposeStore = defineStore("compose", {
  state: () => ({
    open: false,
    mode: "new" as ComposeMode,
    /** The saved draft's message id — set after the first save; also the
     *  edit path when a draft is opened from the Drafts folder. */
    draftId: null as string | null,
    draftFolderPath: null as string | null,
    /** Reply/forward: the message being answered (quote composed client-side). */
    target: null as ComposeTarget | null,
    targetSubject: "",
    targetAuthor: "",
    targetDate: "",
    targetBodyHtml: "",

    from: "",
    to: [] as Recipient[],
    cc: [] as Recipient[],
    bcc: [] as Recipient[],
    subject: "",
    body: "",

    dirty: false,
    saving: false,
    savedAt: 0,
    saveError: null as string | null,
    /** Pending confirmation: "close" (unsaved) or "discard". */
    confirm: null as "close" | "discard" | null,

    /** Honest capability: does the add-on serve the draft tier? Probed
     *  lazily once per session (null = not yet asked). */
    capability: null as boolean | null,

    autoTimer: null as ReturnType<typeof setTimeout> | null,
  }),

  getters: {
    /** The seam carries the composer AND the add-on answered to the probe. */
    available(state): boolean {
      const backend = getBackend();
      if (typeof backend.saveDraft !== "function") return false;
      return state.capability !== false;
    },
    /** Entry points also respect the courtesy switch. */
    entryVisible(): boolean {
      return this.available && useSettingsStore().showComposer;
    },
    title(state): string {
      switch (state.mode) {
        case "reply":
          return "Reply";
        case "replyAll":
          return "Reply all";
        case "forward":
          return "Forward";
        case "draft":
          return "Draft";
        default:
          return "New message";
      }
    },
  },

  actions: {
    /** Ask the backend once whether the draft tier is enabled server-side. */
    async probeCapability() {
      if (this.capability !== null) return;
      const backend = getBackend();
      if (typeof backend.hasComposeTools !== "function") {
        this.capability = typeof backend.saveDraft === "function";
        return;
      }
      try {
        this.capability = await backend.hasComposeTools();
      } catch {
        this.capability = false;
      }
    },

    /** Ask lazily from the entry points; the probe result flips the chip. */
    ensureProbed() {
      if (this.capability === null) void this.probeCapability();
    },

    /* ---- opening ---- */

    openNew() {
      if (!this.entryVisible || this.open) return;
      const accounts = useAccountsStore();
      const first = accounts.visibleAccounts[0];
      this.resetFields();
      this.mode = "new";
      this.target = null;
      this.from = first?.identities.find((i) => i.isDefault)?.email ?? first?.email ?? "";
      this.open = true;
    },

    /** Reply (all=false) or reply-all (all=true) to the open record. */
    openReply(all: boolean) {
      const mail = useMailStore();
      const accounts = useAccountsStore();
      const detail = mail.selectedDetail;
      const summary = mail.selectedSummary;
      if (!detail || !summary || !this.entryVisible || this.open) return;
      if (this.isDraftsRow(summary.folderPath)) return;
      const self = accounts.selfAddresses;
      const recipientsOf = (raw: string): Recipient[] =>
        raw
          .split(/[,;]+/)
          .map((piece) => piece.trim())
          .filter(Boolean)
          .map((piece) => parseAddress(piece))
          .filter((r) => r.email && !self.has(r.email.toLowerCase()));
      const to: Recipient[] = recipientsOf(detail.author);
      const cc: Recipient[] = [];
      if (all) {
        for (const piece of recipientsOf(detail.recipients)) {
          (to.some((t) => t.email === piece.email) ? cc : to).push(piece);
        }
        cc.push(...recipientsOf(detail.ccList).filter((r) => !to.some((t) => t.email === r.email) && !cc.some((c) => c.email === r.email)));
      }
      this.resetFields();
      this.mode = all ? "replyAll" : "reply";
      this.target = { id: detail.id, folderPath: summary.folderPath || detail.folderPath };
      this.targetSubject = detail.subject;
      this.targetAuthor = detail.author;
      this.targetDate = detail.date;
      this.targetBodyHtml = detail.body;
      this.from = this.receivingIdentity(detail, summary.folderPath);
      this.to = to;
      this.cc = cc;
      this.subject = this.prefixedSubject(detail.subject, "Re");
      // The reply quote is composed CLIENT-side (same pipeline as the
      // forward): the add-on's replyToMessage mode:"draft" hangs on IMAP
      // exactly like its forwardMessage sibling — verified live on a
      // freshly restarted Thunderbird 2026-11-24, and the hang wedges the
      // whole compose service (even plain saveDraft) until TB restarts.
      // Reply drafts therefore store our quote and lose In-Reply-To/
      // References threading until the add-on fixes the compose tools.
      this.body = replyQuoteHtml(detail);
      this.open = true;
    },

    /** Forward: the quote is composed CLIENT-side into the editor (wysiwyg —
     *  the user edits exactly what stores). The addon's forwardMessage
     *  mode:"draft" hangs on IMAP in this environment (verified live: no
     *  draft ever lands, even after minutes — its window-less ForwardInline
     *  compose never completes its IMAP body stream; replyToMessage hangs
     *  the same way, see openReply), so the forward goes through the proven
     *  saveDraft path instead. Attachments are not copied — noted in the
     *  sheet. */
    openForward() {
      const mail = useMailStore();
      const detail = mail.selectedDetail;
      const summary = mail.selectedSummary;
      if (!detail || !summary || !this.entryVisible || this.open) return;
      if (this.isDraftsRow(summary.folderPath)) return;
      this.resetFields();
      this.mode = "forward";
      this.target = { id: detail.id, folderPath: summary.folderPath || detail.folderPath };
      this.targetSubject = detail.subject;
      this.targetAuthor = detail.author;
      this.targetDate = detail.date;
      this.targetBodyHtml = detail.body;
      this.from = this.receivingIdentity(detail, summary.folderPath);
      this.subject = this.prefixedSubject(detail.subject, "Fwd");
      // The quoted original, built from the reader's sanitized body — what
      // the editor shows is what the draft stores.
      this.body = forwardQuoteHtml(detail);
      this.open = true;
    },

    /** Open a Drafts-folder row back in the composer (draftId update path). */
    async openDraft(id: string) {
      const mail = useMailStore();
      if (!this.entryVisible || this.open) return;
      const summary = mail.messages.find((m) => m.id === id) ?? mail.selectedSummary;
      if (!summary) return;
      this.resetFields();
      this.mode = "draft";
      this.draftId = summary.id;
      this.draftFolderPath = summary.folderPath;
      this.subject = summary.subject;
      this.from = parseAddress(summary.author).email;
      this.to = this.parseRecipients(summary.recipients);
      this.cc = this.parseRecipients(summary.ccList);
      this.open = true;
      // The register's select() has usually cached the detail already —
      // otherwise fetch it for the body.
      let detail = mail.detailById.get(id) ?? null;
      if (!detail) {
        try {
          detail = await getBackend().getMessage(id, summary.folderPath);
        } catch (cause) {
          this.open = false;
          useToastStore().err(cause instanceof Error ? cause.message : "The draft could not be opened.");
          return;
        }
      }
      if (!this.open || this.draftId !== id) return; // closed meanwhile
      this.targetBodyHtml = detail.body;
      this.body = detail.body; // sanitized by the editor on bind (strip scripts)
      this.subject = detail.subject || summary.subject;
      this.cc = this.cc.length ? this.cc : this.parseRecipients(detail.ccList);
      this.dirty = false;
    },

    /* ---- editing ---- */

    /** Called by the editor component on every content change. */
    setBody(html: string) {
      if (this.body === html) return;
      this.body = html;
      this.markDirty();
    },
    markDirty() {
      this.dirty = true;
      this.saveError = null;
      this.scheduleAutoSave();
    },
    scheduleAutoSave() {
      if (this.autoTimer) clearTimeout(this.autoTimer);
      this.autoTimer = setTimeout(() => {
        this.autoTimer = null;
        if (this.open && this.dirty && !this.saving) void this.save({ manual: false });
      }, AUTO_SAVE_MS);
    },
    /** Editor focus lost — flush now rather than in 20 s. */
    flushOnBlur() {
      if (this.open && this.dirty && !this.saving) void this.save({ manual: false });
    },

    /* ---- saving ---- */

    fields(): DraftFields {
      return {
        from: this.from || undefined,
        to: this.to,
        cc: this.cc,
        bcc: this.bcc,
        subject: this.subject,
        body: this.body,
      };
    },

    async save(opts: { manual?: boolean; thenClose?: boolean } = {}): Promise<boolean> {
      if (!this.open || this.saving) return false;
      const backend = getBackend();
      if (typeof backend.saveDraft !== "function") return false;
      const toast = useToastStore();
      const manual = opts.manual ?? true;
      if (this.autoTimer) {
        clearTimeout(this.autoTimer);
        this.autoTimer = null;
      }
      this.saving = true;
      this.saveError = null;
      try {
        const fields = this.fields();
        let result;
        if (this.draftId) {
          // Draft edit: replace only the typed text, keep the stored quote.
          result = await backend.saveDraft!(fields, this.draftId, true);
        } else {
          // First save — new, reply, reply-all, forward: full body via the
          // proven saveDraft path (the editor holds everything: reply and
          // forward quotes are composed client-side; see openReply for why
          // the addon's reply/forward compose tools must not be called).
          result = await backend.saveDraft!(fields, undefined, false);
        }
        if (result.messageId) this.draftId = result.messageId;
        if (result.folderPath) this.draftFolderPath = result.folderPath;
        if (result.warning) toast.err(`Note: ${result.warning}`);
        this.dirty = false;
        this.savedAt = Date.now();
        if (manual) toast.ok(this.draftId ? "Draft saved" : "Draft saved");
        if (opts.thenClose) this.close();
        return true;
      } catch (cause) {
        this.saveError = cause instanceof Error ? cause.message : "The draft could not be saved.";
        if (manual) toast.err(this.saveError);
        return false;
      } finally {
        this.saving = false;
      }
    },

    /** Close (keeps the draft): save if dirty, confirm when the save fails. */
    async attemptClose() {
      if (this.confirm) return;
      if (this.dirty) {
        const saved = await this.save({ manual: false });
        if (!saved) {
          this.confirm = "close"; // honest: the draft is NOT in the mailbox
          return;
        }
      } else if (this.saving) {
        return; // a save is in flight — let it land first
      }
      this.close();
    },

    /** Discard: existing draft → move to Trash via the W1 move path. */
    async discard() {
      const mail = useMailStore();
      const accounts = useAccountsStore();
      const toast = useToastStore();
      this.confirm = null;
      const id = this.draftId;
      const folderPath = this.draftFolderPath;
      this.close();
      if (id && folderPath) {
        const trash = accounts.trashOfFolderPath(folderPath);
        if (trash) {
          await mail.moveTo([{ id, folderPath }], trash);
          return;
        }
        toast.err("The Trash folder of this account is unknown — discard it in Thunderbird.");
      }
    },

    close() {
      if (this.autoTimer) {
        clearTimeout(this.autoTimer);
        this.autoTimer = null;
      }
      this.open = false;
      this.confirm = null;
      this.resetFields();
    },

    confirmDiscard() {
      this.confirm = "discard";
    },
    cancelConfirm() {
      this.confirm = null;
    },

    /* ---- helpers ---- */

    resetFields() {
      this.draftId = null;
      this.draftFolderPath = null;
      this.target = null;
      this.targetSubject = "";
      this.targetAuthor = "";
      this.targetDate = "";
      this.targetBodyHtml = "";
      this.from = "";
      this.to = [];
      this.cc = [];
      this.bcc = [];
      this.subject = "";
      this.body = "";
      this.dirty = false;
      this.saving = false;
      this.savedAt = 0;
      this.saveError = null;
    },

    isDraftsRow(folderPath: string): boolean {
      return useAccountsStore().folderByPath(folderPath)?.kind === "drafts";
    },

    /** The identity of the account the message was addressed to — the From
     *  a reply should carry (Thunderbird applies the same rule server-side). */
    receivingIdentity(detail: { recipients: string; author: string }, folderPath: string): string {
      const accounts = useAccountsStore();
      const accountId = accounts.accountOfFolder(folderPath);
      const account = accounts.accounts.find((a) => a.id === accountId);
      const email = account?.identities.find((i) => i.isDefault)?.email ?? account?.email;
      if (email) return email;
      // Cross-folder fallback: scan the recipients for a known self address.
      for (const piece of detail.recipients.split(/[,;]+/)) {
        const parsed = parseAddress(piece.trim());
        const hit = [...accounts.selfAddresses].find((self) => self === parsed.email.toLowerCase());
        if (hit) return hit;
      }
      return accounts.visibleAccounts[0]?.email ?? "";
    },

    /** Re:/Fwd: without stacking (Re: Re:). */
    prefixedSubject(subject: string, prefix: string): string {
      const trimmed = subject.trim();
      if (prefix === "Re" && /^re:/i.test(trimmed)) return trimmed;
      if (prefix === "Fwd" && /^(fwd|fw):/i.test(trimmed)) return trimmed;
      return `${prefix}: ${trimmed}`;
    },

    parseRecipients(raw: string): Recipient[] {
      return raw
        .split(/[,;]+/)
        .map((piece) => piece.trim())
        .filter(Boolean)
        .map((piece) => parseAddress(piece))
        .filter((r) => r.email);
    },
  },
});
