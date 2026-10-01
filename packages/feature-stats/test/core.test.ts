// F089.1 — the core. Strict equality throughout: a `toContain` would pass on a
// count that is off by one, which is exactly the bug a counter has.
import { describe, expect, it } from 'vitest';
import { createFeatureStats, createMemoryFeatureStore, defineFeatures, summarize, type FeatureStore } from '../src/index.js';

const FEATURES = defineFeatures(['export.pdf', 'chat.send', 'share.link'] as const);
const at = (iso: string) => () => new Date(iso);

describe('track + read', () => {
  it('counts per feature per UTC day', async () => {
    const store = createMemoryFeatureStore();
    const s = createFeatureStats({ features: FEATURES, store, now: at('2026-10-01T23:30:00Z') });
    s.track('export.pdf');
    s.track('export.pdf');
    s.track('chat.send');
    expect(await s.read()).toEqual([
      { feature: 'chat.send', day: '2026-10-01', count: 1 },
      { feature: 'export.pdf', day: '2026-10-01', count: 2 },
    ]);
  });

  it('the day is UTC, not the process zone (23:30Z on the 1st is the 1st)', async () => {
    const s = createFeatureStats({ features: FEATURES, store: createMemoryFeatureStore(), now: at('2026-10-01T23:30:00Z') });
    s.track('share.link');
    expect((await s.read())[0]?.day).toBe('2026-10-01');
  });

  it('read({since, until}) filters inclusively by day', async () => {
    const store = createMemoryFeatureStore();
    for (const d of ['2026-09-29', '2026-09-30', '2026-10-01']) store.increment('chat.send', d, 1);
    const s = createFeatureStats({ features: FEATURES, store });
    expect((await s.read({ since: '2026-09-30' })).map((r) => r.day)).toEqual(['2026-09-30', '2026-10-01']);
    expect((await s.read({ until: '2026-09-30' })).map((r) => r.day)).toEqual(['2026-09-29', '2026-09-30']);
    expect((await s.read({ since: '2026-09-30', until: '2026-09-30' })).map((r) => r.day)).toEqual(['2026-09-30']);
  });
});

describe('refusal — nothing but a declared key becomes a row', () => {
  it.each([['open-doc-4711-user-99'], ['Export.PDF'], [''], ['-x'], [42], [null], ['a'.repeat(65)]])('%j', async (bad) => {
    const errors: unknown[] = [];
    const s = createFeatureStats({ features: FEATURES, store: createMemoryFeatureStore(), onError: (e) => errors.push(e) });
    expect(s.trackUnknown(bad)).toBe(false);
    (s.track as (f: unknown) => void)(bad);
    expect(await s.read()).toEqual([]);
    expect(errors.length).toBe(2);
  });

  it('a non-positive or fractional count is refused', async () => {
    const errors: unknown[] = [];
    const s = createFeatureStats({ features: FEATURES, store: createMemoryFeatureStore(), onError: (e) => errors.push(e) });
    s.track('chat.send', 0);
    s.track('chat.send', -3);
    s.track('chat.send', 1.5);
    expect(await s.read()).toEqual([]);
    expect(errors.length).toBe(3);
  });

  it('the type refuses an undeclared literal', () => {
    const s = createFeatureStats({ features: FEATURES, store: createMemoryFeatureStore() });
    // @ts-expect-error — 'exprot.pdf' is not declared
    s.track('exprot.pdf');
  });

  it('defineFeatures throws on a malformed or duplicate key', () => {
    expect(() => defineFeatures(['Bad Key'])).toThrow(/invalid feature key/);
    expect(() => defineFeatures(['a.b', 'a.b'])).toThrow(/duplicate/);
  });
});

describe('fire-and-forget — measuring a feature cannot break it', () => {
  it('a store that throws synchronously', () => {
    const errors: unknown[] = [];
    const boom = new Error('sync');
    const store: FeatureStore = { increment: () => { throw boom; }, read: () => [] };
    const s = createFeatureStats({ features: FEATURES, store, onError: (e) => errors.push(e) });
    expect(() => s.track('chat.send')).not.toThrow();
    expect(errors).toEqual([boom]);
  });

  it('a store that rejects, and never resolves in time', async () => {
    const errors: unknown[] = [];
    const boom = new Error('async');
    let reject!: (e: unknown) => void;
    const store: FeatureStore = { increment: () => new Promise((_, r) => { reject = r; }), read: () => [] };
    const s = createFeatureStats({ features: FEATURES, store, onError: (e) => errors.push(e) });
    const t = performance.now();
    s.track('chat.send');
    expect(performance.now() - t).toBeLessThan(50); // returned without waiting
    expect(errors).toEqual([]);
    reject(boom);
    await new Promise((r) => setTimeout(r, 0));
    expect(errors).toEqual([boom]);
  });
});

describe('summarize — the zeros are the answer', () => {
  it('every declared feature, zeros included, count desc then name; undeclared rows ignored', () => {
    const rows = [
      { feature: 'export.pdf', day: '2026-09-30', count: 2 },
      { feature: 'export.pdf', day: '2026-10-01', count: 3 },
      { feature: 'chat.send', day: '2026-10-01', count: 5 },
      { feature: 'removed.feature', day: '2026-10-01', count: 99 },
    ];
    expect(summarize(rows, FEATURES)).toEqual([
      { feature: 'chat.send', count: 5 },
      { feature: 'export.pdf', count: 5 },
      { feature: 'share.link', count: 0 },
    ]);
  });
});
