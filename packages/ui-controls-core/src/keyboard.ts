/**
 * A pure keyboard-navigation reducer for a listbox / custom-select. The adapter
 * owns the DOM + focus; this owns the state transitions so React and Preact
 * behave identically.
 */

export interface SelectState {
  open: boolean;
  /** Index of the highlighted option, or -1 when none. */
  highlighted: number;
}

export type SelectIntent =
  | { type: "none" }
  | { type: "open" }
  | { type: "close" }
  | { type: "select"; index: number };

export interface SelectReducerResult {
  state: SelectState;
  intent: SelectIntent;
}

/** The keys this reducer understands (pass `event.key`). Others = no-op. */
/**
 * F016.10 — opt-in behaviour for pickers that must never be "armed" by opening.
 * Without options the reducer behaves exactly as before.
 */
export interface SelectKeyOptions {
  /**
   * `false`: Enter/Space on a CLOSED picker opens it with NOTHING highlighted, so a
   * second Enter selects nothing — Enter only chooses after an arrow key. Default
   * (`true`/unset): opening highlights the current option or the first one.
   */
  armOnOpen?: boolean;
  /**
   * The index of the option that is currently SELECTED. When set, the first arrow
   * (on a closed picker, or on an open one with nothing highlighted) lands on it
   * instead of jumping to the first / last option. Ignored when out of range.
   */
  currentIndex?: number;
}

export function selectKeyReducer(
  state: SelectState,
  key: string,
  optionCount: number,
  opts?: SelectKeyOptions,
): SelectReducerResult {
  const clampOpen = (highlighted: number): SelectState => ({ open: true, highlighted });
  if (opts) {
    const hasCurrent =
      typeof opts.currentIndex === "number" && opts.currentIndex >= 0 && opts.currentIndex < optionCount;
    const nothingHighlighted = !state.open || state.highlighted < 0;
    if ((key === "ArrowDown" || key === "ArrowUp") && optionCount > 0 && nothingHighlighted && (hasCurrent || opts.armOnOpen === false)) {
      const to = hasCurrent ? opts.currentIndex! : key === "ArrowDown" ? 0 : optionCount - 1;
      return { state: clampOpen(to), intent: { type: state.open ? "none" : "open" } };
    }
    if ((key === "Enter" || key === " " || key === "Spacebar") && !state.open && opts.armOnOpen === false) {
      return { state: clampOpen(-1), intent: { type: "open" } };
    }
  }
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
