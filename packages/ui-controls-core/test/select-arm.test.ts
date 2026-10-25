// F016.10 — opt-in: opening arms nothing, the first arrow lands on the current value.
// helpdesk (#4562): an accidental open + Enter must not choose option 0, and one
// arrow press must not move two places away from what is already selected.
import { describe, expect, it } from "vitest";
import { selectKeyReducer, type SelectState } from "../src/index";

type S = SelectState;
type R = ReturnType<typeof selectKeyReducer>;

// 0.2.4's function, VERBATIM (copied from git before this change). The negative
// control below compares against it, so "the default did not move" is measured,
// not believed.
// prettier-ignore
function selectKeyReducer024(state: S, key: string, optionCount: number): R {
  const clampOpen = (highlighted: number): S => ({ open: true, highlighted });
  switch (key) {
    case "Escape":
      return { state: { open: false, highlighted: state.highlighted }, intent: { type: "close" } };
    case "ArrowDown": {
      if (optionCount === 0) return { state, intent: { type: "none" } };
      if (!state.open) return { state: clampOpen(0), intent: { type: "open" } };
      return { state: clampOpen((state.highlighted + 1) % optionCount), intent: { type: "none" } };
    }
    case "ArrowUp": {
      if (optionCount === 0) return { state, intent: { type: "none" } };
      if (!state.open) return { state: clampOpen(optionCount - 1), intent: { type: "open" } };
      return {
        state: clampOpen((state.highlighted - 1 + optionCount) % optionCount),
        intent: { type: "none" },
      };
    }
    case "Enter":
    case " ": // Space
    case "Spacebar": {
      if (!state.open) return { state: clampOpen(state.highlighted < 0 ? 0 : state.highlighted), intent: { type: "open" } };
      if (state.highlighted >= 0 && state.highlighted < optionCount) {
        return { state: { open: false, highlighted: state.highlighted }, intent: { type: "select", index: state.highlighted } };
      }
      return { state, intent: { type: "none" } };
    }
    default:
      return { state, intent: { type: "none" } };
  }
}

const closed: S = { open: false, highlighted: -1 };

describe("armOnOpen: false — opening arms nothing", () => {
  it.each(["Enter", " ", "Spacebar"])("%o on a closed picker opens with NOTHING highlighted", (key) => {
    expect(selectKeyReducer(closed, key, 5, { armOnOpen: false })).toEqual({
      state: { open: true, highlighted: -1 },
      intent: { type: "open" },
    });
  });

  it("a second Enter right after selects NOTHING; only after an arrow does Enter choose", () => {
    const opts = { armOnOpen: false };
    const a = selectKeyReducer(closed, "Enter", 5, opts);
    const b = selectKeyReducer(a.state, "Enter", 5, opts);
    expect(b.intent).toEqual({ type: "none" });
    const c = selectKeyReducer(b.state, "ArrowDown", 5, opts);
    expect(c.state).toEqual({ open: true, highlighted: 0 });
    expect(selectKeyReducer(c.state, "Enter", 5, opts).intent).toEqual({ type: "select", index: 0 });
  });

  it("ArrowUp from 'nothing highlighted' lands on the LAST option, not second-to-last", () => {
    expect(selectKeyReducer({ open: true, highlighted: -1 }, "ArrowUp", 5, { armOnOpen: false }).state).toEqual({
      open: true,
      highlighted: 4,
    });
  });
});

describe("currentIndex — the first arrow lands on what is already selected", () => {
  it.each([
    ["ArrowDown", 2],
    ["ArrowUp", 2],
  ])("%o on a CLOSED picker opens on currentIndex", (key, k) => {
    expect(selectKeyReducer(closed, key, 5, { currentIndex: k })).toEqual({
      state: { open: true, highlighted: k },
      intent: { type: "open" },
    });
  });

  it("after armOnOpen:false opened it, the first arrow lands on currentIndex; the next one moves from there", () => {
    const opts = { armOnOpen: false, currentIndex: 3 };
    const open = selectKeyReducer(closed, "Enter", 5, opts).state;
    const first = selectKeyReducer(open, "ArrowDown", 5, opts);
    expect(first).toEqual({ state: { open: true, highlighted: 3 }, intent: { type: "none" } });
    expect(selectKeyReducer(first.state, "ArrowDown", 5, opts).state.highlighted).toBe(4);
  });

  it.each([-1, 5, 99, Number.NaN])("currentIndex %o (out of range) is ignored", (k) => {
    expect(selectKeyReducer(closed, "ArrowDown", 5, { currentIndex: k }).state.highlighted).toBe(0);
    expect(selectKeyReducer(closed, "ArrowUp", 5, { currentIndex: k }).state.highlighted).toBe(4);
  });
});

describe("NEGATIVE CONTROL — without options the reducer is 0.2.4, exhaustively", () => {
  const keys = ["Escape", "ArrowDown", "ArrowUp", "Enter", " ", "Spacebar", "Tab", "a"];
  const counts = [0, 1, 5];
  const states = (n: number): S[] =>
    [false, true].flatMap((open) => [-1, 0, Math.floor(n / 2), Math.max(n - 1, 0)].map((highlighted) => ({ open, highlighted })));
  const cases = counts.flatMap((n) => states(n).flatMap((s) => keys.map((k) => [s, k, n] as const)));

  it(`${cases.length} combinations are identical to 0.2.4`, () => {
    for (const [s, k, n] of cases) {
      expect([s, k, n, selectKeyReducer(s, k, n)]).toEqual([s, k, n, selectKeyReducer024(s, k, n)]);
    }
  });

  it("an empty options object is also 0.2.4 for every combination (opts present but nothing set)", () => {
    for (const [s, k, n] of cases) {
      expect(selectKeyReducer(s, k, n, {})).toEqual(selectKeyReducer024(s, k, n));
    }
  });
});
