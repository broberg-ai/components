// @broberg/data-table — the framework-free core (F094.1).
//
// Five table operations as pure functions: sort, filter, paginate, select and
// column visibility. The Preact component (`@broberg/data-table/preact`) only
// renders what these return, so the behaviour is tested here once, without a DOM.
//
// Chosen over @tanstack/table-core (F094): that engine is built around a
// per-framework adapter and owns its own state; we need a small slice of it, and
// state we own is state we can mutation-test.

export type SortDir = "asc" | "desc";
export interface SortState {
  columnId: string;
  dir: SortDir;
}

/** A click on a sortable header cycles ascending → descending → unsorted. */
export function nextSort(current: SortState | null, columnId: string): SortState | null {
  if (!current || current.columnId !== columnId) return { columnId, dir: "asc" };
  if (current.dir === "asc") return { columnId, dir: "desc" };
  return null;
}

const collator = new Intl.Collator("da", { numeric: true, sensitivity: "base" });

/** Numbers compare as numbers, everything else as Danish text; empty values sort last. */
export function compareValues(a: unknown, b: unknown): number {
  const emptyA = a === null || a === undefined || a === "";
  const emptyB = b === null || b === undefined || b === "";
  if (emptyA || emptyB) return emptyA === emptyB ? 0 : emptyA ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  return collator.compare(String(a), String(b));
}

/** Stable: rows that compare equal keep their original order. Never mutates `rows`. */
export function sortRows<T>(rows: readonly T[], sort: SortState | null, getValue: (row: T, columnId: string) => unknown): T[] {
  if (!sort) return rows.slice();
  const sign = sort.dir === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((x, y) => {
      const a = getValue(x.row, sort.columnId);
      const b = getValue(y.row, sort.columnId);
      const emptyA = a === null || a === undefined || a === "";
      const emptyB = b === null || b === undefined || b === "";
      // Empty values stay last in BOTH directions; flipping them to the top on
      // "descending" would bury the real rows under blanks.
      if (emptyA !== emptyB) return emptyA ? 1 : -1;
      return sign * compareValues(a, b) || x.index - y.index;
    })
    .map((x) => x.row);
}

/** Case-insensitive substring match against every text the row offers. An empty query keeps all rows. */
export function filterRows<T>(rows: readonly T[], query: string, getTexts: (row: T) => readonly unknown[]): T[] {
  const q = query.trim().toLocaleLowerCase("da");
  if (!q) return rows.slice();
  return rows.filter((row) =>
    getTexts(row).some((v) => v !== null && v !== undefined && String(v).toLocaleLowerCase("da").includes(q)),
  );
}

export interface Page<T> {
  rows: T[];
  /** Clamped into range, so a filter that shrinks the result never leaves you on page 7 of 2. */
  pageIndex: number;
  pageCount: number;
}

/** `pageCount` is at least 1, so «Side 1 af 1» reads correctly on an empty table. */
export function paginate<T>(rows: readonly T[], pageIndex: number, pageSize: number): Page<T> {
  const size = Math.max(1, Math.floor(pageSize));
  const pageCount = Math.max(1, Math.ceil(rows.length / size));
  const index = Math.min(Math.max(0, Math.floor(pageIndex)), pageCount - 1);
  return { rows: rows.slice(index * size, index * size + size), pageIndex: index, pageCount };
}

export type SelectionState = "none" | "some" | "all";

/** What the select-all checkbox shows for `ids`: unchecked, indeterminate or checked. */
export function selectionState(ids: readonly string[], selected: ReadonlySet<string>): SelectionState {
  let hits = 0;
  for (const id of ids) if (selected.has(id)) hits++;
  if (hits === 0) return "none";
  return hits === ids.length ? "all" : "some";
}

/** Select-all on `ids`: if all of them are selected, clears them; otherwise selects them. Other ids are kept. */
export function toggleAll(ids: readonly string[], selected: ReadonlySet<string>): Set<string> {
  const next = new Set(selected);
  if (selectionState(ids, selected) === "all") for (const id of ids) next.delete(id);
  else for (const id of ids) next.add(id);
  return next;
}

export function toggleOne(id: string, selected: ReadonlySet<string>): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** The subset of `storage` this package uses, so a test or an SSR caller can pass its own. */
export interface ColumnStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): ColumnStorage | null {
  try {
    const s = (globalThis as { localStorage?: ColumnStorage }).localStorage;
    return s ?? null;
  } catch {
    // A private window or blocked site data can make the accessor itself throw.
    return null;
  }
}

/** The hidden column ids saved under `key`; anything unreadable counts as «nothing saved». */
export function loadHiddenColumns(key: string, storage: ColumnStorage | null = defaultStorage()): string[] {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** Returns false when the choice could not be saved (no storage, quota, blocked). */
export function saveHiddenColumns(key: string, hidden: readonly string[], storage: ColumnStorage | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify([...hidden]));
    return true;
  } catch {
    return false;
  }
}
