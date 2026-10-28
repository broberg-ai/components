// @broberg/notifications/react — F074.4.
//
// A thin wrapper. Everything worth arguing about is in ./shell; what lives here
// is the part that genuinely needs a DOM: focus, keys, and the portal.
//
// It is thin ON PURPOSE, and that was cardmem's argument rather than mine:
// "everything valuable in the shell (portal, outside-click, focus trap, Escape)
// is exactly the framework-entangled part — and exactly the part that carried
// our bug." Two parallel implementations of THAT is the thing this package
// exists to end, so the state machine is shared and only the wiring is per
// framework.

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode, type RefObject,
} from "react";
import { makeOutsideClickHandler } from "@broberg/ui-controls-core";
import { createBellShell, type AnchorRect, type BellShell, type BellShellConfig, type BellState } from "./shell.js";

const Ctx = createContext<{ shell: BellShell; state: BellState } | null>(null);

function useBell() {
  const v = useContext(Ctx);
  if (!v) throw new Error("@broberg/notifications/react: useBell must be used inside <BellProvider>");
  return v;
}

/**
 * The shell and its current state, for code INSIDE the provider — chiefly a row
 * that opens a stacked layer (an alarm) with `shell.pushLayer(...)`, or a full
 * page that reads `state.rows`. Without it the only handle on the shell is the
 * provider's own, and a row could not stack anything.
 */
export function useBellShell(): { shell: BellShell; state: BellState } {
  return useBell();
}

/**
 * ONE provider owns the count, the list and the panel.
 *
 * This is the shape that makes xrt81's production bug unrepresentable rather
 * than merely discouraged: they rendered the bell in a mobile topbar AND a
 * desktop bar with the count INSIDE the component, so «mark all read» zeroed
 * one of them and the other sat at 2 with every row read. Here a <Bell> holds
 * no state at all — mount as many as you like.
 */
export function BellProvider({ config, children }: { config: BellShellConfig; children: ReactNode }) {
  const shell = useMemo(() => createBellShell(config), [config]);
  const [state, setState] = useState(shell.getState());
  useEffect(() => shell.subscribe(setState), [shell]);
  useEffect(() => { void shell.refresh(); }, [shell]);
  return <Ctx.Provider value={{ shell, state }}>{children}</Ctx.Provider>;
}

/** The trigger. Pure — it reads the shared count and owns nothing. */
export function Bell({ className, render }: {
  className?: string;
  render?: (count: number) => ReactNode;
}) {
  const { shell, state } = useBell();
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button
      ref={ref}
      type="button"
      data-testid="bell-trigger"
      className={className}
      aria-label={shell.labels.bell}
      aria-expanded={state.open}
      // Nothing pointed at the panel before: no aria-haspopup, no aria-controls.
      aria-haspopup="dialog"
      aria-controls={state.open ? PANEL_ID : undefined}
      onClick={() => {
        const r = ref.current?.getBoundingClientRect();
        // The rect is measured HERE, at the instant of opening, because that is
        // when a dropdown anchors. A shell that owned open/close without owning
        // this would leave every consumer re-measuring a moment already gone.
        const anchor: AnchorRect | null = r
          ? { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
          : null;
        void shell.toggle(anchor, ref.current);
      }}
    >
      {render ? render(state.count) : <span data-testid="bell-count">{state.count}</span>}
    </button>
  );
}

const PANEL_ID = "broberg-bell-panel";
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * The panel. Renders where you put it — portal it yourself if your topbar has a
 * `backdrop-filter`, which is what forced one consumer to.
 *
 * Outside-click goes through @broberg/ui-controls-core, which takes an ARRAY of
 * elements and is therefore correct for a PORTALLED panel. Guarding on a single
 * root ref is the defect: portalled, the panel is outside that root, so every
 * click INSIDE it reads as "outside" and closes before the row's handler runs.
 */
export function BellPanel({ children, className, triggerRef }: {
  children: ReactNode;
  className?: string;
  triggerRef?: RefObject<HTMLElement | null>;
}) {
  const { shell, state } = useBell();
  const panelRef = useRef<HTMLDivElement>(null);
  const L = shell.labels;
  const top = state.layers[state.layers.length - 1];
  const isTop = top?.id === "panel";

  useEffect(() => {
    if (!state.open) return;
    // A STACKED layer (an alarm opened from a row) is rendered outside the
    // panel, so a click in it is "outside" the panel — and closed the whole
    // stack in a real browser (Lens, 28/10; happy-dom never fires the
    // pointerdown that triggers it). Layers count as inside, and while a layer
    // sits on top, an outside click is the layer's business, not the panel's.
    const h = makeOutsideClickHandler(
      () => [
        panelRef.current,
        triggerRef?.current ?? null,
        ...Array.from(panelRef.current?.ownerDocument.querySelectorAll<HTMLElement>("[data-bell-layer]") ?? []),
      ],
      () => { if (shell.getState().layers.length <= 1) shell.close(); },
    );
    h.attach();
    return () => h.detach();
  }, [state.open, shell, triggerRef]);

  useKeyboardLayer(panelRef, isTop, shell);

  // Focus INTO the panel on open (the first focusable, or the panel itself when
  // it is empty — the most common screen), and back to the trigger on close.
  const panelReturn = state.layers[0]?.focusReturn;
  useEffect(() => {
    if (!state.open) return;
    const el = panelRef.current;
    (el?.querySelector<HTMLElement>(FOCUSABLE) ?? el)?.focus?.();
    return () => {
      if (panelReturn && typeof (panelReturn as HTMLElement).focus === "function") (panelReturn as HTMLElement).focus();
    };
  }, [state.open, panelReturn]);

  if (!state.open) return null;
  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      id={PANEL_ID}
      data-testid="bell-panel"
      className={className}
      role="dialog"
      aria-label={L.panel}
      // The background was never announced inert before.
      aria-modal={false}
    >
      {state.rows.length === 0
        // The MOST COMMON state, not an edge — measured by a consumer as the
        // most frequent screen in their system.
        ? <p data-testid="bell-empty">{L.empty}</p>
        : children}
    </div>
  );
}

/**
 * «Mark all read». Holds `clearedIds` for the visit; the shell owns that.
 *
 * ENABLED BY WHAT IS VISIBLE, NEVER BY THE COUNT. A consumer's count may
 * exclude rows its list shows (muted categories — that is why the core does not
 * own the count), so `disabled={count === 0}` locks a user out of clearing rows
 * they can see. Measured live at xrt81: bell 1, panel highlighting 4, one click
 * from a dead button. Disabled only when there is nothing on screen to clear.
 */
export function BellMarkAll({ className }: { className?: string }) {
  const { shell, state } = useBell();
  return (
    <button type="button" data-testid="bell-mark-all" className={className}
      disabled={state.rows.length === 0}
      onClick={() => { void shell.markAllSeen(); }}>
      {shell.labels.markAll}
    </button>
  );
}

/** What a row decided when it was activated. */
export type RowOutcome = "navigate" | "stay";

/**
 * One row's activation, with the OUTCOME decided by the consumer.
 *
 * The shell never assumes "click row → navigate and close": an alarm row must
 * open an acknowledge dialog instead, and an alarm that silently navigates is
 * worse than one that does nothing. `"navigate"` closes the panel; `"stay"`
 * leaves it open (push your modal layer from `onActivate` with useBellShell).
 * A prop, not core: one of four consumers needs it.
 *
 * `data-cleared` marks the rows the last «mark all read» cleared — held for the
 * visit by the shell, so it survives a re-render and a fresh server read.
 */
export function BellRow({ id, onActivate, children, className }: {
  id: string;
  onActivate: () => RowOutcome | Promise<RowOutcome>;
  children: ReactNode;
  className?: string;
}) {
  const { shell, state } = useBell();
  const cleared = state.clearedIds.includes(id);
  return (
    <button type="button" data-testid={`bell-row-${id}`} data-cleared={cleared ? "true" : undefined}
      className={className}
      onClick={async () => { if ((await onActivate()) === "navigate") shell.close(); }}>
      {children}
    </button>
  );
}

/**
 * A stacked layer — an alarm modal ON TOP of the still-open panel.
 *
 * Not a replacement for the panel: one consumer opens exactly this, and a
 * shell assuming one dialog at a time would have been wrong for them on day
 * one. Escape here does whatever the layer decided, which for a modal is
 * nothing by default.
 */
export function BellLayer({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  const { shell, state } = useBell();
  const ref = useRef<HTMLDivElement>(null);
  const layer = state.layers.find((l) => l.id === id);
  const isTop = state.layers[state.layers.length - 1]?.id === id;

  useKeyboardLayer(ref, isTop, shell);

  // Focus INTO the layer when it opens, and BACK to what it declared when it
  // closes — for an alarm opened from a row, that is the ROW, not the bell.
  // The shell computes the target; only a DOM wrapper can move focus there.
  const focusReturn = layer?.focusReturn;
  useEffect(() => {
    if (!layer) return;
    const first = ref.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? ref.current)?.focus?.();
    return () => {
      if (focusReturn && typeof (focusReturn as HTMLElement).focus === "function") (focusReturn as HTMLElement).focus();
    };
  }, [layer !== undefined, focusReturn]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!layer) return null;
  return (
    <div ref={ref} data-testid={`bell-layer-${id}`} data-bell-layer="" tabIndex={-1} className={className}
      role={layer.modal ? "alertdialog" : "dialog"} aria-modal={layer.modal}>
      {children}
    </div>
  );
}

/**
 * Escape and the focus trap, for whichever layer is on top.
 *
 * ONLY the top layer listens, so two stacked dialogs do not fight over the same
 * keypress — the bug a naive per-panel trap produces the moment a consumer
 * stacks anything.
 *
 * NOT UNIT-TESTABLE: focus and Tab order are user-agent behaviour, and
 * happy-dom reports green on a trap that catches nothing. This is verified in a
 * real engine via Lens, with a focusable element rendered BEHIND the layer as a
 * negative control — without it the trap passes by accident on exactly the kind
 * of minimal fixture you write to test it.
 */
function useKeyboardLayer(ref: RefObject<HTMLElement | null>, isTop: boolean, shell: BellShell) {
  const onKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isTop) return;
    if (e.key === "Escape") {
      if (shell.escape() === "close") e.preventDefault();
      return;
    }
    if (e.key !== "Tab") return;
    const el = ref.current;
    if (!el) return;
    const items = el.querySelectorAll<HTMLElement>(FOCUSABLE);
    // An EMPTY panel has none of these, and that is the most ordinary screen
    // there is. Swallow the key rather than indexing into nothing.
    if (items.length === 0) { e.preventDefault(); return; }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = el.ownerDocument.activeElement;
    if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  }, [isTop, ref, shell]);

  useEffect(() => {
    if (!isTop) return;
    const doc = ref.current?.ownerDocument ?? (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    doc.addEventListener("keydown", onKeyDown, true);
    return () => doc.removeEventListener("keydown", onKeyDown, true);
  }, [isTop, onKeyDown, ref]);
}
