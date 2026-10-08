// @vitest-environment happy-dom
/** @jsxImportSource preact */
// F094.1 — the Preact table, asserted on what the DOM shows (strict equality).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { DataTable, type Column, type RowAction } from "../src/preact";

afterEach(cleanup);
// Node 25 ships its own half-built global localStorage; give the table a real one.
const store = new Map<string, string>();
const memStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  get length() { return store.size; },
};
vi.stubGlobal("localStorage", memStorage);
beforeEach(() => store.clear());

type Doc = { id: string; title: string; type: string; status: string; target: number; reviewer: string };
const DOCS: Doc[] = [
  { id: "1", title: "Cover page", type: "Cover", status: "Done", target: 18, reviewer: "eddie" },
  { id: "2", title: "Table of contents", type: "Narrative", status: "In Process", target: 29, reviewer: "jamik" },
  { id: "3", title: "Executive summary", type: "Narrative", status: "Done", target: 10, reviewer: "eddie" },
  { id: "4", title: "Annex", type: "Appendix", status: "Not Started", target: 1200, reviewer: "" },
];
const columns: Column<Doc>[] = [
  { id: "title", header: "Titel", sortable: true, hideable: false },
  { id: "type", header: "Type", cell: "badge", sortable: true },
  { id: "status", header: "Status", cell: "status", statusTone: (v) => (v === "Done" ? "done" : v === "In Process" ? "progress" : "pending") },
  { id: "target", header: "Mål", cell: "number", sortable: true },
  { id: "reviewer", header: "Ansvarlig", cell: "select", options: [{ value: "eddie", label: "Eddie Lake" }, { value: "jamik", label: "Jamik Tashpulatov" }] },
];
const many: Doc[] = Array.from({ length: 23 }, (_, i) => ({ id: `r${i}`, title: `Række ${String(i).padStart(2, "0")}`, type: "T", status: "Done", target: i, reviewer: "eddie" }));

const titles = () => screen.queryAllByTestId(/^data-table-cell-.+-title-td$/).map((td) => td.textContent);
const tid = (id: string) => screen.getByTestId(id);

describe("AC0 — sorting", () => {
  it("click cycles ascending → descending → unsorted, with aria-sort and order read from the DOM", () => {
    render(<DataTable columns={columns} rows={DOCS} getRowId={(r) => r.id} />);
    expect(tid("data-table-header-title").getAttribute("aria-sort")).toBe("none");
    fireEvent.click(tid("data-table-sort-title"));
    expect(tid("data-table-header-title").getAttribute("aria-sort")).toBe("ascending");
    expect(titles()).toEqual(["Annex", "Cover page", "Executive summary", "Table of contents"]);
    fireEvent.click(tid("data-table-sort-title"));
    expect(tid("data-table-header-title").getAttribute("aria-sort")).toBe("descending");
    expect(titles()).toEqual(["Table of contents", "Executive summary", "Cover page", "Annex"]);
    fireEvent.click(tid("data-table-sort-title"));
    expect(tid("data-table-header-title").getAttribute("aria-sort")).toBe("none");
    expect(titles()).toEqual(["Cover page", "Table of contents", "Executive summary", "Annex"]);
  });
  it("a number column sorts numerically, and a non-sortable column has no sort button", () => {
    render(<DataTable columns={columns} rows={DOCS} getRowId={(r) => r.id} />);
    fireEvent.click(tid("data-table-sort-target"));
    expect(titles()).toEqual(["Executive summary", "Cover page", "Table of contents", "Annex"]);
    expect(screen.queryByTestId("data-table-sort-status")).toBeNull();
    expect(tid("data-table-header-status").hasAttribute("aria-sort")).toBe(false);
  });
});

describe("AC1 — search and pagination", () => {
  it("search filters across text columns, case-insensitively, including a select cell's label", () => {
    render(<DataTable columns={columns} rows={DOCS} getRowId={(r) => r.id} />);
    fireEvent.input(tid("data-table-search"), { target: { value: "NARRATIVE" } });
    expect(titles()).toEqual(["Table of contents", "Executive summary"]);
    fireEvent.input(tid("data-table-search"), { target: { value: "tashpul" } });
    expect(titles()).toEqual(["Table of contents"]);
    fireEvent.input(tid("data-table-search"), { target: { value: "ingen-match" } });
    expect(titles()).toEqual([]);
    expect(tid("data-table-empty").textContent).toBe("Ingen resultater.");
  });
  it("Side x af y, the four buttons disabled at the edges, and rows-per-page as a custom dropdown", () => {
    render(<DataTable columns={columns} rows={many} getRowId={(r) => r.id} />);
    const label = () => tid("data-table-page-label").textContent;
    const disabled = () => ["first", "prev", "next", "last"].map((k) => (tid(`data-table-page-${k}`) as HTMLButtonElement).disabled);
    expect(label()).toBe("Side 1 af 3");
    expect(titles().length).toBe(10);
    expect(disabled()).toEqual([true, true, false, false]);
    fireEvent.click(tid("data-table-page-next"));
    expect(label()).toBe("Side 2 af 3");
    expect(disabled()).toEqual([false, false, false, false]);
    fireEvent.click(tid("data-table-page-last"));
    expect(label()).toBe("Side 3 af 3");
    expect(titles()).toEqual(["Række 20", "Række 21", "Række 22"]);
    expect(disabled()).toEqual([false, false, true, true]);
    fireEvent.click(tid("data-table-page-first"));
    expect(label()).toBe("Side 1 af 3");

    fireEvent.click(tid("data-table-page-size"));
    expect(document.querySelector("select")).toBeNull();
    fireEvent.click(tid("data-table-page-size-20"));
    expect(label()).toBe("Side 1 af 2");
    expect(titles().length).toBe(20);
    expect(screen.queryByTestId("data-table-page-size-panel")).toBeNull();
  });
  it("searching from a later page lands on page 1, never on an empty page", () => {
    render(<DataTable columns={columns} rows={many} getRowId={(r) => r.id} />);
    fireEvent.click(tid("data-table-page-last"));
    fireEvent.input(tid("data-table-search"), { target: { value: "Række 0" } });
    expect(tid("data-table-page-label").textContent).toBe("Side 1 af 1");
    expect(titles().length).toBe(10);
  });
});

describe("AC2 — selection", () => {
  it("row checkboxes, select-all with indeterminate, «x af y rækker valgt», and onSelectionChange ids", () => {
    const onSel = vi.fn();
    render(<DataTable columns={columns} rows={DOCS} getRowId={(r) => r.id} selectable onSelectionChange={onSel} />);
    const all = tid("data-table-select-all") as HTMLInputElement;
    expect(tid("data-table-selected-label").textContent).toBe("0 af 4 rækker valgt");
    expect([all.checked, all.indeterminate]).toEqual([false, false]);

    fireEvent.click(tid("data-table-select-2"));
    expect(onSel).toHaveBeenLastCalledWith(["2"]);
    expect(tid("data-table-selected-label").textContent).toBe("1 af 4 rækker valgt");
    expect([all.checked, all.indeterminate, all.getAttribute("aria-checked")]).toEqual([false, true, "mixed"]);

    fireEvent.click(all);
    expect([...onSel.mock.lastCall![0]].sort()).toEqual(["1", "2", "3", "4"]);
    expect(tid("data-table-selected-label").textContent).toBe("4 af 4 rækker valgt");
    expect([all.checked, all.indeterminate]).toEqual([true, false]);

    fireEvent.click(all);
    expect(onSel).toHaveBeenLastCalledWith([]);
    expect(tid("data-table-selected-label").textContent).toBe("0 af 4 rækker valgt");
  });
});

describe("AC3 — «Tilpas kolonner», remembered across a reload", () => {
  it("hides and shows columns, stays open for several toggles, and a fresh mount reads the saved choice", () => {
    const view = render(<DataTable columns={columns} rows={DOCS} getRowId={(r) => r.id} columnStorageKey="docs-cols" />);
    fireEvent.click(tid("data-table-columns"));
    expect(screen.queryByTestId("data-table-columns-title")).toBeNull(); // hideable:false is not offered
    expect(tid("data-table-columns-status").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(tid("data-table-columns-status"));
    fireEvent.click(tid("data-table-columns-type"));
    expect(tid("data-table-columns-panel")).toBeTruthy(); // still open
    expect(screen.queryByTestId("data-table-header-status")).toBeNull();
    expect(screen.queryByTestId("data-table-header-type")).toBeNull();
    expect(localStorage.getItem("docs-cols")).toBe('["status","type"]');

    view.unmount();
    render(<DataTable columns={columns} rows={DOCS} getRowId={(r) => r.id} columnStorageKey="docs-cols" />);
    expect(screen.queryByTestId("data-table-header-status")).toBeNull();
    expect(screen.queryByTestId("data-table-header-type")).toBeNull();
    expect(tid("data-table-header-target")).toBeTruthy();

    fireEvent.click(tid("data-table-columns"));
    fireEvent.click(tid("data-table-columns-status"));
    expect(tid("data-table-header-status")).toBeTruthy();
    expect(localStorage.getItem("docs-cols")).toBe('["type"]');
  });
  it("without a storage key, nothing is written", () => {
    render(<DataTable columns={columns} rows={DOCS} getRowId={(r) => r.id} />);
    fireEvent.click(tid("data-table-columns"));
    fireEvent.click(tid("data-table-columns-status"));
    expect(localStorage.length).toBe(0);
  });
});

describe("AC4 — the ⋮-menu per row", () => {
  const setup = () => {
    const edit = vi.fn();
    const del = vi.fn();
    const actions: RowAction<Doc>[] = [{ label: "Rediger", onSelect: edit }, { label: "Kopiér", onSelect: vi.fn() }, "separator", { label: "Slet", onSelect: del, destructive: true }];
    render(<DataTable columns={columns} rows={DOCS} getRowId={(r) => r.id} rowActions={actions} />);
    return { edit, del };
  };
  it("shows the actions with a separator and a red destructive item; the action gets the row", () => {
    const { del } = setup();
    fireEvent.click(tid("data-table-actions-3"));
    const panel = tid("data-table-actions-3-panel");
    expect([...panel.children].map((c) => (c.getAttribute("role") === "separator" ? "---" : c.textContent))).toEqual(["Rediger", "Kopiér", "---", "Slet"]);
    expect(tid("data-table-actions-3-3").classList.contains("is-destructive")).toBe(true);
    fireEvent.click(tid("data-table-actions-3-3"));
    expect(del).toHaveBeenCalledTimes(1);
    expect(del.mock.calls[0][0]).toEqual(DOCS[2]);
    expect(screen.queryByTestId("data-table-actions-3-panel")).toBeNull();
  });
  it("keyboard: ArrowDown opens, arrows move, Enter chooses, Escape closes", () => {
    const { edit } = setup();
    const btn = tid("data-table-actions-1");
    fireEvent.keyDown(btn, { key: "ArrowDown" });
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(btn.getAttribute("aria-activedescendant")).toBe("data-table-actions-1-opt-0");
    fireEvent.keyDown(btn, { key: "ArrowDown" });
    fireEvent.keyDown(btn, { key: "ArrowUp" });
    fireEvent.keyDown(btn, { key: "Enter" });
    expect(edit).toHaveBeenCalledTimes(1);
    expect(edit.mock.calls[0][0]).toEqual(DOCS[0]);
    fireEvent.keyDown(btn, { key: "ArrowDown" });
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(btn, { key: "Escape" });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  });
  it("a click outside closes it", () => {
    setup();
    fireEvent.click(tid("data-table-actions-2"));
    expect(screen.queryByTestId("data-table-actions-2-panel")).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId("data-table-actions-2-panel")).toBeNull();
  });
});

describe("AC5 — typed cells", () => {
  it("badge, status with icon tone, right-aligned tabular number, select cell → onCellChange", () => {
    const onCell = vi.fn();
    render(<DataTable columns={columns} rows={DOCS} getRowId={(r) => r.id} onCellChange={onCell} />);
    expect(tid("data-table-cell-1-type-td").querySelector(".bdt-badge")!.textContent).toBe("Cover");
    const status = tid("data-table-cell-2-status-td").querySelector(".bdt-status")!;
    expect([status.textContent, status.getAttribute("data-tone"), !!status.querySelector("svg")]).toEqual(["In Process", "progress", true]);
    const num = tid("data-table-cell-4-target-td");
    expect([num.textContent, num.classList.contains("bdt-align-right"), num.classList.contains("bdt-num")]).toEqual(["1.200", true, true]);

    const trigger = tid("data-table-cell-2-reviewer");
    expect(trigger.textContent).toBe("Jamik Tashpulatov");
    fireEvent.click(trigger);
    expect(tid("data-table-cell-2-reviewer-option-jamik").getAttribute("aria-selected")).toBe("true");
    expect(tid("data-table-cell-2-reviewer-option-jamik").querySelector("svg")).toBeTruthy();
    expect(tid("data-table-cell-2-reviewer-option-eddie").querySelector("svg")).toBeNull();
    fireEvent.click(tid("data-table-cell-2-reviewer-option-eddie"));
    expect(onCell).toHaveBeenCalledWith("2", "reviewer", "eddie");
    // choosing the value it already has is not a change
    fireEvent.click(tid("data-table-cell-1-reviewer"));
    fireEvent.click(tid("data-table-cell-1-reviewer-option-eddie"));
    expect(onCell).toHaveBeenCalledTimes(1);
  });
});

describe("AC6 — no native controls, testids on everything interactive", () => {
  it("renders no native select or dialog, and every button and input carries a data-testid", () => {
    render(<DataTable columns={columns} rows={DOCS} getRowId={(r) => r.id} selectable rowActions={[{ label: "Slet", onSelect: () => {}, destructive: true }]} />);
    fireEvent.click(tid("data-table-columns"));
    expect(document.querySelectorAll("select, dialog, option").length).toBe(0);
    const missing = [...document.querySelectorAll("button, input, [role=menuitem], [role=menuitemcheckbox], [role=option]")].filter((el) => !el.getAttribute("data-testid"));
    expect(missing.map((el) => el.outerHTML.slice(0, 80))).toEqual([]);
  });
});
