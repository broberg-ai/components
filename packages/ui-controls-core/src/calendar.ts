/**
 * Calendar arithmetic — Monday-first month grids, `YYYY-MM-DD` (de)serialisation,
 * range checks, localized month labels, and text-input normalisation. Pure, no
 * JSX, no locale baked in (`monthLabel` delegates to `toLocaleDateString`).
 *
 * `month` is 1-indexed (1 = January) throughout the public API.
 */

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** A `Date` → `YYYY-MM-DD` (local calendar date, no timezone shift). */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** `YYYY-MM-DD` → local `Date` at midnight, or null. */
export function parseYmd(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, mo - 1, d);
  // Reject overflow (e.g. 2026-02-31 → March).
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? date : null;
}

/** Inclusive range check on `YYYY-MM-DD` strings (lexicographic = chronological). */
export function isInRange(date: string, min?: string, max?: string): boolean {
  if (min && date < min) return false;
  if (max && date > max) return false;
  return true;
}

/** Localized "July 2026" style label. `locale` delegates to `toLocaleDateString`. */
export function monthLabel(year: number, month: number, locale = "en"): string {
  return new Date(year, month - 1, 1).toLocaleDateString(locale, { month: "long", year: "numeric" });
}

export interface DayCell {
  /** `YYYY-MM-DD`. */
  date: string;
  /** Day of month (1–31). */
  day: number;
  /** False for the leading/trailing padding days from adjacent months. */
  inMonth: boolean;
}

export interface MonthGridOptions {
  /** 0 = Sunday, 1 = Monday (default). */
  weekStartsOn?: 0 | 1;
}

/**
 * A 6×7 = 42-cell grid for `year`/`month`, padded with the trailing days of the
 * previous month and the leading days of the next so every week is full. Monday-
 * first by default.
 */
export function buildMonthGrid(year: number, month: number, opts: MonthGridOptions = {}): DayCell[] {
  const weekStartsOn = opts.weekStartsOn ?? 1;
  const first = new Date(year, month - 1, 1);
  const firstWeekday = first.getDay(); // 0=Sun … 6=Sat
  const lead = (firstWeekday - weekStartsOn + 7) % 7;
  const start = new Date(year, month - 1, 1 - lead);
  const cells: DayCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    cells.push({ date: ymd(d), day: d.getDate(), inMonth: d.getMonth() === month - 1 });
  }
  return cells;
}

/**
 * Normalise a typed date string to canonical `YYYY-MM-DD`, or null. Accepts
 * `YYYY-MM-DD`, `DD-MM-YYYY` and `D.M.YYYY` (any of `-`, `.`, `/` separators),
 * disambiguating strictly by which end carries the 4-digit year — so
 * `03-04-2025` is 3 April 2025, never April 2025-03.
 */
export function normalizeYmd(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  const parts = s.split(/[-./]/).map((p) => p.trim());
  if (parts.length !== 3) return null;
  let y: string, mo: string, d: string;
  if (/^\d{4}$/.test(parts[0])) {
    // YYYY-MM-DD
    [y, mo, d] = parts;
  } else if (/^\d{4}$/.test(parts[2])) {
    // DD-MM-YYYY
    [d, mo, y] = parts;
  } else {
    return null;
  }
  if (!/^\d{1,2}$/.test(mo) || !/^\d{1,2}$/.test(d)) return null;
  const canonical = `${y}-${pad2(Number(mo))}-${pad2(Number(d))}`;
  return parseYmd(canonical) ? canonical : null;
}
