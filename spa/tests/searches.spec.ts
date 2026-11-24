import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useSearchesStore } from "../src/stores/searches";

describe("searches store — saved-search lifecycle (review finding 7)", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it("adds, persists, and survives a fresh store (the rail reads it)", () => {
    const store = useSearchesStore();
    const saved = store.add("Demo Rechnungen", "Rechnung");
    expect(saved).not.toBeNull();
    expect(store.items).toHaveLength(1);

    const fresh = useSearchesStore();
    expect(fresh.items.map((i) => i.name)).toEqual(["Demo Rechnungen"]);
    expect(fresh.items[0]!.query).toBe("Rechnung");
  });

  it("rename-overwrites on the same query instead of duplicating", () => {
    const store = useSearchesStore();
    store.add("First name", "invoice");
    store.add("Second name", "invoice");
    expect(store.items).toHaveLength(1);
    expect(store.items[0]!.name).toBe("Second name");
  });

  it("removal is instant and persisted (the ✕ button / keyboard path)", () => {
    const store = useSearchesStore();
    const saved = store.add("Demo", "demo-query")!;
    store.remove(saved.id);
    expect(store.items).toHaveLength(0);
    expect(useSearchesStore().items).toHaveLength(0);
  });

  it("refuses empty names/queries and caps the list at 30", () => {
    const store = useSearchesStore();
    expect(store.add("", "query")).toBeNull();
    expect(store.add("name", "   ")).toBeNull();
    for (let i = 0; i < 35; i++) store.add(`S${i}`, `q${i}`);
    expect(store.items).toHaveLength(30);
  });

  it("lists newest first (the rail's order)", () => {
    vi.useFakeTimers();
    const store = useSearchesStore();
    vi.setSystemTime(new Date("2026-11-24T10:00:00Z"));
    const a = store.add("A", "a")!;
    vi.setSystemTime(new Date("2026-11-24T10:01:00Z"));
    const b = store.add("B", "b")!;
    vi.useRealTimers();
    expect(store.sorted[0]!.id).toBe(b.id);
    expect(store.sorted[1]!.id).toBe(a.id);
  });
});
