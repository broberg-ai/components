/**
 * @broberg/feature-stats — which features are actually used (F089).
 *
 * AGGREGATE COUNTS, NOTHING ELSE. A row is `(feature, day, count)`: no user
 * id, no session, no IP, no path, no cookie. Same line the fleet drew for
 * @broberg/device-stats (D-aaf46c): a named person plus what they did is
 * personal data, and on a health site it is special-category data. A count of
 * `export.pdf` on a day is neither, and it answers the product question — is
 * this feature used, and which ones never are.
 *
 * Framework-free and zero-dep. Per-stack bindings live on /hono, /next and
 * /client; persistence on createSqlFeatureStore (./sql).
 */

export { createSqlFeatureStore } from './sql.js';
export type { SqlExecutor, SqlFeatureStore, SqlFeatureStoreOptions } from './sql.js';

/** One stored counter: how often `feature` was used on UTC `day` (YYYY-MM-DD). */
export interface FeatureRow {
  feature: string;
  day: string;
  count: number;
}

export interface ReadOptions {
  /** first day to include, `YYYY-MM-DD`, inclusive */
  since?: string;
  /** last day to include, `YYYY-MM-DD`, inclusive */
  until?: string;
}

/**
 * Where counters live. Two methods, so any database can back it. `increment`
 * must ADD `by` to the existing count — an overwrite loses every earlier use.
 */
export interface FeatureStore {
  increment(feature: string, day: string, by: number): void | Promise<void>;
  read(opts?: ReadOptions): FeatureRow[] | Promise<FeatureRow[]>;
}

/**
 * A feature key: lowercase, digits, `.`, `_`, `-`, 1–64 chars, not starting
 * with punctuation. Checked at runtime as well as by the type, because a
 * browser beacon arrives untyped.
 */
export const FEATURE_KEY = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/**
 * The ONE list of feature keys, typed. `as const` keeps the literals so
 * `track('exprot.pdf')` is a compile error rather than a silent new row.
 * Throws on a malformed or duplicate key — at startup, where it is cheap.
 */
export function defineFeatures<const T extends readonly string[]>(keys: T): T {
  const seen = new Set<string>();
  for (const k of keys) {
    if (!FEATURE_KEY.test(k)) throw new Error(`feature-stats: invalid feature key ${JSON.stringify(k)}`);
    if (seen.has(k)) throw new Error(`feature-stats: duplicate feature key ${JSON.stringify(k)}`);
    seen.add(k);
  }
  return keys;
}

export interface FeatureStatsOptions<T extends readonly string[]> {
  features: T;
  store: FeatureStore;
  /** Store failures and refused keys land here. Never thrown at the caller. */
  onError?: (err: unknown) => void;
  /** Clock, for tests. Defaults to `() => new Date()`. */
  now?: () => Date;
}

export interface FeatureStats<F extends string> {
  /**
   * Count one use (or `n`). FIRE-AND-FORGET: returns immediately, never
   * throws, never waits on the store. Measuring a feature must not be able to
   * break it.
   */
  track(feature: F, n?: number): void;
  /**
   * The untyped door, for input from outside the program (a beacon body).
   * Returns false — and records nothing — for anything not in the declared
   * list, so a key like `open-doc-<userId>` can never become a row.
   */
  trackUnknown(feature: unknown, n?: number): boolean;
  /** Is this one of the declared keys? */
  isFeature(value: unknown): value is F;
  read(opts?: ReadOptions): Promise<FeatureRow[]>;
  readonly features: readonly F[];
}

/** UTC calendar day of `d` as `YYYY-MM-DD`. Storage is UTC by fleet rule. */
export function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function createFeatureStats<const T extends readonly string[]>(
  opts: FeatureStatsOptions<T>,
): FeatureStats<T[number]> {
  const declared = new Set<string>(defineFeatures(opts.features));
  const onError = opts.onError ?? (() => {});
  const now = opts.now ?? (() => new Date());

  const isFeature = (value: unknown): value is T[number] =>
    typeof value === 'string' && declared.has(value);

  const record = (feature: string, n: number): void => {
    try {
      const out = opts.store.increment(feature, utcDay(now()), n);
      if (out && typeof (out as Promise<void>).catch === 'function') {
        (out as Promise<void>).catch(onError);
      }
    } catch (err) {
      onError(err);
    }
  };

  const trackUnknown = (feature: unknown, n = 1): boolean => {
    if (!isFeature(feature)) {
      onError(new Error(`feature-stats: refused undeclared feature ${JSON.stringify(String(feature)).slice(0, 80)}`));
      return false;
    }
    if (!Number.isInteger(n) || n < 1) {
      onError(new Error(`feature-stats: refused count ${String(n)} for ${feature}`));
      return false;
    }
    record(feature, n);
    return true;
  };

  return {
    track: (feature, n = 1) => {
      trackUnknown(feature, n);
    },
    trackUnknown,
    isFeature,
    read: async (o) => opts.store.read(o),
    features: [...opts.features] as readonly T[number][],
  };
}

/** In-memory store, for tests and SSR. Lost on restart — use the SQL store in production. */
export function createMemoryFeatureStore(): FeatureStore {
  const counts = new Map<string, FeatureRow>();
  return {
    increment(feature, day, by) {
      const key = `${day}\u0000${feature}`;
      const row = counts.get(key);
      if (row) row.count += by;
      else counts.set(key, { feature, day, count: by });
    },
    read(o = {}) {
      return [...counts.values()]
        .filter((r) => (!o.since || r.day >= o.since) && (!o.until || r.day <= o.until))
        .map((r) => ({ ...r }))
        .sort((a, b) => a.day.localeCompare(b.day) || a.feature.localeCompare(b.feature));
    },
  };
}

export interface FeatureTotal {
  feature: string;
  count: number;
}

/**
 * Total per declared feature over `rows`, INCLUDING features with zero uses —
 * the zeros are the answer to "what could we remove". Sorted by count
 * descending, then name. Rows for keys no longer declared are ignored.
 */
export function summarize(rows: readonly FeatureRow[], features: readonly string[]): FeatureTotal[] {
  const totals = new Map<string, number>(features.map((f) => [f, 0]));
  for (const r of rows) {
    const t = totals.get(r.feature);
    if (t !== undefined) totals.set(r.feature, t + r.count);
  }
  return [...totals]
    .map(([feature, count]) => ({ feature, count }))
    .sort((a, b) => b.count - a.count || a.feature.localeCompare(b.feature));
}
