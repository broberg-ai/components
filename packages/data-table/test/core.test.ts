// F094.1 — the core operations, without a DOM.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  compareValues,
  filterRows,
  loadHiddenColumns,
  nextSort,
  paginate,
  saveHiddenColumns,
  selectionState,
  sortRows,
  toggleAll,
  toggleOne,
  type ColumnStorage,
} from "../src/index";

type R = { id: string; name: string; n?: number | null };
const rows: R[] = [
  { id: "a", name: "Æble", n: 10 },
  { id: "b", name: "banan", n: 2 },
  { id: "c", name: "Abe", n: null },
  { id: "d", name: "Citron", n: 2 },
];
const get = (r: R, id: string) => (r as Record<string, unknown>)[id];
const ids = (rs: R[]) => rs.map((r) => r.id);

describe("nextSort", () => {
  it("cycles asc → desc → none, and a new column starts at asc", () => {
    expect(nextSort(null, "name")).toEqual({ columnId: "name", dir: "asc" });
    expect(nextSort({ columnId: "name", dir: "asc" }, "name")).toEqual({ columnId: "name", dir: "desc" });
    expect(nextSort({ columnId: "name", dir: "desc" }, "name")).toBeNull();
    expect(nextSort({ columnId: "name", dir: "desc" }, "n")).toEqual({ columnId: "n", dir: "asc" });
  });
});

describe("sortRows", () => {
  it("text sorts in Danish order (Æ after Z), case-insensitive", () => {
    expect(ids(sortRows(rows, { columnId: "name", dir: "asc" }, get))).toEqual(["c", "b", "d", "a"]);
    expect(ids(sortRows(rows, { columnId: "name", dir: "desc" }, get))).toEqual(["a", "d", "b", "c"]);
  });
  it("numbers sort numerically, ties keep input order, empty stays last both ways", () => {
    expect(ids(sortRows(rows, { columnId: "n", dir: "asc" }, get))).toEqual(["b", "d", "a", "c"]);
    expect(ids(sortRows(rows, { columnId: "n", dir: "desc" }, get))).toEqual(["a", "b", "d", "c"]);
  });
  it("null sort returns a copy in input order and never mutates", () => {
    const out = sortRows(rows, null, get);
    expect(ids(out)).toEqual(["a", "b", "c", "d"]);
    expect(out).not.toBe(rows);
    sortRows(rows, { columnId: "name", dir: "asc" }, get);
    expect(ids(rows)).toEqual(["a", "b", "c", "d"]);
  });
  it("compareValues: '10' after '9' (numeric text), not before", () => {
    expect(compareValues("10", "9")).toBeGreaterThan(0);
  });
});

describe("filterRows", () => {
  it("case-insensitive substring over every text, empty query keeps all", () => {
    expect(ids(filterRows(rows, "BAN", (r) => [r.name]))).toEqual(["b"]);
    expect(ids(filterRows(rows, "æb", (r) => [r.name]))).toEqual(["a"]);
    expect(ids(filterRows(rows, "  ", (r) => [r.name]))).toEqual(["a", "b", "c", "d"]);
    expect(ids(filterRows(rows, "2", (r) => [r.name, r.n]))).toEqual(["b", "d"]);
    expect(ids(filterRows(rows, "zzz", (r) => [r.name]))).toEqual([]);
  });
});

describe("paginate", () => {
  const many = Array.from({ length: 23 }, (_, i) => i);
  it("slices pages and counts them", () => {
    expect(paginate(many, 0, 10)).toEqual({ rows: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], pageIndex: 0, pageCount: 3 });
    expect(paginate(many, 2, 10)).toEqual({ rows: [20, 21, 22], pageIndex: 2, pageCount: 3 });
  });
  it("clamps an out-of-range page, and an empty table is page 1 of 1", () => {
    expect(paginate(many, 9, 10).pageIndex).toBe(2);
    expect(paginate(many, -3, 10).pageIndex).toBe(0);
    expect(paginate([], 0, 10)).toEqual({ rows: [], pageIndex: 0, pageCount: 1 });
  });
});

describe("selection", () => {
  it("none / some / all", () => {
    expect(selectionState(["a", "b"], new Set())).toBe("none");
    expect(selectionState(["a", "b"], new Set(["a"]))).toBe("some");
    expect(selectionState(["a", "b"], new Set(["a", "b", "z"]))).toBe("all");
  });
  it("toggleAll selects the rest when some, clears when all, and keeps ids outside the set", () => {
    expect([...toggleAll(["a", "b"], new Set(["a", "z"]))].sort()).toEqual(["a", "b", "z"]);
    expect([...toggleAll(["a", "b"], new Set(["a", "b", "z"]))]).toEqual(["z"]);
  });
  it("toggleOne flips one id", () => {
    expect([...toggleOne("a", new Set(["b"]))].sort()).toEqual(["a", "b"]);
    expect([...toggleOne("a", new Set(["a"]))]).toEqual([]);
  });
});

describe("hidden columns persistence", () => {
  const mem = (): ColumnStorage & { data: Record<string, string> } => {
    const data: Record<string, string> = {};
    return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
  };
  it("saves and loads back exactly what was saved, under the given key", () => {
    const s = mem();
    expect(saveHiddenColumns("t1", ["status", "n"], s)).toBe(true);
    expect(s.data).toEqual({ t1: '["status","n"]' });
    expect(loadHiddenColumns("t1", s)).toEqual(["status", "n"]);
    expect(loadHiddenColumns("other", s)).toEqual([]);
  });
  it("garbage or a throwing storage reads as nothing saved, never as a crash", () => {
    const s = mem();
    s.data.t1 = "{not json";
    expect(loadHiddenColumns("t1", s)).toEqual([]);
    s.data.t2 = '[1,"a"]';
    expect(loadHiddenColumns("t2", s)).toEqual(["a"]);
    const broken: ColumnStorage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("quota"); } };
    expect(loadHiddenColumns("t1", broken)).toEqual([]);
    expect(saveHiddenColumns("t1", ["a"], broken)).toBe(false);
    expect(saveHiddenColumns("t1", ["a"], null)).toBe(false);
  });
});

describe("package-wide guards", () => {
  const css = readFileSync(join(__dirname, "../css/data-table.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const src = readFileSync(join(__dirname, "../src/preact.tsx"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  it("the CSS writes no colour literal — every colour is a theme token", () => {
    expect(css.match(/#[0-9a-f]{3,8}\b/gi) ?? []).toEqual([]);
    expect(css.match(/\b(?:rgb|hsl)a?\((?![^)]*,\s*\.\d+\))[^)]*\)/gi) ?? []).toEqual([]);
  });
  it("no native select or dialog element in the component (D-4cd764)", () => {
    expect(src.match(/<(select|dialog|option)[\s>]/g) ?? []).toEqual([]);
  });
});

describe("F094.5 — nothing in the table pushes a phone page sideways (D-55a2af)", () => {
  // happy-dom has no layout, so the guard reads the rules the browser will apply.
  // Measured by appkit with Lens at 393px (run f187e0e1): the pager was 420px wide.
  const css = readFileSync(join(__dirname, "../css/data-table.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = (sel: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].trim() === sel).map((m) => m[2]).join(";");
  it.each([".bdt-pager", ".bdt-footer", ".bdt-toolbar"])("%s wraps and may shrink", (sel) => {
    expect([sel, /flex-wrap:\s*wrap/.test(rule(sel)), /min-width:\s*0/.test(rule(sel))]).toEqual([sel, true, true]);
  });
  it(".bdt-root cannot grow past its parent", () => {
    expect([/max-width:\s*100%/.test(rule(".bdt-root")), /min-width:\s*0/.test(rule(".bdt-root"))]).toEqual([true, true]);
  });
});
