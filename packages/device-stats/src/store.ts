/**
 * SQL persistence for device counts (F078.6).
 *
 * Same shape as @broberg/feature-stats' createSqlFeatureStore, on purpose: a
 * consumer that already runs one learns nothing new to run the other. It takes
 * anything with `execute({ sql, args })` — @broberg/db-sdk's DbClient and a raw
 * libSQL `Client` both fit structurally — so there is no driver here. The
 * interface is COPIED rather than imported: coupling two analytics packages for
 * a three-line type would make every device-stats consumer install
 * feature-stats.
 *
 * One row per day × formFactor × os family × browser family × launch. Nothing
 * else is a column — no path, URL, user or session (D-aaf46c) — and no version
 * or screen bucket either: those make the combination narrower than a count
 * needs, and the anonymous counter is what lets this run without a consent
 * prompt.
 *
 * The upsert ADDS: `count = count + excluded.count`. An overwrite would lose
 * every earlier visit of the day and still look right in any test that counts
 * once.
 */
import type { DeviceFacts, FormFactor, Launch } from "./index";

export interface SqlExecutor {
  execute(stmt: { sql: string; args?: Array<string | number> }): Promise<{ rows: ArrayLike<Record<string, unknown>> }>;
}

export interface SqlDeviceStoreOptions {
  dialect: "sqlite" | "postgres";
  /** Table name. Default `device_stats`. Validated — it is interpolated into SQL. */
  table?: string;
}

export interface DeviceRow {
  /** `YYYY-MM-DD`, chosen by the caller (the store has no clock). */
  day: string;
  formFactor: FormFactor;
  os: string;
  browser: string;
  launch: Launch;
  count: number;
}

export interface DeviceReadOptions {
  /** Inclusive, `YYYY-MM-DD`. */
  since?: string;
  /** Inclusive, `YYYY-MM-DD`. */
  until?: string;
}

export interface SqlDeviceStore {
  /** Create the table if missing. Idempotent. */
  migrate(): Promise<void>;
  /** Count one (or `by`) visit with these facts on `day`. */
  increment(facts: DeviceFacts, day: string, by?: number): Promise<void>;
  read(opts?: DeviceReadOptions): Promise<DeviceRow[]>;
}

const TABLE_NAME = /^[a-z_][a-z0-9_]*$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function createSqlDeviceStore(db: SqlExecutor, opts: SqlDeviceStoreOptions): SqlDeviceStore {
  const table = opts.table ?? "device_stats";
  if (!TABLE_NAME.test(table)) throw new Error(`device-stats: invalid table name ${JSON.stringify(table)}`);
  const pg = opts.dialect === "postgres";
  const p = (i: number): string => (pg ? `$${i}` : "?");

  return {
    async migrate() {
      await db.execute({
        sql:
          `CREATE TABLE IF NOT EXISTS ${table} (` +
          `day TEXT NOT NULL, form_factor TEXT NOT NULL, os TEXT NOT NULL, browser TEXT NOT NULL, launch TEXT NOT NULL, ` +
          `count ${pg ? "BIGINT" : "INTEGER"} NOT NULL, ` +
          `PRIMARY KEY (day, form_factor, os, browser, launch))`,
      });
    },

    async increment(facts, day, by = 1) {
      if (!DAY.test(day)) throw new Error(`device-stats: day must be YYYY-MM-DD, got ${JSON.stringify(day)}`);
      await db.execute({
        sql:
          `INSERT INTO ${table} (day, form_factor, os, browser, launch, count) ` +
          `VALUES (${p(1)}, ${p(2)}, ${p(3)}, ${p(4)}, ${p(5)}, ${p(6)}) ` +
          `ON CONFLICT (day, form_factor, os, browser, launch) DO UPDATE SET count = ${table}.count + excluded.count`,
        args: [day, facts.formFactor, facts.os.family, facts.browser.family, facts.launch, by],
      });
    },

    async read(o = {}) {
      const where: string[] = [];
      const args: string[] = [];
      if (o.since) {
        args.push(o.since);
        where.push(`day >= ${p(args.length)}`);
      }
      if (o.until) {
        args.push(o.until);
        where.push(`day <= ${p(args.length)}`);
      }
      const { rows } = await db.execute({
        sql:
          `SELECT day, form_factor, os, browser, launch, count FROM ${table}` +
          (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
          " ORDER BY day, form_factor, os, browser, launch",
        args,
      });
      // Postgres BIGINT comes back as a string from most drivers; normalise.
      return Array.from(rows, (r) => ({
        day: String(r.day),
        formFactor: String(r.form_factor) as FormFactor,
        os: String(r.os),
        browser: String(r.browser),
        launch: String(r.launch) as Launch,
        count: Number(r.count),
      }));
    },
  };
}

export interface DeviceSummary {
  total: number;
  formFactor: Record<string, number>;
  os: Record<string, number>;
  browser: Record<string, number>;
  launch: Record<string, number>;
}

/** Totals per dimension over whatever rows you pass (filter by day with `read`). */
export function summarize(rows: readonly DeviceRow[]): DeviceSummary {
  const out: DeviceSummary = { total: 0, formFactor: {}, os: {}, browser: {}, launch: {} };
  const add = (bucket: Record<string, number>, key: string, n: number) => {
    bucket[key] = (bucket[key] ?? 0) + n;
  };
  for (const r of rows) {
    out.total += r.count;
    add(out.formFactor, r.formFactor, r.count);
    add(out.os, r.os, r.count);
    add(out.browser, r.browser, r.count);
    add(out.launch, r.launch, r.count);
  }
  return out;
}
