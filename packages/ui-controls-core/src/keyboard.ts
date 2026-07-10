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
export function selectKeyReducer(state: SelectState, key: string, optionCount: number): SelectReducerResult {
  const clampOpen = (highlighted: number): SelectState => ({ open: true, highlighted });
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
