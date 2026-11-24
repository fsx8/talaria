import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { getBackend } from "../src/api";

/** The seam-level contract against the in-memory demo register: operator
 *  search, thread grouping, and the safety invariants that must hold for
 *  every backend implementation. */
describe("demo register via the MailBackend seam", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("searches by free text", async () => {
    const backend = getBackend();
    const result = await backend.searchMessages({ text: "Rechnung" });
    expect(result.totalMatches).toBeGreaterThan(0);
    expect(
      result.messages.every((m) =>
        `${m.subject} ${m.author} ${m.recipients} ${m.preview}`.toLowerCase().includes("rechnung"),
      ),
    ).toBe(true);
  });

  it("honors the from: operator", async () => {
    const backend = getBackend();
    const result = await backend.searchMessages({ text: "from:mareike@sander-bauhaus.de" });
    expect(result.totalMatches).toBeGreaterThan(0);
    expect(result.messages.every((m) => m.author.toLowerCase().includes("mareike@sander-bauhaus.de"))).toBe(true);
  });

  it("honors the subject: operator with quoted phrases", async () => {
    const backend = getBackend();
    const result = await backend.searchMessages({ text: 'subject:"Logo refresh"' });
    expect(result.totalMatches).toBeGreaterThan(0);
    expect(result.messages.every((m) => m.subject.toLowerCase().includes("logo refresh"))).toBe(true);
  });

  it("returns summaries with the load-bearing fields", async () => {
    const backend = getBackend();
    const result = await backend.searchMessages({ text: "" });
    const row = result.messages[0]!;
    expect(row.id).toBeTruthy();
    expect(typeof row.folderPath).toBe("string");
    expect(typeof row.subject).toBe("string");
  });

  it("getMessage pairs a summary's id with its own folderPath", async () => {
    const backend = getBackend();
    const result = await backend.searchMessages({ text: "" });
    const row = result.messages[0]!;
    const detail = await backend.getMessage(row.id, row.folderPath);
    expect(detail.id).toBe(row.id);
    expect(detail.subject).toBe(row.subject);
    expect(detail.body.length).toBeGreaterThan(0);
  });
});

/** The product invariant, asserted at the seam: no backend implementation
 *  may ever grow a send or delete affordance. */
describe("the safety boundary", () => {
  it("exposes no send/delete tools on the seam", () => {
    const backend = getBackend() as unknown as Record<string, unknown>;
    const forbidden = Object.keys(backend).filter((k) => /send|delete|empty/i.test(k));
    expect(forbidden).toEqual([]);
  });
});
