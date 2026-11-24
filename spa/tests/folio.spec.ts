import { describe, expect, it, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import TopBar from "../src/components/TopBar.vue";
import { useAccountsStore } from "../src/stores/accounts";
import { useMailStore } from "../src/stores/mail";
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
  "acc-1": [
    { path: "acc-1/INBOX", name: "Inbox", kind: "inbox", accountId: "acc-1", total: 10, unread: 4, depth: 0, favorite: false },
    { path: "acc-1/Trash", name: "Trash", kind: "trash", accountId: "acc-1", total: 2, unread: 9, depth: 0, favorite: false },
  ],
  "acc-2": [
    { path: "acc-2/INBOX", name: "Inbox", kind: "inbox", accountId: "acc-2", total: 6, unread: 3, depth: 0, favorite: false },
  ],
};

/** The folio (review finding 5): the pill reads the locally reconciled rail
 *  tally — the SSE value seeds and stamps, it never overrides. */
describe("TopBar folio", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    const accounts = useAccountsStore();
    accounts.applySnapshot(accountsSeed, folders);
  });

  function mountBar() {
    return mount(TopBar, {
      global: {
        stubs: {
          IconGlyph: true,
          PushControl: true,
          ThemeMenu: true,
          SaveSearchControl: true,
          RecipientField: true,
        },
      },
    });
  }

  it("shows the reconciled rail tally (trash excluded)", () => {
    const wrapper = mountBar();
    expect(wrapper.find("span.tabular").text()).toBe("7"); // 4 + 3, Trash's 9 ignored
  });

  it("an SSE event with a divergent number never overrides the rail", async () => {
    const wrapper = mountBar();
    const mail = useMailStore();
    mail.lastMailEvent = { unread: 999, previous: 4, ts: new Date().toISOString(), isHello: true };
    await wrapper.vm.$nextTick();
    expect(wrapper.find("span.tabular").text()).toBe("7");
  });

  it("follows local reconciliation after read toggles", async () => {
    const wrapper = mountBar();
    const accounts = useAccountsStore();
    accounts.foldersByAccount["acc-1"]![0]!.unread = 1; // 3 read locally
    await wrapper.vm.$nextTick();
    expect(wrapper.find("span.tabular").text()).toBe("4"); // 1 + 3
  });
});
