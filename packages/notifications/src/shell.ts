// @broberg/notifications/shell — F074.4.
//
// The bell and its panel, as a state machine with no DOM and no framework.
//
// WHY THIS EXISTS AT ALL. F074's non-goals said the list UI is not the shared
// part, and that was right about the ROW — three brands, three row shapes. It
// said nothing about the SHELL, and four apps each got the same things wrong
// there: two bells that counted separately, an outside-click that swallowed
// every click inside a portalled panel, no keyboard path at all, and a modal
// stacked on the panel that no single-dialog design can express.
//
// WHAT IT DELIBERATELY DOES NOT DO: touch the DOM. Focus, portals and key
// events are user-agent behaviour and belong in the thin /react and /preact
// wrappers. What lives here is the part that was getting decided twice.

import type { NotificationRow } from "./types.js";

/** Just enough of a DOMRect to anchor a dropdown, without importing the DOM. */
export interface AnchorRect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/**
 * What a row's own click handler decides — the shell never assumes.
 *
 * cardmem's alarm rows do NOT navigate: they open an alertdialog that requires
 * acknowledgement. And fd-sundhed, who have no alarms at all, argued the same
 * boundary independently: their rows lead to DIFFERENT places, and "navigate
 * and close" is wrong on a phone when the user came to read the list.
 */
export type RowOutcome = "navigate" | "stay" | "handoff";

/**
 * What Escape does — decided per layer, never by this file.
 *
 * A shell that hardcodes "Escape closes" lets someone dismiss an incident alarm
 * with one keypress and nothing recorded. That is not an accessibility detail;
 * it is whether the alarm means anything. cardmem's two buttons are `ack` and
 * `dismiss` — two outcomes, not one close.
 */
export type EscapeOutcome = "close" | "keep";

export interface Layer {
  /** Consumer's own id. The panel is always `"panel"`. */
  id: string;
  /**
   * A modal layer does NOT default to closing on Escape, and announces the
   * background inert. The panel is not modal; an alertdialog is.
   */
  modal: boolean;
  /**
   * Where focus goes when THIS layer closes. The wrapper hands back whatever it
   * can focus later — for the alarm modal that is the ROW that opened it, not
   * the bell. Opaque here on purpose: this file must not know what an element
   * is.
   */
  focusReturn: unknown;
  /** Anything the consumer needs when rendering the layer (the alarm's row). */
  payload?: unknown;
  /** Overrides the default Escape behaviour for this layer. */
  onEscape?: () => EscapeOutcome;
}

/**
 * Every string the shell owns. REQUIRED, with no defaults anywhere.
 *
 * Not a convenience — the absence of a default is the feature. cardmem's bell
 * had shipped Danish text for months in an app whose UI must be English, and
 * the giveaway was `Loading…` in English one line away: nobody chose Danish,
 * nobody chose anything. A default lets "no decision" look exactly like "a
 * decision", and every consumer inherits whichever language we happened to
 * write. Requiring it forces the choice into the open once, in one place.
 *
 * aria-labels are in here for the same reason the visible strings are: the
 * buttons get translated because someone can see them.
 */
export interface BellLabels {
  /** aria-label on the trigger. */
  bell: string;
  /** Accessible name of the panel. */
  panel: string;
  markAll: string;
  seeAll: string;
  /** Shown when there is nothing — the MOST COMMON state, not an edge. */
  empty: string;
  close: string;
}

export interface BellShellConfig {
  labels: BellLabels;
  /** Reads the one count. Always the core's `unseenCount`, never a local sum. */
  countUnseen: () => Promise<number>;
  /** Always the core's `markAllSeen`, which returns the ids it actually cleared. */
  markAllSeen: () => Promise<string[]>;
  /** Rows to render. The shell never fetches; it is handed what to show. */
  loadRows?: () => Promise<NotificationRow[]>;
}

export interface BellState {
  open: boolean;
  count: number;
  rows: readonly NotificationRow[];
  /** [] when closed. `layers[0]` is the panel; the last entry owns focus. */
  layers: readonly Layer[];
  /** Captured at the instant of opening — a dropdown anchors to it. */
  anchor: AnchorRect | null;
  /**
   * The ids that `markAllSeen()` actually cleared, HELD FOR THE VISIT.
   *
   * That set exists exactly once: the rows are seen afterwards, so a second
   * call returns nothing. Open the app, see three highlighted, tap one, go back
   * — and the other two vanish if the surface re-derives the highlight per
   * render. Cleared on close, never per render.
   */
  clearedIds: readonly string[];
}

export interface BellShell {
  /** The strings the consumer supplied. Exposed so a wrapper's components can
   *  reach them without every one of them taking a prop — and so there is no
   *  second place a label could come from. */
  readonly labels: BellLabels;
  getState(): BellState;
  subscribe(fn: (s: BellState) => void): () => void;

  /** Opens the panel, capturing the trigger's rect at that instant. */
  open(anchor?: AnchorRect | null, focusReturn?: unknown): Promise<void>;
  close(): void;
  toggle(anchor?: AnchorRect | null, focusReturn?: unknown): Promise<void>;

  /** Stacks a layer ON TOP without closing what is below it. */
  pushLayer(layer: Layer): void;
  /** Closes the top layer only; returns the focus target it declared. */
  popLayer(): unknown;

  /**
   * One Escape press acts on the INNERMOST layer. Returns what happened so a
   * wrapper knows whether to preventDefault.
   */
  escape(): EscapeOutcome;

  /** Recounts through the consumer's one counting function. */
  refresh(): Promise<void>;
  markAllSeen(): Promise<string[]>;
}

const PANEL: Layer = { id: "panel", modal: false, focusReturn: null };

export function createBellShell(config: BellShellConfig): BellShell {
  const { countUnseen, markAllSeen, loadRows, labels } = config;
  if (!labels) throw new Error("@broberg/notifications/shell: `labels` is required — the shell ships no default strings.");

  let state: BellState = { open: false, count: 0, rows: [], layers: [], anchor: null, clearedIds: [] };
  const subs = new Set<(s: BellState) => void>();

  const set = (patch: Partial<BellState>): void => {
    state = { ...state, ...patch };
    for (const fn of subs) fn(state);
  };

  const refresh = async (): Promise<void> => {
    set({ count: await countUnseen() });
  };

  return {
    labels,
    getState: () => state,
    subscribe(fn) {
      subs.add(fn);
      return () => { subs.delete(fn); };
    },

    async open(anchor = null, focusReturn = null) {
      // The anchor is captured HERE and nowhere else. A dropdown positions from
      // the trigger's rect at the moment of opening; a shell that owned
      // open/close without owning this would leave every consumer to re-measure
      // at a moment that has already passed.
      set({ open: true, anchor, layers: [{ ...PANEL, focusReturn }] });
      if (loadRows) set({ rows: await loadRows() });
      await refresh();
    },

    close() {
      // clearedIds dies with the visit, by design — see BellState.
      set({ open: false, layers: [], anchor: null, clearedIds: [] });
    },

    async toggle(anchor = null, focusReturn = null) {
      if (state.open) this.close();
      else await this.open(anchor, focusReturn);
    },

    pushLayer(layer) {
      // NOT a replacement. cardmem opens an alertdialog on top of the still-open
      // panel, so "one dialog at a time" is wrong for them on day one.
      set({ layers: [...state.layers, layer] });
    },

    popLayer() {
      const top = state.layers[state.layers.length - 1];
      if (!top || state.layers.length <= 1) return null;
      set({ layers: state.layers.slice(0, -1) });
      // Focus goes back to what THIS layer declared — for an alarm modal that
      // is the row that opened it, not the bell.
      return top.focusReturn ?? null;
    },

    escape() {
      const top = state.layers[state.layers.length - 1];
      if (!top) return "keep";
      // The layer decides. Only a NON-modal layer gets "close" for free.
      const outcome = top.onEscape ? top.onEscape() : top.modal ? "keep" : "close";
      if (outcome === "close") {
        if (state.layers.length > 1) this.popLayer();
        else this.close();
      }
      return outcome;
    },

    refresh,

    async markAllSeen() {
      const cleared = await markAllSeen();
      set({ clearedIds: cleared });
      await refresh();
      return cleared;
    },
  };
}
