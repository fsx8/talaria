import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useAccountsStore } from "../src/stores/accounts";
import { useComposeStore } from "../src/stores/compose";
import { getBackend } from "../src/api";
import type { Account, Folder } from "../src/api/types";

/** Minimal account/folder seeds: the composer needs one visible identity
 *  with a Drafts-capable account in the rail. */
const account: Account = {
  id: "acc-1",
  label: "Ada Werner",
  email: "ada@wernerstudio.example",
  type: "imap",
  colorIndex: 0,
  identities: [{ id: "id1", email: "ada@wernerstudio.example", name: "Ada Werner", isDefault: true }],
  favorite: false,
};

const folder = (path: string, kind: Folder["kind"], unread = 0): Folder => ({
  path,
  name: path.split("/").pop() ?? path,
  kind,
  accountId: "acc-1",
  total: 5,
  unread,
  depth: 0,
  favorite: false,
});

function seedAccount() {
  const accounts = useAccountsStore();
  accounts.applySnapshot([account], {
    "acc-1": [folder("imap://ada@wernerstudio.example/INBOX", "inbox", 3), folder("imap://ada@wernerstudio.example/Drafts", "drafts"), folder("imap://ada@wernerstudio.example/Trash", "trash")],
  });
  return accounts;
}

describe("compose store — the honest close guard (review finding 3)", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    seedAccount();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function openComposer() {
    const compose = useComposeStore();
    await useComposeStore().probeCapability();
    compose.openNew();
    return compose;
  }

  it("closes a pristine composer silently — no guard, no lie", async () => {
    const compose = await openComposer();
    await compose.attemptClose();
    expect(compose.open).toBe(false);
    expect(compose.confirm).toBeNull();
    expect(compose.closeReason).toBeNull();
  });

  it("typed body → close runs the save and closes silently (no false failure)", async () => {
    const compose = await openComposer();
    const backend = getBackend();
    const spy = vi.spyOn(backend, "saveDraft");
    compose.setBody("<p>Danke für die erste Runde!</p>");
    expect(compose.dirty).toBe(true);
    await compose.attemptClose();
    expect(compose.confirm).toBeNull();
    expect(compose.closeReason).toBeNull();
    expect(compose.open).toBe(false);
    expect(spy).toHaveBeenCalled();
  });

  it("a save racing the close is awaited, never misread as failure", async () => {
    const compose = await openComposer();
    const backend = getBackend();
    const slow = Promise.resolve(true);
    const spy = vi
      .spyOn(backend, "saveDraft")
      .mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 20));
        return { success: true, messageId: "d-race", folderPath: "imap://ada@wernerstudio.example/Drafts" };
      });
    void slow;
    compose.setBody("<p>race</p>");
    const inflight = compose.save({ manual: false }); // blur flush in flight
    await compose.attemptClose(); // close arrives while the save runs
    await inflight;
    expect(compose.confirm).toBeNull();
    expect(compose.closeReason).not.toBe("saveFailed");
    expect(compose.open).toBe(false);
    spy.mockRestore();
  });

  it("a REAL save failure asks honestly with closeReason saveFailed", async () => {
    const compose = await openComposer();
    const backend = getBackend();
    const spy = vi.spyOn(backend, "saveDraft").mockRejectedValue(new Error("sidecar down"));
    compose.setBody("<p>unsaved</p>");
    await compose.attemptClose();
    expect(compose.confirm).toBe("close");
    expect(compose.closeReason).toBe("saveFailed");
    expect(compose.open).toBe(true); // the sheet stays — the text is not stored
    spy.mockRestore();
  });

  it("uncommitted recipient text asks with closeReason edits (never a save lie)", async () => {
    const compose = await openComposer();
    compose.setRecipientPending("to", true);
    await compose.attemptClose();
    expect(compose.confirm).toBe("close");
    expect(compose.closeReason).toBe("edits");
  });

  it("the seam never grows a send affordance", () => {
    const backend = getBackend() as unknown as Record<string, unknown>;
    expect(Object.keys(backend).filter((k) => /send/i.test(k))).toEqual([]);
  });
});
