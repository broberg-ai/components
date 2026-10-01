/**
 * SQL persistence for feature counters (F089.2).
 *
 * Takes anything with `execute({ sql, args })` — @broberg/db-sdk's DbClient
 * fits structurally, so there is no hard dependency and no driver in this
 * package. The SQL is written per dialect because db-sdk deliberately does not
 * translate it: libSQL takes `?`, Postgres takes `$1`.
 *
 * One upsert per use, and it ADDS: `count = count + excluded.count`. An
 * overwrite would lose every earlier use of the day, and would still look
 * right in any test that tracks once.
 */
import type { FeatureRow, FeatureStore, ReadOptions } from './index.js';

/**
 * The one method this store needs. `args` is narrowed to what we actually
 * send (strings and integers), which is what lets both a raw libSQL `Client`
 * and db-sdk's `DbClient` satisfy it without a cast.
 */
export interface SqlExecutor {
  execute(stmt: { sql: string; args?: Array<string | number> }): Promise<{ rows: ArrayLike<Record<string, unknown>> }>;
}

export interface SqlFeatureStoreOptions {
  dialect: 'sqlite' | 'postgres';
  /** Table name. Default `feature_stats`. Validated — it is interpolated into SQL. */
  table?: string;
}

export interface SqlFeatureStore extends FeatureStore {
  /** Create the table if missing. Idempotent. */
  migrate(): Promise<void>;
  read(opts?: ReadOptions): Promise<FeatureRow[]>;
}

const TABLE_NAME = /^[a-z_][a-z0-9_]*$/i;

export function createSqlFeatureStore(db: SqlExecutor, opts: SqlFeatureStoreOptions): SqlFeatureStore {
  const table = opts.table ?? 'feature_stats';
  if (!TABLE_NAME.test(table)) throw new Error(`feature-stats: invalid table name ${JSON.stringify(table)}`);
  const pg = opts.dialect === 'postgres';
  const p = (i: number): string => (pg ? `$${i}` : '?');

  return {
    async migrate() {
      await db.execute({
        sql:
          `CREATE TABLE IF NOT EXISTS ${table} (` +
          `feature TEXT NOT NULL, day TEXT NOT NULL, count ${pg ? 'BIGINT' : 'INTEGER'} NOT NULL, ` +
          `PRIMARY KEY (feature, day))`,
      });
    },

    async increment(feature, day, by) {
      await db.execute({
        sql:
          `INSERT INTO ${table} (feature, day, count) VALUES (${p(1)}, ${p(2)}, ${p(3)}) ` +
          `ON CONFLICT (feature, day) DO UPDATE SET count = ${table}.count + excluded.count`,
        args: [feature, day, by],
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
          `SELECT feature, day, count FROM ${table}` +
          (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
          ' ORDER BY day, feature',
        args,
      });
      // Postgres BIGINT comes back as a string from most drivers; normalise.
      return Array.from(rows, (r) => ({
        feature: String(r.feature),
        day: String(r.day),
        count: Number(r.count),
      }));
    },
  };
}
