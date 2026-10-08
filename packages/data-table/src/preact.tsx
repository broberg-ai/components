/** @jsxImportSource preact */
// @broberg/data-table/preact — the Stack B table (F094.1).
//
// Renders what the core computes: search → sort → paginate, plus selection,
// remembered column visibility, a ⋮-menu per row and typed cells. No native
// <select> or <dialog> anywhere (D-4cd764): every dropdown is a button + a
// listbox/menu driven by @broberg/ui-controls-core's keyboard reducer, and it
// closes on Escape and on a click outside. Every interactive element carries a
// data-testid under one prefix, so Lens can drive it.
import type { ComponentChild, JSX } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { makeOutsideClickHandler, selectKeyReducer, type SelectState } from "@broberg/ui-controls-core";
import {
  filterRows,
  loadHiddenColumns,
  moveRow,
  nextSort,
  paginate,
  saveHiddenColumns,
  selectionState,
  sortRows,
  toggleAll,
  toggleOne,
  type SortState,
} from "./index";

export type StatusTone = "done" | "progress" | "pending" | "error";

export interface SelectOption {
  value: string;
  label: string;
}

export interface Column<T> {
  id: string;
  header: string;
  /** Defaults to `row[id]`. */
  accessor?: (row: T) => unknown;
  /** How the value is drawn. A function renders whatever it returns. Default "text". */
  cell?: "text" | "badge" | "status" | "number" | "select" | ((row: T) => ComponentChild);
  sortable?: boolean;
  /** Numbers default to "right". */
  align?: "left" | "right";
  /** May the user hide it under «Tilpas kolonner»? Default true. */
  hideable?: boolean;
  /** Does the search box look in this column? Default true for text, badge, status, select. */
  searchable?: boolean;
  /** For cell "select": the choices. */
  options?: SelectOption[];
  /** For cell "status": which icon a value gets. Default "pending". */
  statusTone?: (value: unknown) => StatusTone;
}

export type RowAction<T> =
  | { label: string; onSelect: (row: T) => void; destructive?: boolean }
  | "separator";

export interface DataTableLabels {
  search: string;
  columns: string;
  /** e.g. «3 af 12 rækker valgt». */
  selected: (selected: number, total: number) => string;
  rowsPerPage: string;
  /** e.g. «Side 2 af 5». */
  page: (page: number, pageCount: number) => string;
  first: string;
  previous: string;
  next: string;
  last: string;
  selectAll: string;
  selectRow: string;
  rowActions: string;
  empty: string;
  /** F094.2 — the drag handle's name when it can be used. */
  dragHandle: string;
  /** …and when it cannot: says WHY (sorted or filtered). */
  dragDisabled: string;
  /** Spoken in the live region. Positions are 1-based within the page. */
  dragLifted: (position: number, total: number) => string;
  dragMoved: (position: number, total: number) => string;
  dragDropped: (position: number, total: number) => string;
  dragCancelled: string;
}

export const DEFAULT_LABELS: DataTableLabels = {
  search: "Søg…",
  columns: "Tilpas kolonner",
  selected: (s, t) => `${s} af ${t} rækker valgt`,
  rowsPerPage: "Rækker pr. side",
  page: (p, c) => `Side ${p} af ${c}`,
  first: "Første side",
  previous: "Forrige side",
  next: "Næste side",
  last: "Sidste side",
  selectAll: "Vælg alle",
  selectRow: "Vælg række",
  rowActions: "Handlinger",
  empty: "Ingen resultater.",
  dragHandle: "Flyt række — mellemrum løfter, pilene flytter",
  dragDisabled: "Kan ikke flyttes mens tabellen er sorteret eller filtreret",
  dragLifted: (p, t) => `Række løftet, position ${p} af ${t}. Pil op og ned flytter, mellemrum slipper, Escape fortryder.`,
  dragMoved: (p, t) => `Position ${p} af ${t}.`,
  dragDropped: (p, t) => `Række sluppet på position ${p} af ${t}.`,
  dragCancelled: "Flytning fortrudt.",
};

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  /** Prefix for every data-testid. Default "data-table". */
  testId?: string;
  searchable?: boolean;
  selectable?: boolean;
  onSelectionChange?: (ids: string[]) => void;
  rowActions?: RowAction<T>[];
  onCellChange?: (rowId: string, columnId: string, value: string) => void;
  /**
   * F094.2 — gives every row a drag handle. Called with ALL row ids in their new
   * order after a drop. Off while the table is sorted or filtered: then the order
   * on screen is not the stored one, and a drop would save an order nobody saw.
   */
  onReorder?: (ids: string[]) => void;
  /** Remember hidden columns in localStorage under this key. Without it, nothing is stored. */
  columnStorageKey?: string;
  pageSizes?: number[];
  initialPageSize?: number;
  labels?: Partial<DataTableLabels>;
}

const valueOf = <T,>(col: Column<T>, row: T): unknown =>
  col.accessor ? col.accessor(row) : (row as Record<string, unknown>)[col.id];

const numberFormat = new Intl.NumberFormat("da-DK");

// ── icons: stroke, currentColor, no emoji (D-9d5cce) ──
const Icon = ({ d, label }: { d: string; label?: string }) => (
  <svg class="bdt-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden={label ? undefined : "true"} role={label ? "img" : undefined} aria-label={label}>
    <path d={d} />
  </svg>
);
const ICON = {
  up: "M12 19V5M5 12l7-7 7 7",
  down: "M12 5v14M19 12l-7 7-7-7",
  both: "M7 15l5 5 5-5M7 9l5-5 5 5",
  check: "M20 6 9 17l-5-5",
  dots: "M12 5h.01M12 12h.01M12 19h.01",
  chevron: "m6 9 6 6 6-6",
  first: "m11 17-5-5 5-5M18 17l-5-5 5-5",
  prev: "m15 18-6-6 6-6",
  next: "m9 18 6-6-6-6",
  last: "m13 17 5-5-5-5M6 17l5-5-5-5",
  columns: "M12 3v18M3 3h18v18H3z",
  grip: "M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01",
};
const STATUS_ICON: Record<StatusTone, string> = {
  done: "M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3",
  progress: "M21 12a9 9 0 1 1-6.22-8.56",
  pending: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z",
  error: "M12 8v4M12 16h.01M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z",
};

// ── F094.3: below 768px every row is a card (same breakpoint as @broberg/app-shell) ──
const MOBILE_QUERY = "(max-width: 767px)";
function useIsMobile(): boolean {
  const get = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(MOBILE_QUERY).matches;
  const [mobile, setMobile] = useState(get);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(MOBILE_QUERY);
    const on = () => setMobile(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return mobile;
}

// ── one dropdown, used by every menu in the table ──
interface MenuItem {
  key: string;
  label: string;
  testId: string;
  checked?: boolean;
  destructive?: boolean;
  separatorBefore?: boolean;
}

function Dropdown(props: {
  triggerTestId: string;
  triggerLabel: ComponentChild;
  ariaLabel: string;
  items: MenuItem[];
  role: "menu" | "listbox";
  /** Keep the panel open after a choice (multi-toggle, e.g. «Tilpas kolonner»). */
  stayOpen?: boolean;
  align?: "start" | "end";
  triggerClass?: string;
  onChoose: (key: string) => void;
}) {
  const [state, setState] = useState<SelectState>({ open: false, highlighted: -1 });
  const [pos, setPos] = useState<JSX.CSSProperties | undefined>(undefined);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  // The panel is position:fixed at the trigger, not absolute inside it. The
  // table sits in a frame that scrolls sideways (overflow-x), and an overflow
  // other than visible clips EVERY descendant — so an absolute ⋮-menu or cell
  // dropdown in the last rows opened cut off inside the frame. Fixed escapes
  // it; makeOutsideClickHandler already closes on scroll and resize, which is
  // what keeps a fixed panel from drifting away from its trigger.
  useEffect(() => {
    if (!state.open) return;
    const r = trigger.current?.getBoundingClientRect();
    if (r) {
      const vw = (globalThis as { innerWidth?: number }).innerWidth ?? r.right;
      setPos(props.align === "end"
        ? { position: "fixed", top: `${r.bottom + 4}px`, right: `${Math.max(0, vw - r.right)}px` }
        : { position: "fixed", top: `${r.bottom + 4}px`, left: `${r.left}px` });
    }
    const h = makeOutsideClickHandler(() => [wrap.current], () => setState((s) => ({ ...s, open: false })));
    h.attach();
    return () => h.detach();
  }, [state.open]);

  const choose = (index: number) => {
    const item = props.items[index];
    if (!item) return;
    props.onChoose(item.key);
    if (!props.stayOpen) {
      setState({ open: false, highlighted: index });
      trigger.current?.focus();
    }
  };

  const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowDown", "ArrowUp", "Enter", " ", "Spacebar", "Escape"].includes(e.key)) return;
    e.preventDefault();
    const { state: next, intent } = selectKeyReducer(state, e.key, props.items.length);
    if (intent.type === "select") {
      choose(intent.index);
      if (props.stayOpen) setState({ open: true, highlighted: intent.index });
      return;
    }
    setState(next);
  };

  const base = props.triggerTestId;
  return (
    <div class="bdt-dropdown" ref={wrap}>
      <button
        ref={trigger}
        type="button"
        class={props.triggerClass ?? "bdt-button"}
        data-testid={base}
        aria-label={props.ariaLabel}
        aria-haspopup={props.role}
        aria-expanded={state.open ? "true" : "false"}
        aria-activedescendant={state.open && state.highlighted >= 0 ? `${base}-opt-${state.highlighted}` : undefined}
        onClick={() => setState((s) => ({ open: !s.open, highlighted: s.open ? s.highlighted : -1 }))}
        onKeyDown={onKeyDown}
      >
        {props.triggerLabel}
      </button>
      {state.open && (
        <div class={`bdt-panel bdt-panel-${props.align ?? "start"}`} style={pos} role={props.role} data-testid={`${base}-panel`}>
          {props.items.map((item, i) => [
            item.separatorBefore ? <div class="bdt-separator" role="separator" key={`sep-${item.key}`} /> : null,
            <div
              key={item.key}
              id={`${base}-opt-${i}`}
              class={`bdt-item${i === state.highlighted ? " is-highlighted" : ""}${item.destructive ? " is-destructive" : ""}`}
              role={props.role === "menu" ? (item.checked === undefined ? "menuitem" : "menuitemcheckbox") : "option"}
              aria-checked={props.role === "menu" && item.checked !== undefined ? item.checked : undefined}
              aria-selected={props.role === "listbox" ? !!item.checked : undefined}
              data-testid={item.testId}
              onMouseEnter={() => setState((s) => ({ ...s, highlighted: i }))}
              onClick={() => choose(i)}
            >
              <span class="bdt-check">{item.checked ? <Icon d={ICON.check} /> : null}</span>
              <span>{item.label}</span>
            </div>,
          ])}
        </div>
      )}
    </div>
  );
}

// ── the indeterminate checkbox: `indeterminate` is a DOM property, not an attribute ──
function Checkbox(props: { state: "none" | "some" | "all"; label: string; testId: string; onToggle: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = props.state === "some";
  }, [props.state]);
  return (
    <input
      ref={ref}
      type="checkbox"
      class="bdt-checkbox"
      aria-label={props.label}
      aria-checked={props.state === "some" ? "mixed" : props.state === "all" ? "true" : "false"}
      checked={props.state === "all"}
      data-testid={props.testId}
      onChange={props.onToggle}
    />
  );
}

export function DataTable<T>(props: DataTableProps<T>) {
  const p = props.testId ?? "data-table";
  const L: DataTableLabels = { ...DEFAULT_LABELS, ...props.labels };
  const pageSizes = props.pageSizes ?? [10, 20, 30, 40, 50];

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(props.initialPageSize ?? pageSizes[0] ?? 10);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set(props.columnStorageKey ? loadHiddenColumns(props.columnStorageKey) : []),
  );

  // F094.2 — a row being moved; `from`/`over` are indices within the current page.
  type Drag = { id: string; from: number; over: number; via: "pointer" | "keyboard" };
  const [drag, setDragState] = useState<Drag | null>(null);
  // Handlers read the ref, not the render's `drag`: two key presses inside one
  // frame both saw the old position and the second arrow was lost (Lens, Chromium).
  const dragRef = useRef<Drag | null>(null);
  const setDrag = (d: Drag | null) => { dragRef.current = d; setDragState(d); };
  const [announce, setAnnounce] = useState("");
  const rowsRef = useRef<HTMLElement | null>(null);
  const setRowsEl = (el: HTMLElement | null) => { rowsRef.current = el; };
  // Moving the lifted row re-inserts its DOM node, and a re-inserted node loses
  // focus — so a keyboard drag would stop listening after its first arrow. A
  // layout effect, because a plain effect waits for the next frame and a fast
  // second key press landed on <body> in between (measured in Chromium via Lens).
  useLayoutEffect(() => {
    if (drag?.via !== "keyboard") return;
    const row = [...(rowsRef.current?.querySelectorAll<HTMLElement>("[data-reorder-id]") ?? [])].find((el) => el.dataset.reorderId === drag.id);
    const h = row?.querySelector<HTMLElement>(".bdt-drag-handle");
    if (h && h.ownerDocument.activeElement !== h) h.focus();
  }, [drag]);

  const shown = props.columns.filter((c) => !hidden.has(c.id));
  const searchCols = shown.filter((c) => c.searchable ?? (c.cell === undefined || ["text", "badge", "status", "select"].includes(c.cell as string)));

  const filtered = useMemo(
    () => filterRows(props.rows, query, (row) => searchCols.map((c) => {
      const v = valueOf(c, row);
      // A select cell is searched by what the user SEES, not by the stored value.
      return c.cell === "select" ? (c.options?.find((o) => o.value === v)?.label ?? v) : v;
    })),
    [props.rows, query, searchCols.map((c) => c.id).join("|")],
  );
  const sorted = useMemo(
    () => sortRows(filtered, sort, (row, id) => {
      const col = props.columns.find((c) => c.id === id);
      return col ? valueOf(col, row) : undefined;
    }),
    [filtered, sort, props.columns],
  );
  const page = paginate(sorted, pageIndex, pageSize);
  useEffect(() => {
    if (page.pageIndex !== pageIndex) setPageIndex(page.pageIndex);
  }, [page.pageIndex, pageIndex]);

  const canReorder = !!props.onReorder && sort === null && query.trim() === "";
  const pageRows = drag ? moveRow(page.rows, drag.from, drag.over) : page.rows;
  const pageTotal = page.rows.length;

  const drop = (d: Drag) => {
    setDrag(null);
    setAnnounce(L.dragDropped(d.over + 1, pageTotal));
    if (d.over === d.from) return;
    const offset = page.pageIndex * pageSize;
    props.onReorder?.(moveRow(props.rows.map(props.getRowId), offset + d.from, offset + d.over));
  };
  const cancel = () => {
    setDrag(null);
    setAnnounce(L.dragCancelled);
  };
  // Where the pointer would insert the row: how many OTHER rows have their middle above it.
  const overFromPointer = (id: string, y: number): number => {
    const els = [...(rowsRef.current?.querySelectorAll<HTMLElement>("[data-reorder-id]") ?? [])];
    return els.filter((el) => {
      if (el.dataset.reorderId === id) return false;
      const r = el.getBoundingClientRect();
      return r.top + r.height / 2 < y;
    }).length;
  };

  // Move/up/cancel are heard on the window, not the handle: the preview re-inserts
  // row nodes as the pointer moves, and a re-inserted node loses its pointer
  // capture — measured in Chromium via Lens, where the drop then never arrived
  // and the row stayed lifted. happy-dom does not model capture, so only a real
  // browser shows it.
  useEffect(() => {
    if (drag?.via !== "pointer") return;
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const over = overFromPointer(d.id, e.clientY);
      if (over !== d.over) setDrag({ ...d, over });
    };
    const up = () => { if (dragRef.current) drop(dragRef.current); };
    const stop = () => cancel();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", stop);
    };
  }, [drag?.via]);

  const dragHandle = (id: string, index: number) => (
    <button
      type="button"
      class={`bdt-drag-handle${drag?.id === id ? " is-lifted" : ""}`}
      data-testid={`row-drag-${id}`}
      aria-label={canReorder ? L.dragHandle : L.dragDisabled}
      title={canReorder ? undefined : L.dragDisabled}
      aria-disabled={canReorder ? undefined : "true"}
      aria-pressed={drag?.id === id && drag.via === "keyboard" ? "true" : undefined}
      onPointerDown={(e) => {
        if (!canReorder || dragRef.current || e.button > 0) return;
        e.preventDefault();
        setDrag({ id, from: index, over: index, via: "pointer" });
      }}
      onKeyDown={(e) => {
        if (!canReorder) return;
        const drag = dragRef.current;
        const lift = e.key === " " || e.key === "Enter" || e.key === "Spacebar";
        if (!drag) {
          if (!lift) return;
          e.preventDefault();
          setDrag({ id, from: index, over: index, via: "keyboard" });
          setAnnounce(L.dragLifted(index + 1, pageTotal));
          return;
        }
        if (drag.id !== id || drag.via !== "keyboard") return;
        if (lift) { e.preventDefault(); drop(drag); return; }
        if (e.key === "Escape") { e.preventDefault(); cancel(); return; }
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const over = Math.max(0, Math.min(pageTotal - 1, drag.over + (e.key === "ArrowUp" ? -1 : 1)));
          setDrag({ ...drag, over });
          setAnnounce(L.dragMoved(over + 1, pageTotal));
        }
      }}
      // Leaving the handle ends the move — by Tab or by a click elsewhere. The re-insert
      // above also blurs it, but refocuses before the next task, so check after one.
      onBlur={() => {
        setTimeout(() => {
          const d = dragRef.current;
          if (d?.via !== "keyboard" || d.id !== id) return;
          const now = rowsRef.current?.ownerDocument.activeElement;
          if (!(now instanceof HTMLElement) || !now.classList.contains("bdt-drag-handle") || now.closest("[data-reorder-id]")?.getAttribute("data-reorder-id") !== id) cancel();
        }, 0);
      }}
    >
      <Icon d={ICON.grip} />
    </button>
  );

  const filteredIds = filtered.map(props.getRowId);
  const pageIds = page.rows.map(props.getRowId);
  const selectedVisible = filteredIds.filter((id) => selected.has(id)).length;

  const updateSelection = (next: Set<string>) => {
    setSelected(next);
    props.onSelectionChange?.([...next]);
  };

  const toggleColumn = (id: string) => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setHidden(next);
    if (props.columnStorageKey) saveHiddenColumns(props.columnStorageKey, [...next]);
  };

  const renderCell = (col: Column<T>, row: T, rowId: string): ComponentChild => {
    const v = valueOf(col, row);
    if (typeof col.cell === "function") return col.cell(row);
    switch (col.cell) {
      case "badge":
        return <span class="bdt-badge">{v === null || v === undefined ? "" : String(v)}</span>;
      case "status": {
        const tone = col.statusTone?.(v) ?? "pending";
        return (
          <span class={`bdt-status bdt-status-${tone}`} data-tone={tone}>
            <Icon d={STATUS_ICON[tone]} />
            {v === null || v === undefined ? "" : String(v)}
          </span>
        );
      }
      case "number":
        return typeof v === "number" ? numberFormat.format(v) : v === null || v === undefined ? "" : String(v);
      case "select": {
        const options = col.options ?? [];
        const current = options.find((o) => o.value === v);
        return (
          <Dropdown
            triggerTestId={`${p}-cell-${rowId}-${col.id}`}
            triggerClass="bdt-cell-select"
            triggerLabel={[<span>{current?.label ?? (v === null || v === undefined ? "" : String(v))}</span>, <Icon d={ICON.chevron} />]}
            ariaLabel={col.header}
            role="listbox"
            items={options.map((o) => ({ key: o.value, label: o.label, testId: `${p}-cell-${rowId}-${col.id}-option-${o.value}`, checked: o.value === v }))}
            onChoose={(value) => {
              if (value !== v) props.onCellChange?.(rowId, col.id, value);
            }}
          />
        );
      }
      default:
        return v === null || v === undefined ? "" : String(v);
    }
  };

  const alignOf = (c: Column<T>) => c.align ?? (c.cell === "number" ? "right" : "left");
  const actions = props.rowActions ?? [];
  const colSpan = shown.length + (props.selectable ? 1 : 0) + (actions.length ? 1 : 0) + (props.onReorder ? 1 : 0);

  const rowMenu = (row: T, id: string) => (
    <Dropdown
      triggerTestId={`${p}-actions-${id}`}
      triggerClass="bdt-icon-button"
      triggerLabel={<Icon d={ICON.dots} />}
      ariaLabel={L.rowActions}
      role="menu"
      align="end"
      items={(() => {
        const out: MenuItem[] = [];
        let sep = false;
        actions.forEach((a, i) => {
          if (a === "separator") { sep = out.length > 0; return; }
          out.push({ key: String(i), label: a.label, testId: `${p}-actions-${id}-${i}`, destructive: a.destructive, separatorBefore: sep });
          sep = false;
        });
        return out;
      })()}
      onChoose={(key) => {
        const a = actions[Number(key)];
        if (a && a !== "separator") a.onSelect(row);
      }}
    />
  );
  const isMobile = useIsMobile();
  const primary = shown[0];

  return (
    <div class={`bdt-root${isMobile ? " is-mobile" : ""}`} data-testid={p}>
      <div class="bdt-toolbar">
        {props.searchable !== false && (
          <input
            type="search"
            class="bdt-search"
            placeholder={L.search}
            aria-label={L.search}
            value={query}
            data-testid={`${p}-search`}
            onInput={(e) => {
              setQuery((e.currentTarget as HTMLInputElement).value);
              setPageIndex(0);
            }}
          />
        )}
        <Dropdown
          triggerTestId={`${p}-columns`}
          triggerLabel={[<Icon d={ICON.columns} />, <span>{L.columns}</span>, <Icon d={ICON.chevron} />]}
          ariaLabel={L.columns}
          role="menu"
          stayOpen
          align="end"
          items={props.columns
            .filter((c) => c.hideable !== false)
            .map((c) => ({ key: c.id, label: c.header, testId: `${p}-columns-${c.id}`, checked: !hidden.has(c.id) }))}
          onChoose={toggleColumn}
        />
      </div>

      {isMobile ? (
        <div class="bdt-cards" data-testid={`${p}-cards`} ref={setRowsEl}>
          {props.selectable && page.rows.length > 0 && (
            <label class="bdt-cards-head">
              <Checkbox state={selectionState(pageIds, selected)} label={L.selectAll} testId={`${p}-select-all`}
                onToggle={() => updateSelection(toggleAll(pageIds, selected))} />
              <span>{L.selectAll}</span>
            </label>
          )}
          {page.rows.length === 0 ? (
            <div class="bdt-empty" data-testid={`${p}-empty`}>{L.empty}</div>
          ) : (
            pageRows.map((row, index) => {
              const id = props.getRowId(row);
              const rest = shown.slice(1);
              return (
                <article key={id} class={`bdt-card${selected.has(id) ? " is-selected" : ""}${drag?.id === id ? " is-dragging" : ""}`}
                  data-testid={`row-card-${id}`} data-reorder-id={props.onReorder ? id : undefined}>
                  <div class="bdt-card-top">
                    {props.onReorder && dragHandle(id, index)}
                    {props.selectable && (
                      <Checkbox state={selected.has(id) ? "all" : "none"} label={L.selectRow} testId={`${p}-select-${id}`}
                        onToggle={() => updateSelection(toggleOne(id, selected))} />
                    )}
                    <div class="bdt-card-title" data-testid={`${p}-cell-${id}-${primary?.id}-td`}>
                      {primary ? renderCell(primary, row, id) : null}
                    </div>
                    {actions.length > 0 && rowMenu(row, id)}
                  </div>
                  {rest.length > 0 && (
                    <dl class="bdt-card-body">
                      {rest.map((c) => (
                        <div class="bdt-card-field" key={c.id}>
                          <dt>{c.header}</dt>
                          <dd class={c.cell === "number" ? "bdt-num" : undefined} data-testid={`${p}-cell-${id}-${c.id}-td`}>{renderCell(c, row, id)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </article>
              );
            })
          )}
        </div>
      ) : (
      <div class="bdt-scroll">
        <table class="bdt-table">
          <thead>
            <tr>
              {props.onReorder && <th class="bdt-th bdt-col-drag"><span class="bdt-sr">{L.dragHandle}</span></th>}
              {props.selectable && (
                <th class="bdt-th bdt-col-select">
                  <Checkbox state={selectionState(pageIds, selected)} label={L.selectAll} testId={`${p}-select-all`}
                    onToggle={() => updateSelection(toggleAll(pageIds, selected))} />
                </th>
              )}
              {shown.map((c) => {
                const dir = sort?.columnId === c.id ? sort.dir : null;
                return (
                  <th
                    key={c.id}
                    class={`bdt-th bdt-align-${alignOf(c)}`}
                    aria-sort={c.sortable ? (dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none") : undefined}
                    data-testid={`${p}-header-${c.id}`}
                  >
                    {c.sortable ? (
                      <button type="button" class="bdt-sort" data-testid={`${p}-sort-${c.id}`}
                        onClick={() => { setSort(nextSort(sort, c.id)); setPageIndex(0); }}>
                        <span>{c.header}</span>
                        <Icon d={dir === "asc" ? ICON.up : dir === "desc" ? ICON.down : ICON.both} />
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
              {actions.length > 0 && <th class="bdt-th bdt-col-actions"><span class="bdt-sr">{L.rowActions}</span></th>}
            </tr>
          </thead>
          <tbody ref={setRowsEl}>
            {page.rows.length === 0 ? (
              <tr><td class="bdt-empty" colSpan={colSpan} data-testid={`${p}-empty`}>{L.empty}</td></tr>
            ) : (
              pageRows.map((row, index) => {
                const id = props.getRowId(row);
                const cls = [selected.has(id) ? "is-selected" : "", drag?.id === id ? "is-dragging" : ""].filter(Boolean).join(" ");
                return (
                  <tr key={id} class={cls || undefined} data-testid={`${p}-row-${id}`} data-reorder-id={props.onReorder ? id : undefined}>
                    {props.onReorder && <td class="bdt-td bdt-col-drag">{dragHandle(id, index)}</td>}
                    {props.selectable && (
                      <td class="bdt-td bdt-col-select">
                        <Checkbox state={selected.has(id) ? "all" : "none"} label={L.selectRow} testId={`${p}-select-${id}`}
                          onToggle={() => updateSelection(toggleOne(id, selected))} />
                      </td>
                    )}
                    {shown.map((c) => (
                      <td key={c.id} class={`bdt-td bdt-align-${alignOf(c)}${c.cell === "number" ? " bdt-num" : ""}`}
                        data-testid={`${p}-cell-${id}-${c.id}-td`}>
                        {renderCell(c, row, id)}
                      </td>
                    ))}
                    {actions.length > 0 && (
                      <td class="bdt-td bdt-col-actions">
                        {rowMenu(row, id)}
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      )}

      {props.onReorder && <div class="bdt-sr" aria-live="assertive" data-testid={`${p}-live`}>{announce}</div>}

      <div class="bdt-footer">
        <div class="bdt-selected" data-testid={`${p}-selected-label`}>
          {props.selectable ? L.selected(selectedVisible, filtered.length) : null}
        </div>
        <div class="bdt-pager">
          <span class="bdt-label">{L.rowsPerPage}</span>
          <Dropdown
            triggerTestId={`${p}-page-size`}
            triggerLabel={[<span>{String(pageSize)}</span>, <Icon d={ICON.chevron} />]}
            ariaLabel={L.rowsPerPage}
            role="listbox"
            align="end"
            items={pageSizes.map((n) => ({ key: String(n), label: String(n), testId: `${p}-page-size-${n}`, checked: n === pageSize }))}
            onChoose={(key) => { setPageSize(Number(key)); setPageIndex(0); }}
          />
          <span class="bdt-label" data-testid={`${p}-page-label`}>{L.page(page.pageIndex + 1, page.pageCount)}</span>
          {([
            ["first", L.first, ICON.first, 0, page.pageIndex === 0],
            ["prev", L.previous, ICON.prev, page.pageIndex - 1, page.pageIndex === 0],
            ["next", L.next, ICON.next, page.pageIndex + 1, page.pageIndex >= page.pageCount - 1],
            ["last", L.last, ICON.last, page.pageCount - 1, page.pageIndex >= page.pageCount - 1],
          ] as const).map(([key, label, icon, target, disabled]) => (
            <button key={key} type="button" class="bdt-icon-button" aria-label={label} disabled={disabled}
              data-testid={`${p}-page-${key}`} onClick={() => setPageIndex(target)}>
              <Icon d={icon} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
