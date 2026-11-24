import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import MoveMenu from "../src/components/MoveMenu.vue";
import { useAccountsStore } from "../src/stores/accounts";
import type { Account, Folder, MessageRef } from "../src/api/types";

const account: Account = {
  id: "acc-1", label: "Ada", email: "ada@wernerstudio.example", type: "imap", colorIndex: 0,
  identities: [{ id: "id1", email: "ada@wernerstudio.example", name: "Ada", isDefault: true }], favorite: false,
};

const folder = (path: string, name: string, kind: Folder["kind"]): Folder => ({
  path, name, kind, accountId: "acc-1", total: 1, unread: 0, depth: path.split("/").length - 1, favorite: false,
});

const item: MessageRef = { id: "m-1", folderPath: "imap://ada@wernerstudio.example/INBOX" };

/** The Move picker (review findings: ghost picker after scope switch +
 *  Escape must close it + delete-ish folders are never offered). */
describe("MoveMenu", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    const accounts = useAccountsStore();
    accounts.applySnapshot([account], {
      "acc-1": [
        folder("imap://ada@wernerstudio.example/INBOX", "Inbox", "inbox"),
        folder("imap://ada@wernerstudio.example/Trash", "Trash", "trash"),
        folder("imap://ada@wernerstudio.example/Junk", "Junk", "junk"),
        folder("imap://ada@wernerstudio.example/Drafts", "Drafts", "drafts"),
        folder("imap://ada@wernerstudio.example/Archive", "Archive", "archive"),
      ],
    });
  });

  function mountMenu(props: Partial<{ items: MessageRef[]; disabled: boolean }> = {}) {
    return mount(MoveMenu, {
      props: { items: [item], ...props },
      global: { stubs: { IconGlyph: true } },
    });
  }

  function open(wrapper: ReturnType<typeof mountMenu>) {
    const details = wrapper.find("details");
    (details.element as HTMLDetailsElement).open = true;
    details.trigger("toggle");
    return details;
  }

  it("offers only real mail places — never Trash/Junk/Drafts", () => {
    const wrapper = mountMenu();
    const details = open(wrapper);
    expect(details.text()).toContain("Archive");
    for (const gone of ["Trash", "Junk", "Drafts"]) {
      expect(details.find(`[data-folder-path$="/${gone}"]`).exists()).toBe(false);
    }
  });

  it("closes itself when the entries vanish (the scope-switch ghost)", async () => {
    const wrapper = mountMenu();
    const details = open(wrapper);
    expect((details.element as HTMLDetailsElement).open).toBe(true);
    await wrapper.setProps({ items: [] });
    await wrapper.vm.$nextTick();
    expect((details.element as HTMLDetailsElement).open).toBe(false);
  });

  it("closes itself when the batch is disabled", async () => {
    const wrapper = mountMenu();
    const details = open(wrapper);
    await wrapper.setProps({ disabled: true });
    await wrapper.vm.$nextTick();
    expect((details.element as HTMLDetailsElement).open).toBe(false);
  });

  it("Escape closes the open panel — keyboard users are never trapped", async () => {
    const wrapper = mountMenu();
    const details = open(wrapper);
    await details.trigger("keydown", { key: "Escape" });
    await wrapper.vm.$nextTick();
    expect((details.element as HTMLDetailsElement).open).toBe(false);
  });
});
