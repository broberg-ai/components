// @vitest-environment happy-dom
/** @jsxImportSource preact */
// F094.7 — the table speaks the app's language: locale picks the built-in text set,
// labels still win, numbers follow locale unless numberLocale says otherwise.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/preact";
import { DataTable, DEFAULT_LABELS, LABELS_DA, LABELS_EN, type Column } from "../src/preact";

afterEach(cleanup);
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  get length() { return store.size; },
});

type Row = { id: string; title: string; amount: number };
const rows: Row[] = [{ id: "1", title: "A", amount: 1234.5 }];
const columns: Column<Row>[] = [
  { id: "title", header: "Title" },
  { id: "amount", header: "Amount", cell: "number" },
];
const view = (extra: Record<string, unknown> = {}) =>
  render(<DataTable columns={columns} rows={rows} getRowId={(r) => r.id} searchable {...extra} />);
const searchPlaceholder = () => (screen.getByTestId("data-table-search") as HTMLInputElement).placeholder;
const pageLabel = () => screen.getByTestId("data-table-page-label").textContent;
const amount = () => screen.getByTestId("data-table-cell-1-amount-td").textContent;

describe("F094.7 — locale", () => {
  it("without locale the table is Danish, exactly as before (an upgrade never changes a consumer's language)", () => {
    view();
    expect(searchPlaceholder()).toBe("Søg…");
    expect(pageLabel()).toBe("Side 1 af 1");
    expect(amount()).toBe("1.234,5");
  });

  it('locale="en" gives English texts and English numbers', () => {
    view({ locale: "en" });
    expect(searchPlaceholder()).toBe("Search…");
    expect(pageLabel()).toBe("Page 1 of 1");
    expect(amount()).toBe("1,234.5");
  });

  it("labels still win over the locale's set, field by field", () => {
    view({ locale: "en", labels: { search: "Find…" } });
    expect(searchPlaceholder()).toBe("Find…");
    expect(pageLabel()).toBe("Page 1 of 1");
  });

  it("numberLocale overrides the number format without changing the language", () => {
    view({ locale: "en", numberLocale: "da-DK" });
    expect(searchPlaceholder()).toBe("Search…");
    expect(amount()).toBe("1.234,5");
  });

  it("DEFAULT_LABELS is still exported and is the Danish set; every English label is filled", () => {
    expect(DEFAULT_LABELS).toBe(LABELS_DA);
    for (const [k, v] of Object.entries(LABELS_EN)) {
      const text = typeof v === "function" ? (v as (a: number, b: number) => string)(1, 2) : v;
      expect(text, k).toMatch(/\S/);
      expect(text, `${k} is still Danish`).not.toMatch(/[æøå]|Række|Side |Søg/);
    }
  });
});
