// F089.2 — counters survive a restart. Proven against a REAL libSQL file DB,
// read back through a FRESH store instance on a FRESH client, because reading
// through the object that wrote is exactly what lies.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { afterAll, describe, expect, it } from 'vitest';
import { createSqlFeatureStore, type SqlExecutor } from '../src/index.js';

const dir = mkdtempSync(join(tmpdir(), 'feature-stats-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('sqlite (libSQL file)', () => {
  it('three increments, read back by a fresh client, is exactly 3', async () => {
    const url = `file:${join(dir, 'a.db')}`;
    const writer = createSqlFeatureStore(createClient({ url }), { dialect: 'sqlite' });
    await writer.migrate();
    await writer.migrate(); // idempotent
    for (let i = 0; i < 3; i++) await writer.increment('export.pdf', '2026-10-01', 1);
    await writer.increment('chat.send', '2026-09-30', 4);

    const reader = createSqlFeatureStore(createClient({ url }), { dialect: 'sqlite' });
    expect(await reader.read()).toEqual([
      { feature: 'chat.send', day: '2026-09-30', count: 4 },
      { feature: 'export.pdf', day: '2026-10-01', count: 3 },
    ]);
    expect(await reader.read({ since: '2026-10-01' })).toEqual([{ feature: 'export.pdf', day: '2026-10-01', count: 3 }]);
    expect(await reader.read({ until: '2026-09-30' })).toEqual([{ feature: 'chat.send', day: '2026-09-30', count: 4 }]);
  });

  it('a custom table name works and an unsafe one is refused at construction', async () => {
    const db = createClient({ url: `file:${join(dir, 'b.db')}` });
    const s = createSqlFeatureStore(db, { dialect: 'sqlite', table: 'app_usage' });
    await s.migrate();
    await s.increment('x', '2026-10-01', 2);
    expect(await s.read()).toEqual([{ feature: 'x', day: '2026-10-01', count: 2 }]);
    expect(() => createSqlFeatureStore(db, { dialect: 'sqlite', table: 'x; DROP TABLE y' })).toThrow(/invalid table name/);
  });
});

describe('postgres dialect — the exact SQL', () => {
  it('uses $n placeholders and the same adding upsert', async () => {
    const seen: Array<{ sql: string; args?: unknown[] }> = [];
    const db: SqlExecutor = { execute: async (s) => { seen.push(s); return { rows: [{ feature: 'a', day: '2026-10-01', count: '7' }] }; } };
    const s = createSqlFeatureStore(db, { dialect: 'postgres' });
    await s.migrate();
    await s.increment('a', '2026-10-01', 1);
    const rows = await s.read({ since: '2026-09-01', until: '2026-10-31' });
    expect(seen[0]!.sql).toBe(
      'CREATE TABLE IF NOT EXISTS feature_stats (feature TEXT NOT NULL, day TEXT NOT NULL, count BIGINT NOT NULL, PRIMARY KEY (feature, day))',
    );
    expect(seen[1]).toEqual({
      sql: 'INSERT INTO feature_stats (feature, day, count) VALUES ($1, $2, $3) ON CONFLICT (feature, day) DO UPDATE SET count = feature_stats.count + excluded.count',
      args: ['a', '2026-10-01', 1],
    });
    expect(seen[2]).toEqual({
      sql: 'SELECT feature, day, count FROM feature_stats WHERE day >= $1 AND day <= $2 ORDER BY day, feature',
      args: ['2026-09-01', '2026-10-31'],
    });
    // BIGINT arrives as a string from pg drivers; the store normalises it.
    expect(rows).toEqual([{ feature: 'a', day: '2026-10-01', count: 7 }]);
  });
});

// The plan-doc claims @broberg/db-sdk's DbClient fits without a cast. Proven,
// not asserted: this line fails tsc if the structural interface drifts.
import { createClient as createDbSdkClient } from '@broberg/db-sdk';

describe('@broberg/db-sdk DbClient plugs in as-is', () => {
  it('writes and reads back through db-sdk (libsql transport)', async () => {
    const url = `file:${join(dir, 'c.db')}`;
    const w = createSqlFeatureStore(createDbSdkClient({ url }), { dialect: 'sqlite' });
    await w.migrate();
    await w.increment('share.link', '2026-10-01', 2);
    await w.increment('share.link', '2026-10-01', 1);
    const r = createSqlFeatureStore(createDbSdkClient({ url }), { dialect: 'sqlite' });
    expect(await r.read()).toEqual([{ feature: 'share.link', day: '2026-10-01', count: 3 }]);
  });
});
