import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ymd,
  parseYmd,
  isInRange,
  monthLabel,
  buildMonthGrid,
  normalizeYmd,
  selectKeyReducer,
  isOutsideAll,
  makeOutsideClickHandler,
  ToastQueue,
  type SelectState,
} from "../src/index.js";

describe("calendar", () => {
  it("ymd ↔ parseYmd round-trip (local, no tz shift)", () => {
    const d = new Date(2026, 6, 4); // 4 Jul 2026
    expect(ymd(d)).toBe("2026-07-04");
    const p = parseYmd("2026-07-04")!;
    expect([p.getFullYear(), p.getMonth(), p.getDate()]).toEqual([2026, 6, 4]);
  });

  it("parseYmd rejects overflow + malformed", () => {
    expect(parseYmd("2026-02-31")).toBeNull();
    expect(parseYmd("nope")).toBeNull();
    expect(parseYmd("2026-13-01")).toBeNull();
  });

  it("buildMonthGrid is Monday-first with 42 padded cells", () => {
    // July 2026 starts on a Wednesday.
    const grid = buildMonthGrid(2026, 7);
    expect(grid).toHaveLength(42);
    // First cell is the Monday of that week (29 Jun 2026), a padding day.
    expect(grid[0]).toMatchObject({ date: "2026-06-29", inMonth: false });
    // 1 Jul is at index 2 (Mon, Tue padding, then Wed).
    expect(grid[2]).toMatchObject({ date: "2026-07-01", day: 1, inMonth: true });
    expect(grid.filter((c) => c.inMonth)).toHaveLength(31);
  });

  it("isInRange is inclusive", () => {
    expect(isInRange("2026-07-04", "2026-07-01", "2026-07-31")).toBe(true);
    expect(isInRange("2026-08-01", "2026-07-01", "2026-07-31")).toBe(false);
    expect(isInRange("2026-07-04")).toBe(true); // no bounds
  });

  it("monthLabel delegates to the locale (no hardcoded names)", () => {
    expect(monthLabel(2026, 7, "en").toLowerCase()).toContain("july");
    expect(monthLabel(2026, 7, "da-DK").toLowerCase()).toContain("juli");
  });
});

describe("normalizeYmd — 4-digit-year disambiguation", () => {
  it("accepts YYYY-MM-DD", () => {
    expect(normalizeYmd("2025-04-03")).toBe("2025-04-03");
  });
  it("accepts DD-MM-YYYY (year at the end)", () => {
    expect(normalizeYmd("03-04-2025")).toBe("2025-04-03"); // 3 April, never April-03
  });
  it("accepts D.M.YYYY with dots + single digits", () => {
    expect(normalizeYmd("3.4.2025")).toBe("2025-04-03");
  });
  it("accepts slashes", () => {
    expect(normalizeYmd("03/04/2025")).toBe("2025-04-03");
  });
  it("rejects ambiguous / invalid", () => {
    expect(normalizeYmd("03-04-25")).toBeNull(); // no 4-digit year
    expect(normalizeYmd("2025-13-01")).toBeNull();
    expect(normalizeYmd("garbage")).toBeNull();
  });
});

describe("selectKeyReducer", () => {
  const closed: SelectState = { open: false, highlighted: -1 };
  it("ArrowDown opens (highlight 0) then advances with wrap", () => {
    let r = selectKeyReducer(closed, "ArrowDown", 3);
    expect(r.state).toEqual({ open: true, highlighted: 0 });
    expect(r.intent.type).toBe("open");
    r = selectKeyReducer(r.state, "ArrowDown", 3);
    expect(r.state.highlighted).toBe(1);
    r = selectKeyReducer({ open: true, highlighted: 2 }, "ArrowDown", 3);
    expect(r.state.highlighted).toBe(0); // wrap
  });

  it("ArrowUp opens to last then decrements with wrap", () => {
    let r = selectKeyReducer(closed, "ArrowUp", 3);
    expect(r.state).toEqual({ open: true, highlighted: 2 });
    r = selectKeyReducer({ open: true, highlighted: 0 }, "ArrowUp", 3);
    expect(r.state.highlighted).toBe(2); // wrap
  });

  it("Escape closes", () => {
    const r = selectKeyReducer({ open: true, highlighted: 1 }, "Escape", 3);
    expect(r.state.open).toBe(false);
    expect(r.intent.type).toBe("close");
  });

  it("Enter opens when closed, selects when open", () => {
    expect(selectKeyReducer(closed, "Enter", 3).intent.type).toBe("open");
    const r = selectKeyReducer({ open: true, highlighted: 2 }, "Enter", 3);
    expect(r.intent).toEqual({ type: "select", index: 2 });
    expect(r.state.open).toBe(false);
  });

  it("Space behaves like Enter; unknown keys no-op", () => {
    expect(selectKeyReducer({ open: true, highlighted: 0 }, " ", 3).intent).toEqual({ type: "select", index: 0 });
    expect(selectKeyReducer(closed, "a", 3).intent.type).toBe("none");
  });
});

describe("outside-click", () => {
  it("isOutsideAll respects containment", () => {
    const outer = document.createElement("div");
    const inner = document.createElement("span");
    outer.appendChild(inner);
    document.body.appendChild(outer);
    expect(isOutsideAll(inner, [outer])).toBe(false);
    expect(isOutsideAll(document.body, [outer])).toBe(true);
  });

  it("attach fires onClose for an outside pointerdown, not an inside one", () => {
    const menu = document.createElement("div");
    document.body.appendChild(menu);
    const onClose = vi.fn();
    const h = makeOutsideClickHandler(() => [menu], onClose);
    h.attach();
    menu.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    h.detach();
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1); // no more after detach
  });
});

describe("ToastQueue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("push returns an id and auto-dismisses after the duration", () => {
    const q = new ToastQueue({ defaultDuration: 1000 });
    const seen: number[] = [];
    q.subscribe((items) => seen.push(items.length));
    const id = q.push({ message: "hi" });
    expect(id).toMatch(/^t\d+$/);
    expect(q.get()).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(q.get()).toHaveLength(0);
    expect(seen).toEqual([1, 0]);
  });

  it("a sticky toast (duration 0) does not auto-dismiss", () => {
    const q = new ToastQueue();
    q.push({ message: "stay", duration: 0 });
    vi.advanceTimersByTime(60_000);
    expect(q.get()).toHaveLength(1);
  });

  it("caps at maxVisible, dropping the oldest", () => {
    const q = new ToastQueue({ maxVisible: 2, defaultDuration: 0 });
    q.push({ message: "a" });
    q.push({ message: "b" });
    q.push({ message: "c" });
    expect(q.get().map((t) => t.message)).toEqual(["b", "c"]);
  });

  it("manual dismiss + clear", () => {
    const q = new ToastQueue({ defaultDuration: 0 });
    const id = q.push({ message: "x" });
    q.push({ message: "y" });
    q.dismiss(id);
    expect(q.get().map((t) => t.message)).toEqual(["y"]);
    q.clear();
    expect(q.get()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// F016.7 — a scroll from INSIDE a registered element is not the outside world.
//
// The capture-phase scroll listener saw every descendant's scroll and closed
// unconditionally, so a popover with a scrollable list closed itself the moment
// the user scrolled it. Found by running the reuse check for the shared
// notification bell (F074.4) rather than by a report — a select that closes
// while you scroll reads as a slip of the finger, not as a bug worth filing.
// ---------------------------------------------------------------------------

describe("makeOutsideClickHandler — where the scroll came from", () => {
  const mount = () => {
    const panel = document.createElement("div");
    const list = document.createElement("div");
    panel.appendChild(list);
    const elsewhere = document.createElement("div");
    document.body.append(panel, elsewhere);
    const onClose = vi.fn();
    const h = makeOutsideClickHandler(() => [panel], onClose);
    h.attach();
    return { panel, list, elsewhere, onClose, done: () => { h.detach(); panel.remove(); elsewhere.remove(); } };
  };

  it("a scroll inside the panel does NOT close it", () => {
    const { list, onClose, done } = mount();
    list.dispatchEvent(new Event("scroll"));
    expect(onClose).not.toHaveBeenCalled();
    done();
  });

  it("a scroll on the panel ITSELF does not close it either", () => {
    // contains() is true for the node itself. Asserting only the child case
    // would leave the boundary untested.
    const { panel, onClose, done } = mount();
    panel.dispatchEvent(new Event("scroll"));
    expect(onClose).not.toHaveBeenCalled();
    done();
  });

  it("a scroll OUTSIDE still closes — the reason capture-phase exists", () => {
    // A fixed-position portal floats away from its trigger when the page
    // scrolls beneath it. Narrowing the listener to bubble-phase would trade
    // this bug for the one the code was written to prevent.
    const { elsewhere, onClose, done } = mount();
    elsewhere.dispatchEvent(new Event("scroll"));
    expect(onClose).toHaveBeenCalledTimes(1);
    done();
  });

  it("a window resize still closes unconditionally", () => {
    // A resize has no target inside anything, so it never asks — asserted so
    // the fix cannot quietly narrow it.
    const { onClose, done } = mount();
    window.dispatchEvent(new Event("resize"));
    expect(onClose).toHaveBeenCalledTimes(1);
    done();
  });
});
