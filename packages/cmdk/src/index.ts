/**
 * @broberg/cmdk — headless command-palette core.
 *
 * Six repos hand-rolled the same Cmd+K interaction logic (fuzzy filter, wrap-
 * around keyboard nav, recents) around wildly different item sets. This package
 * owns that logic, framework-free; **items are always consumer-defined** (they
 * churn too fast to bake in). The React/Preact overlay shells build on this.
 */

export interface PaletteItem {
  /** Stable id (recents dedup + testids key on this). */
  id: string;
  /** Primary text shown + fuzzy-matched. */
  label: string;
  /** Extra searchable terms (synonyms, ids) not shown as the label. */
  keywords?: string[];
  /** Optional grouping bucket (rendered as a section by the shell). */
  group?: string;
  /** Run on activation — the navigation escape hatch (router-agnostic). */
  action?: () => void;
  /** Anything else the shell needs (icon, href, sublabel…). */
  [extra: string]: unknown;
}

// ── Fuzzy filter ────────────────────────────────────────────────────────────

export interface FuzzyOptions {
  /** Cap the number of results. Default: unlimited. */
  limit?: number;
}

interface Scored<T> {
  item: T;
  score: number;
  index: number;
}

/** Subsequence match of `query` in `text`, with a heuristic score, or null. */
function scoreMatch(text: string, query: string): number | null {
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (q.length === 0) return 0;
  let ti = 0;
  let score = 0;
  let streak = 0;
  let prevWasBoundary = true;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    let found = -1;
    for (let k = ti; k < t.length; k++) {
      if (t[k] === ch) {
        found = k;
        break;
      }
    }
    if (found === -1) return null;
    // Bonuses: contiguous run, and matching at a word boundary (start / after sep).
    if (found === ti) streak += 1;
    else streak = 0;
    const atBoundary = found === 0 || /[\s\-_/.]/.test(t[found - 1] ?? "");
    score += 1 + streak * 2 + (atBoundary ? 3 : 0) + (found === 0 && prevWasBoundary ? 2 : 0);
    prevWasBoundary = false;
    ti = found + 1;
  }
  // Prefer shorter targets (a tight match beats a match buried in a long string).
  score += Math.max(0, 10 - text.length / 8);
  return score;
}

/**
 * Rank items against a query. Empty query → all items in original order.
 * Matches on `label` and any `keywords`, keeping the best field score.
 */
export function fuzzyFilter<T extends PaletteItem>(items: T[], query: string, opts: FuzzyOptions = {}): T[] {
  const q = query.trim();
  let out: T[];
  if (q.length === 0) {
    out = items.slice();
  } else {
    const scored: Scored<T>[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const fields = [item.label, ...(item.keywords ?? [])];
      let best: number | null = null;
      for (const f of fields) {
        const s = scoreMatch(f, q);
        if (s != null && (best == null || s > best)) best = s;
      }
      if (best != null) scored.push({ item, score: best, index: i });
    }
    // Highest score first; stable by original index on ties.
    scored.sort((a, b) => b.score - a.score || a.index - b.index);
    out = scored.map((s) => s.item);
  }
  return opts.limit != null ? out.slice(0, opts.limit) : out;
}

// ── Recents store ─────────────────────────────────────────────────────────

export interface RecentsStore {
  get(): string[];
  push(id: string): void;
  clear(): void;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

function globalStorage(): StorageLike | null {
  try {
    const s = (globalThis as unknown as { localStorage?: Partial<StorageLike> }).localStorage;
    if (s && typeof s.getItem === "function" && typeof s.setItem === "function") return s as StorageLike;
  } catch {
    /* privacy mode / SSR */
  }
  return null;
}

/**
 * A most-recent-first list of item ids in localStorage — deduped, capped, and
 * quota-safe (a throwing `setItem` is swallowed so the palette keeps working).
 * Falls back to memory when there's no usable storage.
 */
export function createRecentsStore(storageKey: string, max = 5, storage?: StorageLike): RecentsStore {
  const store = storage ?? globalStorage();
  let mem: string[] = [];
  const read = (): string[] => {
    if (!store) return mem;
    try {
      const raw = store.getItem(storageKey);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  };
  const write = (list: string[]): void => {
    mem = list;
    if (!store) return;
    try {
      store.setItem(storageKey, JSON.stringify(list));
    } catch {
      /* quota / privacy — recents just won't persist */
    }
  };
  return {
    get: read,
    push(id: string) {
      const next = [id, ...read().filter((x) => x !== id)].slice(0, max);
      write(next);
    },
    clear() {
      mem = [];
      if (store?.removeItem) {
        try {
          store.removeItem(storageKey);
        } catch {
          /* ignore */
        }
      } else {
        write([]);
      }
    },
  };
}

// ── Palette controller ───────────────────────────────────────────────────

export interface PaletteState<T extends PaletteItem> {
  open: boolean;
  query: string;
  results: T[];
  activeIndex: number;
}

export interface PaletteController<T extends PaletteItem> {
  getState(): PaletteState<T>;
  setItems(items: T[]): void;
  open(): void;
  close(): void;
  toggle(): void;
  setQuery(query: string): void;
  moveUp(): void;
  moveDown(): void;
  /** Run the active item's action(), record it as recent, and close. */
  selectActive(): T | null;
  /** Activate a specific item (click). */
  select(item: T): void;
  recents(): T[];
  subscribe(listener: (state: PaletteState<T>) => void): () => void;
}

export interface PaletteControllerOptions<T extends PaletteItem> {
  items?: T[];
  recentsStore?: RecentsStore;
  /** Result cap passed to fuzzyFilter. */
  limit?: number;
}

export function createPaletteController<T extends PaletteItem>(
  options: PaletteControllerOptions<T> = {},
): PaletteController<T> {
  let items = options.items ?? [];
  let open = false;
  let query = "";
  let activeIndex = 0;
  let results: T[] = fuzzyFilter(items, query, { limit: options.limit });
  const recentsStore = options.recentsStore ?? null;
  const listeners = new Set<(s: PaletteState<T>) => void>();

  function recompute(): void {
    results = fuzzyFilter(items, query, { limit: options.limit });
    if (activeIndex >= results.length) activeIndex = results.length > 0 ? results.length - 1 : 0;
    if (activeIndex < 0) activeIndex = 0;
  }

  function emit(): void {
    const snapshot: PaletteState<T> = { open, query, results, activeIndex };
    for (const l of listeners) l(snapshot);
  }

  function activate(item: T): void {
    recentsStore?.push(item.id);
    item.action?.();
    open = false;
    query = "";
    activeIndex = 0;
    recompute();
    emit();
  }

  return {
    getState: () => ({ open, query, results, activeIndex }),
    setItems(next: T[]) {
      items = next;
      recompute();
      emit();
    },
    open() {
      open = true;
      emit();
    },
    close() {
      open = false;
      query = "";
      activeIndex = 0;
      recompute();
      emit();
    },
    toggle() {
      open = !open;
      if (!open) {
        query = "";
        activeIndex = 0;
        recompute();
      }
      emit();
    },
    setQuery(next: string) {
      query = next;
      activeIndex = 0;
      recompute();
      emit();
    },
    moveDown() {
      if (results.length === 0) return;
      activeIndex = (activeIndex + 1) % results.length; // wrap
      emit();
    },
    moveUp() {
      if (results.length === 0) return;
      activeIndex = (activeIndex - 1 + results.length) % results.length; // wrap
      emit();
    },
    selectActive() {
      const item = results[activeIndex];
      if (!item) return null;
      activate(item);
      return item;
    },
    select(item: T) {
      activate(item);
    },
    recents() {
      if (!recentsStore) return [];
      const ids = recentsStore.get();
      return ids.map((id) => items.find((it) => it.id === id)).filter((x): x is T => x != null);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
