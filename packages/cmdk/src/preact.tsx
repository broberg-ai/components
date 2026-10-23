/**
 * @broberg/cmdk/preact — the Stack B shell over the headless controller (F018.4).
 *
 * Three apps drew their own palette around the same controller (mailworker,
 * upmetrics, and now beacon). This is the one drawing: a modal with a search
 * input and grouped, keyboard-navigable results. It owns no items and no router:
 * `item.action()` runs first, an `href` goes to `onNavigate` (preact-iso's
 * `route`, pushState, …) and only falls back to `location.assign`.
 *
 * Styling is classes + @broberg/theme tokens (css/cmdk.css); every text is a prop.
 */
import { createContext, type ComponentChildren } from "preact";
import { useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  createPaletteController,
  type PaletteController,
  type PaletteControllerOptions,
  type PaletteItem,
  type PaletteState,
} from "./index.js";

/** Subscribe a component to a controller's state. */
export function usePaletteState<T extends PaletteItem>(controller: PaletteController<T>): PaletteState<T> {
  const [state, setState] = useState(() => controller.getState());
  useEffect(() => {
    setState(controller.getState());
    return controller.subscribe(setState);
  }, [controller]);
  return state;
}

/** Cmd+K (mac) AND Ctrl+K (everything else) toggle the palette; the browser's own Ctrl+K is suppressed. */
export function useCommandPaletteShortcut<T extends PaletteItem>(controller: PaletteController<T>, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "k") return;
      e.preventDefault();
      controller.toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [controller, enabled]);
}

export interface CommandPaletteProps<T extends PaletteItem = PaletteItem> {
  controller: PaletteController<T>;
  /** Where an item with `href` (and no `action`) goes. Default: `location.assign`. */
  onNavigate?: (href: string, item: T) => void;
  /** Icon for a row. Default: `item.icon` when it is renderable. */
  renderIcon?: (item: T) => ComponentChildren;
  placeholder?: string;
  emptyText?: string;
  closeLabel?: string;
  /** Accessible name of the dialog. */
  title?: string;
}

interface Row<T> {
  item: T;
  /** Index into controller results — what the controller's activeIndex points at. */
  index: number;
}

/** Bucket results by `item.group`, groups in order of first appearance, ranking kept inside each. */
function groupRows<T extends PaletteItem>(results: T[]): { group: string; rows: Row<T>[] }[] {
  const groups: { group: string; rows: Row<T>[] }[] = [];
  const byName = new Map<string, Row<T>[]>();
  results.forEach((item, index) => {
    const name = typeof item.group === "string" ? item.group : "";
    let rows = byName.get(name);
    if (!rows) {
      rows = [];
      byName.set(name, rows);
      groups.push({ group: name, rows });
    }
    rows.push({ item, index });
  });
  return groups;
}

export function CommandPalette<T extends PaletteItem>({
  controller,
  onNavigate,
  renderIcon,
  placeholder = "Search…",
  emptyText = "No results",
  closeLabel = "Close",
  title = "Command palette",
}: CommandPaletteProps<T>) {
  const state = usePaletteState(controller);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const optionId = (i: number) => `${baseId}-opt-${i}`;

  const groups = useMemo(() => groupRows(state.results), [state.results]);
  const visual = useMemo(() => groups.flatMap((g) => g.rows), [groups]);

  // Open: remember who had focus, lock the page, and claim focus LAST — after the
  // opener's own focus handling and any entry animation have run. A layout effect,
  // so Escape works from the first frame (Lens measured an Escape 2 ms after open
  // landing before a passive effect had attached the listener).
  useLayoutEffect(() => {
    if (!state.open) return;
    returnFocus.current = (document.activeElement as HTMLElement | null) ?? null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const raf = requestAnimationFrame(() => {
      timer = setTimeout(() => inputRef.current?.focus(), 0);
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        controller.close();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      const back = returnFocus.current;
      returnFocus.current = null;
      if (back && back.isConnected && typeof back.focus === "function") back.focus();
    };
  }, [state.open, controller]);

  // Keep the highlighted row in view.
  useEffect(() => {
    if (!state.open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[id="${optionId(state.activeIndex)}"]`);
    el?.scrollIntoView?.({ block: "nearest" });
  }, [state.open, state.activeIndex]);

  if (!state.open) return null;

  const activate = (item: T) => {
    controller.select(item);
    const href = typeof item.href === "string" ? item.href : null;
    if (href && !item.action) {
      if (onNavigate) onNavigate(href, item);
      else window.location.assign(href);
    }
  };

  const step = (dir: 1 | -1) => {
    if (visual.length === 0) return;
    const pos = visual.findIndex((r) => r.index === state.activeIndex);
    const next = visual[(pos + dir + visual.length) % visual.length];
    controller.setActiveIndex(next.index);
  };

  const onInputKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      step(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      step(-1);
    } else if (e.key === "Enter") {
      const item = state.results[state.activeIndex];
      if (item) {
        e.preventDefault();
        activate(item);
      }
    }
  };

  const icon = (item: T): ComponentChildren => {
    if (renderIcon) return renderIcon(item);
    const v = item.icon;
    return typeof v === "string" || (typeof v === "object" && v !== null) ? (v as ComponentChildren) : null;
  };

  const hasResults = visual.length > 0;

  return (
    <div class="bcmdk-root" data-testid="command-palette-root">
      <div class="bcmdk-backdrop" data-testid="command-palette-backdrop" onClick={() => controller.close()} />
      <div class="bcmdk-panel" role="dialog" aria-modal="true" aria-label={title}>
        <div class="bcmdk-head">
          <input
            ref={inputRef}
            class="bcmdk-input"
            data-testid="command-palette-search-input"
            type="text"
            role="combobox"
            aria-expanded={hasResults}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={hasResults ? optionId(state.activeIndex) : undefined}
            autocomplete="off"
            spellcheck={false}
            placeholder={placeholder}
            value={state.query}
            onInput={(e) => controller.setQuery((e.currentTarget as HTMLInputElement).value)}
            onKeyDown={onInputKey}
          />
          <button
            type="button"
            class="bcmdk-close"
            data-testid="command-palette-close"
            aria-label={closeLabel}
            onClick={() => controller.close()}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div ref={listRef} id={listId} class="bcmdk-list" role="listbox" aria-label={title}>
          {!hasResults && (
            <div class="bcmdk-empty" data-testid="command-palette-empty">
              {emptyText}
            </div>
          )}
          {groups.map((g) => (
            <div class="bcmdk-group" role="group" aria-label={g.group || undefined} key={g.group}>
              {g.group && <div class="bcmdk-group-title" aria-hidden="true">{g.group}</div>}
              {g.rows.map(({ item, index }) => {
                const active = index === state.activeIndex;
                const ic = icon(item);
                return (
                  <div
                    key={item.id}
                    id={optionId(index)}
                    class={active ? "bcmdk-item is-active" : "bcmdk-item"}
                    data-testid={`command-palette-item-${item.id}`}
                    role="option"
                    aria-selected={active}
                    onMouseMove={() => controller.setActiveIndex(index)}
                    onMouseDown={(e) => e.preventDefault() /* keep focus in the input */}
                    onClick={() => activate(item)}
                  >
                    {ic != null && <span class="bcmdk-icon" aria-hidden="true">{ic}</span>}
                    <span class="bcmdk-label">{item.label}</span>
                    {typeof item.sublabel === "string" && <span class="bcmdk-sublabel">{item.sublabel}</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Provider: one controller per app, reachable from anywhere ───────────────

const PaletteContext = createContext<PaletteController<PaletteItem> | null>(null);

export interface CommandPaletteProviderProps<T extends PaletteItem = PaletteItem>
  extends Omit<CommandPaletteProps<T>, "controller">,
    Omit<PaletteControllerOptions<T>, "items"> {
  items: T[];
  /** Controlled open state. Omit to let the palette own it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Bind Cmd+K / Ctrl+K. Default true. */
  shortcut?: boolean;
  children?: ComponentChildren;
}

export function CommandPaletteProvider<T extends PaletteItem>({
  items,
  recentsStore,
  limit,
  open,
  onOpenChange,
  shortcut = true,
  children,
  ...paletteProps
}: CommandPaletteProviderProps<T>) {
  const controller = useMemo(() => createPaletteController<T>({ items, recentsStore, limit }), []);
  useEffect(() => controller.setItems(items), [controller, items]);

  useEffect(() => {
    if (open === undefined || open === controller.getState().open) return;
    if (open) controller.open();
    else controller.close();
  }, [controller, open]);

  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  useEffect(() => {
    let last = controller.getState().open;
    return controller.subscribe((s) => {
      if (s.open !== last) {
        last = s.open;
        onOpenChangeRef.current?.(s.open);
      }
    });
  }, [controller]);

  useCommandPaletteShortcut(controller, shortcut);

  return (
    <PaletteContext.Provider value={controller as unknown as PaletteController<PaletteItem>}>
      {children}
      <CommandPalette controller={controller} {...paletteProps} />
    </PaletteContext.Provider>
  );
}

/** The provider's controller — `useCommandPalette().open()` opens it from a button. */
export function useCommandPalette<T extends PaletteItem = PaletteItem>(): PaletteController<T> {
  const c = useContext(PaletteContext);
  if (!c) throw new Error("useCommandPalette() must be used inside <CommandPaletteProvider>");
  return c as unknown as PaletteController<T>;
}

export type { PaletteItem, PaletteController, PaletteState } from "./index.js";
