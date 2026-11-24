import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useAccountsStore } from "../src/stores/accounts";
import { useSettingsStore } from "../src/stores/settings";
import type { Account, Folder } from "../src/api/types";

const accountsSeed: Account[] = [
  {
    id: "acc-1", label: "Ada", email: "ada@wernerstudio.example", type: "imap", colorIndex: 0,
    identities: [{ id: "id1", email: "ada@wernerstudio.example", name: "Ada", isDefault: true }], favorite: false,
  },
  {
    id: "acc-2", label: "Feldverein", email: "vorstand@feldverein.example", type: "imap", colorIndex: 1,
    identities: [{ id: "id2", email: "vorstand@feldverein.example", name: "Feldverein", isDefault: true }], favorite: false,
  },
];

const folders: Record<string, Folder[]> = {
  "acc-1": [{ path: "acc-1/INBOX", name: "Inbox", kind: "inbox", accountId: "acc-1", total: 9, unread: 4, depth: 0, favorite: false }],
  "acc-2": [{ path: "acc-2/INBOX", name: "Inbox", kind: "inbox", accountId: "acc-2", total: 6, unread: 3, depth: 0, favorite: false }],
};

/** Per-account visibility (Stage 2): the rail guardrail + honest tallies. */
describe("account visibility", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
    useAccountsStore().applySnapshot(accountsSeed, folders);
  });

  it("registerUnread counts every visible account, trash excluded", () => {
    const accounts = useAccountsStore();
    expect(accounts.registerUnread).toBe(7); // 4 + 3
  });

  it("hiding one account removes its unread from the register", () => {
    const settings = useSettingsStore();
    const accounts = useAccountsStore();
    expect(settings.setAccountHidden("acc-1", true, 2)).toBe(true);
    expect(accounts.registerUnread).toBe(3);
    expect(accounts.hasHiddenAccounts).toBe(true);
  });

  it("the guardrail refuses hiding the LAST visible account", () => {
    const settings = useSettingsStore();
    expect(settings.setAccountHidden("acc-1", true, 2)).toBe(true);
    expect(settings.setAccountHidden("acc-2", true, 2)).toBe(false);
    expect(accountsSeed.every((a) => !settings.hiddenAccountIds.includes(a.id) || a.id === "acc-1")).toBe(true);
  });

  it("hidden state persists across a fresh store", () => {
    const settings = useSettingsStore();
    settings.setAccountHidden("acc-1", true, 2);
    const fresh = useSettingsStore();
    expect(fresh.hiddenAccountIds).toEqual(["acc-1"]);
  });
});
