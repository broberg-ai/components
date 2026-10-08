// @vitest-environment happy-dom
/** @jsxImportSource preact */
// F094.2 — drag handles. happy-dom lays nothing out, so every row's box is
// stubbed from its position among its siblings (40px each); that is the only
// geometry the drag reads. Orders are asserted with strict equality.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { moveRow } from "../src/index";
import { DataTable, DEFAULT_LABELS, type Column } from "../src/preact";

const store = new Map<string, string>();
vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), clear: () => store.clear(), get length() { return store.size; } });

const ROW = 40;
let mobile = false;
beforeEach(() => {
  mobile = false;
  store.clear();
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: mobile && q.includes("max-width: 767px"), media: q, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const i = this.parentElement ? [...this.parentElement.children].filter((c) => (c as HTMLElement).dataset.reorderId).indexOf(this) : 0;
    const top = Math.max(0, i) * ROW;
    return { top, bottom: top + ROW, height: ROW, left: 0, right: 300, width: 300, x: 0, y: top, toJSON() {} } as DOMRect;
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type Doc = { id: string; title: string };
const DOCS: Doc[] = [1, 2, 3, 4].map((n) => ({ id: String(n), title: `Dokument ${n}` }));
const columns: Column<Doc>[] = [{ id: "title", header: "Titel", sortable: true }];
const tid = (id: string) => screen.getByTestId(id);
const shownOrder = () => screen.queryAllByTestId(/^row-drag-/).map((el) => el.getAttribute("data-testid")!.slice("row-drag-".length));
const setup = (extra: Record<string, unknown> = {}) => {
  const onReorder = vi.fn();
  render(<DataTable columns={columns} rows={DOCS} getRowId={(d) => d.id} onReorder={onReorder} {...extra} />);
  return onReorder;
};

describe("moveRow — the pure core", () => {
  it("moves down, up, clamps, and never mutates", () => {
    const ids = ["a", "b", "c", "d"];
    expect(moveRow(ids, 0, 3)).toEqual(["b", "c", "d", "a"]);
    expect(moveRow(ids, 3, 1)).toEqual(["a", "d", "b", "c"]);
    expect(moveRow(ids, 1, 99)).toEqual(["a", "c", "d", "b"]);
    expect(moveRow(ids, 7, 0)).toEqual(["a", "b", "c", "d"]);
    expect(ids).toEqual(["a", "b", "c", "d"]);
  });
});

describe("AC0 — a handle per row, dragged with pointer events", () => {
  it("no onReorder, no handle", () => {
    render(<DataTable columns={columns} rows={DOCS} getRowId={(d) => d.id} />);
    expect(screen.queryAllByTestId(/^row-drag-/).length).toBe(0);
  });

  it("every row has a named handle", () => {
    setup();
    expect(shownOrder()).toEqual(["1", "2", "3", "4"]);
    expect(tid("row-drag-1").getAttribute("aria-label")).toBe(DEFAULT_LABELS.dragHandle);
  });

  it.each(["mouse", "touch"])("%s: drag row 1 below row 4 → onReorder gets the new order", (pointerType) => {
    const onReorder = setup();
    const h = tid("row-drag-1");
    fireEvent.pointerDown(h, { pointerId: 1, pointerType, clientY: 20, button: 0 });
    fireEvent.pointerMove(h, { pointerId: 1, pointerType, clientY: 150 });
    expect(shownOrder()).toEqual(["2", "3", "4", "1"]); // the preview follows the pointer
    fireEvent.pointerUp(h, { pointerId: 1, pointerType, clientY: 150 });
    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onReorder.mock.calls[0][0]).toEqual(["2", "3", "4", "1"]);
  });

  it("the drop arrives even when the handle has lost the pointer (events land on the page, not the handle)", () => {
    // In Chromium the preview re-inserts row nodes and the handle loses pointer
    // capture; move and up then go to whatever is under the pointer.
    const onReorder = setup();
    fireEvent.pointerDown(tid("row-drag-1"), { pointerId: 1, clientY: 20, button: 0 });
    fireEvent.pointerMove(document.body, { pointerId: 1, clientY: 150 });
    fireEvent.pointerUp(document.body, { pointerId: 1, clientY: 150 });
    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onReorder.mock.calls[0][0]).toEqual(["2", "3", "4", "1"]);
  });

  it("drag row 4 between rows 1 and 2", () => {
    const onReorder = setup();
    const h = tid("row-drag-4");
    fireEvent.pointerDown(h, { pointerId: 1, clientY: 140, button: 0 });
    fireEvent.pointerMove(h, { pointerId: 1, clientY: 45 });
    fireEvent.pointerUp(h, { pointerId: 1, clientY: 45 });
    expect(onReorder.mock.calls[0][0]).toEqual(["1", "4", "2", "3"]);
  });

  it("dropping where it started, or a cancelled pointer, calls nothing", () => {
    const onReorder = setup();
    const h = tid("row-drag-2");
    fireEvent.pointerDown(h, { pointerId: 1, clientY: 60, button: 0 });
    fireEvent.pointerUp(h, { pointerId: 1, clientY: 60 });
    fireEvent.pointerDown(h, { pointerId: 1, clientY: 60, button: 0 });
    fireEvent.pointerMove(h, { pointerId: 1, clientY: 150 });
    fireEvent.pointerCancel(h, { pointerId: 1 });
    expect(onReorder).not.toHaveBeenCalled();
    expect(shownOrder()).toEqual(["1", "2", "3", "4"]);
  });

  it("on page 2 the move lands at the right place in ALL rows", () => {
    const onReorder = setup({ initialPageSize: 2, pageSizes: [2] });
    fireEvent.click(tid("data-table-page-next"));
    expect(shownOrder()).toEqual(["3", "4"]);
    const h = tid("row-drag-3");
    fireEvent.pointerDown(h, { pointerId: 1, clientY: 20, button: 0 });
    fireEvent.pointerMove(h, { pointerId: 1, clientY: 70 });
    fireEvent.pointerUp(h, { pointerId: 1, clientY: 70 });
    expect(onReorder.mock.calls[0][0]).toEqual(["1", "2", "4", "3"]);
  });

  it("on a phone the handle sits in the card top and drags the same way", () => {
    mobile = true;
    const onReorder = setup();
    const card = tid("row-card-1");
    expect(card.querySelector(".bdt-card-top [data-testid='row-drag-1']")).not.toBe(null);
    const h = tid("row-drag-1");
    fireEvent.pointerDown(h, { pointerId: 1, pointerType: "touch", clientY: 20, button: 0 });
    fireEvent.pointerMove(h, { pointerId: 1, pointerType: "touch", clientY: 110 });
    fireEvent.pointerUp(h, { pointerId: 1, pointerType: "touch", clientY: 110 });
    expect(onReorder.mock.calls[0][0]).toEqual(["2", "3", "1", "4"]);
  });
});

describe("AC1 — keyboard, with a live region", () => {
  it("space lifts, arrows move, space drops", () => {
    const onReorder = setup();
    const h = tid("row-drag-1");
    fireEvent.keyDown(h, { key: " " });
    expect(tid("data-table-live").textContent).toBe(DEFAULT_LABELS.dragLifted(1, 4));
    expect(h.getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(tid("row-drag-1"), { key: "ArrowDown" });
    fireEvent.keyDown(tid("row-drag-1"), { key: "ArrowDown" });
    expect(tid("data-table-live").textContent).toBe(DEFAULT_LABELS.dragMoved(3, 4));
    expect(shownOrder()).toEqual(["2", "3", "1", "4"]);
    fireEvent.keyDown(tid("row-drag-1"), { key: " " });
    expect(onReorder.mock.calls[0][0]).toEqual(["2", "3", "1", "4"]);
    expect(tid("data-table-live").textContent).toBe(DEFAULT_LABELS.dragDropped(3, 4));
  });

  it("two arrows inside one frame both count (no re-render in between)", async () => {
    const onReorder = setup();
    fireEvent.keyDown(tid("row-drag-1"), { key: " " });
    const h = tid("row-drag-1");
    // Raw dispatch, outside act(): Preact has not re-rendered between the two.
    h.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    h.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await act(async () => {});
    fireEvent.keyDown(tid("row-drag-1"), { key: " " });
    expect(onReorder.mock.calls[0][0]).toEqual(["2", "3", "1", "4"]);
  });

  it("Enter works as space, and ArrowUp stops at the top", () => {
    const onReorder = setup();
    fireEvent.keyDown(tid("row-drag-3"), { key: "Enter" });
    fireEvent.keyDown(tid("row-drag-3"), { key: "ArrowUp" });
    fireEvent.keyDown(tid("row-drag-3"), { key: "ArrowUp" });
    fireEvent.keyDown(tid("row-drag-3"), { key: "ArrowUp" });
    fireEvent.keyDown(tid("row-drag-3"), { key: "Enter" });
    expect(onReorder.mock.calls[0][0]).toEqual(["3", "1", "2", "4"]);
  });

  it("Escape puts it back and calls nothing", () => {
    const onReorder = setup();
    fireEvent.keyDown(tid("row-drag-2"), { key: " " });
    fireEvent.keyDown(tid("row-drag-2"), { key: "ArrowDown" });
    fireEvent.keyDown(tid("row-drag-2"), { key: "Escape" });
    expect(onReorder).not.toHaveBeenCalled();
    expect(shownOrder()).toEqual(["1", "2", "3", "4"]);
    expect(tid("data-table-live").textContent).toBe(DEFAULT_LABELS.dragCancelled);
  });
});

describe("AC2 — off while sorted or filtered, and the handle says why", () => {
  const assertOff = (onReorder: ReturnType<typeof vi.fn>, id: string) => {
    const h = tid(`row-drag-${id}`);
    expect(h.getAttribute("aria-disabled")).toBe("true");
    expect(h.getAttribute("aria-label")).toBe(DEFAULT_LABELS.dragDisabled);
    expect(h.getAttribute("title")).toBe(DEFAULT_LABELS.dragDisabled);
    fireEvent.pointerDown(h, { pointerId: 1, clientY: 0, button: 0 });
    fireEvent.pointerMove(h, { pointerId: 1, clientY: 150 });
    fireEvent.pointerUp(h, { pointerId: 1, clientY: 150 });
    fireEvent.keyDown(h, { key: " " });
    fireEvent.keyDown(h, { key: "ArrowDown" });
    fireEvent.keyDown(h, { key: " " });
    expect(onReorder).not.toHaveBeenCalled();
  };

  it("sorted", () => {
    const onReorder = setup();
    fireEvent.click(tid("data-table-sort-title"));
    assertOff(onReorder, "1");
  });

  it("filtered", () => {
    const onReorder = setup();
    fireEvent.input(tid("data-table-search"), { target: { value: "Dokument" } });
    assertOff(onReorder, "1");
  });

  it("back on when the sort is cleared", () => {
    setup();
    fireEvent.click(tid("data-table-sort-title"));
    fireEvent.click(tid("data-table-sort-title"));
    fireEvent.click(tid("data-table-sort-title"));
    expect(tid("row-drag-1").getAttribute("aria-disabled")).toBe(null);
  });
});

describe("AC3 — no drag-and-drop library", () => {
  it("package.json depends on nothing that drags", () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8"));
    const names = Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies, ...pkg.devDependencies, ...pkg.optionalDependencies });
    expect(names.filter((n) => /dnd|drag|sortable|draggable/i.test(n))).toEqual([]);
  });
});
