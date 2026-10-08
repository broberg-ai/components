// @vitest-environment happy-dom
/** @jsxImportSource preact */
// F094.3 — below 768px every row is a card. matchMedia is stubbed to answer
// "mobile", which is how the component decides; nothing else changes.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { DataTable, type Column } from "../src/preact";

const store = new Map<string, string>();
vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), clear: () => store.clear(), get length() { return store.size; } });

let mobile = true;
beforeEach(() => {
  mobile = true;
  store.clear();
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: mobile && q.includes("max-width: 767px"), media: q, addEventListener() {}, removeEventListener() {} }));
});
afterEach(cleanup);

type Doc = { id: string; title: string; type: string; target: number };
const DOCS: Doc[] = Array.from({ length: 13 }, (_, i) => ({ id: String(i + 1), title: `Dokument ${String(i + 1).padStart(2, "0")}`, type: i % 2 ? "Narrative" : "Cover", target: (i + 1) * 100 }));
const columns: Column<Doc>[] = [
  { id: "title", header: "Titel", sortable: true, hideable: false },
  { id: "type", header: "Type", cell: "badge" },
  { id: "target", header: "Mål", cell: "number" },
];
const tid = (id: string) => screen.getByTestId(id);
const cardIds = () => screen.queryAllByTestId(/^row-card-/).map((el) => el.getAttribute("data-testid"));

describe("AC0 — cards with stacked label + value", () => {
  it("renders a card per row and no table at all", () => {
    render(<DataTable columns={columns} rows={DOCS.slice(0, 2)} getRowId={(r) => r.id} />);
    expect(document.querySelector("table")).toBeNull();
    expect(cardIds()).toEqual(["row-card-1", "row-card-2"]);
    const card = tid("row-card-2");
    expect(card.querySelector(".bdt-card-title")!.textContent).toBe("Dokument 02");
    expect([...card.querySelectorAll(".bdt-card-field")].map((f) => [f.querySelector("dt")!.textContent, f.querySelector("dd")!.textContent])).toEqual([
      ["Type", "Narrative"],
      ["Mål", "200"],
    ]);
  });
  it("a hidden column is hidden in the card too", () => {
    render(<DataTable columns={columns} rows={DOCS.slice(0, 1)} getRowId={(r) => r.id} />);
    fireEvent.click(tid("data-table-columns"));
    fireEvent.click(tid("data-table-columns-type"));
    expect([...tid("row-card-1").querySelectorAll("dt")].map((d) => d.textContent)).toEqual(["Mål"]);
  });
  it("at desktop width it is still the table", () => {
    mobile = false;
    render(<DataTable columns={columns} rows={DOCS.slice(0, 2)} getRowId={(r) => r.id} />);
    expect(document.querySelector("table")).toBeTruthy();
    expect(cardIds()).toEqual([]);
  });
});

describe("AC1 — checkbox and ⋮ in the card top; search, select-all and pages work over cards", () => {
  it("row checkbox and select-all with the indeterminate state", () => {
    const onSel = vi.fn();
    render(<DataTable columns={columns} rows={DOCS.slice(0, 3)} getRowId={(r) => r.id} selectable onSelectionChange={onSel} />);
    expect(tid("row-card-2").querySelector(".bdt-card-top [data-testid='data-table-select-2']")).toBeTruthy();
    fireEvent.click(tid("data-table-select-2"));
    expect(onSel).toHaveBeenLastCalledWith(["2"]);
    const all = tid("data-table-select-all") as HTMLInputElement;
    expect([all.checked, all.indeterminate]).toEqual([false, true]);
    fireEvent.click(all);
    expect([...onSel.mock.lastCall![0]].sort()).toEqual(["1", "2", "3"]);
    expect(tid("data-table-selected-label").textContent).toBe("3 af 3 rækker valgt");
  });
  it("the ⋮ menu sits in the card top and its action gets the row", () => {
    const del = vi.fn();
    render(<DataTable columns={columns} rows={DOCS.slice(0, 2)} getRowId={(r) => r.id} rowActions={[{ label: "Slet", onSelect: del, destructive: true }]} />);
    expect(tid("row-card-2").querySelector(".bdt-card-top [data-testid='data-table-actions-2']")).toBeTruthy();
    fireEvent.click(tid("data-table-actions-2"));
    fireEvent.click(tid("data-table-actions-2-0"));
    expect(del.mock.calls[0][0]).toEqual(DOCS[1]);
  });
  it("search filters the cards and pages page through them", () => {
    render(<DataTable columns={columns} rows={DOCS} getRowId={(r) => r.id} />);
    expect(cardIds().length).toBe(10);
    expect(tid("data-table-page-label").textContent).toBe("Side 1 af 2");
    fireEvent.click(tid("data-table-page-next"));
    expect(cardIds()).toEqual(["row-card-11", "row-card-12", "row-card-13"]);
    fireEvent.input(tid("data-table-search"), { target: { value: "dokument 0" } });
    expect(cardIds().length).toBe(9);
    expect(tid("data-table-page-label").textContent).toBe("Side 1 af 1");
  });
  it("an empty result says so", () => {
    render(<DataTable columns={columns} rows={DOCS} getRowId={(r) => r.id} />);
    fireEvent.input(tid("data-table-search"), { target: { value: "findes-ikke" } });
    expect(tid("data-table-empty").textContent).toBe("Ingen resultater.");
  });
});
