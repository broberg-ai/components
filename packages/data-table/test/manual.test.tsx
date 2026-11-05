// @vitest-environment happy-dom
/** @jsxImportSource preact */
// F094.8 — server-driven mode: the table shows `rows` as one page and reports every
// change; the app fetches. BID F084.222: «tænk sig hvis der pludselig var 20.000 brugere».
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, act } from "@testing-library/preact";
import { DataTable, type Column } from "../src/preact";

afterEach(() => { cleanup(); vi.useRealTimers(); });
vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, length: 0 });

type User = { id: string; name: string; email: string };
const columns: Column<User>[] = [
  { id: "name", header: "Navn", sortable: true },
  { id: "email", header: "E-mail", sortable: true },
];
// Page 3 (0-based 2) of 20 000 users, 10 per page — deliberately NOT in name order.
const page3: User[] = Array.from({ length: 10 }, (_, i) => ({ id: `u${30 - i}`, name: `Zed ${30 - i}`, email: `z${30 - i}@x.dk` }));
const names = () => [...document.querySelectorAll("[data-testid$='-name-td']")].map((el) => el.textContent);

function view(extra: Record<string, unknown> = {}) {
  const calls = { sort: [] as unknown[], page: [] as number[], size: [] as number[], search: [] as string[] };
  const r = render(
    <DataTable columns={columns} rows={page3} getRowId={(u) => u.id} searchable manual total={20_000} page={2} pageSize={10} pageSizes={[10, 50]}
      onSortChange={(s) => calls.sort.push(s)} onPageChange={(p) => calls.page.push(p)} onPageSizeChange={(n) => calls.size.push(n)}
      onSearchChange={(q) => calls.search.push(q)} {...extra} />,
  );
  return { ...r, calls };
}

describe("F094.8 — manual mode shows the page it is given", () => {
  it("rows are shown exactly as given — no client sorting, filtering or slicing", () => {
    view({ sort: { columnId: "name", dir: "asc" } });
    expect(names()).toEqual(page3.map((u) => u.name));
  });
  it("«Side x af y» comes from total and pageSize, page is 0-based", () => {
    view();
    expect(screen.getByTestId("data-table-page-label").textContent).toBe("Side 3 af 2000");
  });
  it("aria-sort reflects the controlled sort", () => {
    view({ sort: { columnId: "email", dir: "desc" } });
    expect(screen.getByTestId("data-table-header-email").getAttribute("aria-sort")).toBe("descending");
    expect(screen.getByTestId("data-table-header-name").getAttribute("aria-sort")).toBe("none");
  });
});

describe("F094.8 — every change is reported to the app", () => {
  it("clicking a sortable header reports the next sort and goes back to page 0", () => {
    const { calls } = view();
    fireEvent.click(screen.getByTestId("data-table-sort-name"));
    expect(calls.sort).toEqual([{ columnId: "name", dir: "asc" }]);
    expect(calls.page).toEqual([0]);
  });
  it("pager buttons report the target page (first/prev/next/last)", () => {
    const { calls } = view();
    for (const k of ["first", "prev", "next", "last"]) fireEvent.click(screen.getByTestId(`data-table-page-${k}`));
    expect(calls.page).toEqual([0, 1, 3, 1999]);
  });
  it("search is reported once typing pauses (debounced), and the page resets", async () => {
    vi.useFakeTimers();
    const { calls } = view({ searchDebounceMs: 300 });
    const input = screen.getByTestId("data-table-search") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "an" } });
    fireEvent.input(input, { target: { value: "ann" } });
    expect(calls.search).toEqual([]);
    await act(() => { vi.advanceTimersByTime(299); });
    expect(calls.search).toEqual([]);
    await act(() => { vi.advanceTimersByTime(1); });
    expect(calls.search).toEqual(["ann"]);
    expect(calls.page).toEqual([0]);
    expect(input.value).toBe("ann");
  });
  it("choosing rows per page reports the size and goes back to page 0", () => {
    const { calls } = view();
    fireEvent.click(screen.getByTestId("data-table-page-size"));
    fireEvent.click(screen.getByTestId("data-table-page-size-50"));
    expect(calls.size).toEqual([50]);
    expect(calls.page).toEqual([0]);
  });
  it("loading covers the rows with a spinner and keeps them visible", () => {
    view({ loading: true });
    expect(screen.getByTestId("data-table-loading").getAttribute("role")).toBe("status");
    expect(document.querySelector(".bdt-table")!.getAttribute("aria-busy")).toBe("true");
    expect(names()).toHaveLength(10);
  });
  it("drag-to-reorder is off in manual mode (the server owns the order)", () => {
    view({ onReorder: () => {} });
    const h = document.querySelector("[data-testid^='row-drag-']");
    expect(h?.getAttribute("aria-disabled")).toBe("true");
  });
});
