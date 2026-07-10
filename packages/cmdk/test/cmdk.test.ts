import { describe, it, expect, vi } from "vitest";
import {
  fuzzyFilter,
  createRecentsStore,
  createPaletteController,
  type PaletteItem,
} from "../src/index.js";

const items: PaletteItem[] = [
  { id: "new-doc", label: "New document", keywords: ["create", "page"] },
  { id: "settings", label: "Open settings" },
  { id: "profile", label: "Edit profile" },
  { id: "dash", label: "Go to dashboard" },
];

describe("fuzzyFilter", () => {
  it("returns all items in original order for an empty query", () => {
    expect(fuzzyFilter(items, "").map((i) => i.id)).toEqual(["new-doc", "settings", "profile", "dash"]);
  });

  it("subsequence-matches and excludes non-matches", () => {
    const r = fuzzyFilter(items, "prof");
    expect(r.map((i) => i.id)).toEqual(["profile"]);
  });

  it("matches on keywords, not just the label", () => {
    const r = fuzzyFilter(items, "create");
    expect(r[0].id).toBe("new-doc");
  });

  it("ranks a word-boundary / prefix match above a scattered one", () => {
    const set: PaletteItem[] = [
      { id: "a", label: "Save changes" }, // 's' scattered
      { id: "b", label: "Settings" }, // 's' prefix
    ];
    expect(fuzzyFilter(set, "set")[0].id).toBe("b");
  });

  it("respects the limit", () => {
    expect(fuzzyFilter(items, "", { limit: 2 })).toHaveLength(2);
  });
});

describe("createRecentsStore", () => {
  function memStore() {
    const m = new Map<string, string>();
    return {
      map: m,
      storage: {
        getItem: (k: string) => m.get(k) ?? null,
        setItem: (k: string, v: string) => void m.set(k, v),
        removeItem: (k: string) => void m.delete(k),
      },
    };
  }

  it("dedups and keeps most-recent-first", () => {
    const { storage } = memStore();
    const r = createRecentsStore("k", 5, storage);
    r.push("a");
    r.push("b");
    r.push("a"); // moves a to front
    expect(r.get()).toEqual(["a", "b"]);
  });

  it("caps at max", () => {
    const { storage } = memStore();
    const r = createRecentsStore("k", 2, storage);
    r.push("a");
    r.push("b");
    r.push("c");
    expect(r.get()).toEqual(["c", "b"]);
  });

  it("swallows a quota error and keeps working in-memory", () => {
    const throwing = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceeded");
      },
    };
    const r = createRecentsStore("k", 5, throwing);
    expect(() => r.push("a")).not.toThrow();
  });

  it("falls back to memory when no storage is usable", () => {
    const r = createRecentsStore("k", 5, undefined);
    r.push("x");
    // globalThis has no localStorage in this test env → memory path
    expect(r.get()).toContain("x");
  });
});

describe("createPaletteController", () => {
  it("filters on setQuery and resets the active index", () => {
    const c = createPaletteController({ items });
    c.moveDown(); // activeIndex = 1
    c.setQuery("set");
    const s = c.getState();
    expect(s.results.map((i) => i.id)).toEqual(["settings"]);
    expect(s.activeIndex).toBe(0);
  });

  it("wraps keyboard navigation at both boundaries", () => {
    const c = createPaletteController({ items });
    expect(c.getState().activeIndex).toBe(0);
    c.moveUp(); // wrap to last
    expect(c.getState().activeIndex).toBe(3);
    c.moveDown(); // wrap to first
    expect(c.getState().activeIndex).toBe(0);
  });

  it("selectActive runs the item action, records a recent, and closes", () => {
    const action = vi.fn();
    const list: PaletteItem[] = [{ id: "go", label: "Go", action }];
    const recents = createRecentsStore("k", 5, {
      getItem: () => null,
      setItem: () => {},
    });
    const pushSpy = vi.spyOn(recents, "push");
    const c = createPaletteController({ items: list, recentsStore: recents });
    c.open();
    const picked = c.selectActive();
    expect(picked?.id).toBe("go");
    expect(action).toHaveBeenCalledOnce();
    expect(pushSpy).toHaveBeenCalledWith("go");
    expect(c.getState().open).toBe(false);
    expect(c.getState().query).toBe("");
  });

  it("select(item) activates a specific item (click path)", () => {
    const action = vi.fn();
    const c = createPaletteController({ items: [{ id: "x", label: "X", action }] });
    c.select({ id: "x", label: "X", action });
    expect(action).toHaveBeenCalledOnce();
  });

  it("notifies subscribers on state changes", () => {
    const c = createPaletteController({ items });
    const seen: number[] = [];
    const off = c.subscribe((s) => seen.push(s.results.length));
    c.setQuery("prof"); // 1 result
    c.close();
    expect(seen[0]).toBe(1);
    off();
    c.setQuery("x");
    expect(seen).toHaveLength(2); // no more after unsubscribe
  });

  it("recents() maps stored ids back to current items", () => {
    const recents = createRecentsStore("k", 5, {
      getItem: () => JSON.stringify(["profile", "settings"]),
      setItem: () => {},
    });
    const c = createPaletteController({ items, recentsStore: recents });
    expect(c.recents().map((i) => i.id)).toEqual(["profile", "settings"]);
  });

  it("close resets query + active index", () => {
    const c = createPaletteController({ items });
    c.open();
    c.setQuery("set");
    c.close();
    expect(c.getState()).toMatchObject({ open: false, query: "", activeIndex: 0 });
  });
});
