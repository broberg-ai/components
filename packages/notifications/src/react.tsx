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
    const h = makeOutsideClickHandler(
      () => [panelRef.current, triggerRef?.current ?? null],
      () => shell.close(),
    );
    h.attach();
    return () => h.detach();
  }, [state.open, shell, triggerRef]);

  useKeyboardLayer(panelRef, isTop, shell);

  if (!state.open) return null;
  return (
    <div
      ref={panelRef}
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

/** «Mark all read». Holds `clearedIds` for the visit; the shell owns that. */
export function BellMarkAll({ className }: { className?: string }) {
  const { shell } = useBell();
  return (
    <button type="button" data-testid="bell-mark-all" className={className}
      onClick={() => { void shell.markAllSeen(); }}>
      {shell.labels.markAll}
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

  if (!layer) return null;
  return (
    <div ref={ref} data-testid={`bell-layer-${id}`} className={className}
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
    const items = el.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
    );
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
