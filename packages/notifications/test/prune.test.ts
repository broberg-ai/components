// F074.6 — prune: two clocks, a count floor, the subscriber's own value, and
// the same choreography as every other mutation.
import { describe, expect, it } from 'vitest';
import { createMemoryStore, createNotifications } from '../src/index.js';
import type { NotificationRow, NotificationStore, PrunePolicy } from '../src/types.js';

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;
const row = (id: string, ageDays: number, seen: boolean): NotificationRow => ({
  id, kind: 'k', title: id, body: null, navigate: null, refId: null,
  createdAt: NOW - ageDays * DAY, seenAt: seen ? NOW - ageDays * DAY + 1 : null,
});
const POLICY: PrunePolicy = { seenOlderThanMs: 10 * DAY, unseenOlderThanMs: 60 * DAY, keepNewest: 0 };

async function setup(seed: Record<string, NotificationRow[]>, extra: Partial<Parameters<typeof createNotifications>[0]> = {}) {
  const store = createMemoryStore();
  for (const [s, rows] of Object.entries(seed)) for (const r of rows) await store.insert(s, r);
  const announced: [string, number][] = [];
  const n = createNotifications({ store, onCountChanged: (s, c) => { announced.push([s, c]); }, ...extra });
  return { store, n, announced };
}

describe('two lifetimes, not one (AC0)', () => {
  it('a SEEN row past X goes, an UNSEEN row of the same age stays (its errand is not done)', async () => {
    const { store, n } = await setup({ u1: [row('seen-old', 20, true), row('unseen-old', 20, false), row('seen-new', 2, true)] });
    const r = await n.prune(['u1'], POLICY, { now: NOW });
    expect(r).toMatchObject({ ran: true, pruned: [{ subjectId: 'u1', removedIds: ['seen-old'] }] });
    expect(store.rows('u1').map((x) => x.id).sort()).toStrictEqual(['seen-new', 'unseen-old']);
  });

  it('an UNSEEN row past Y goes too', async () => {
    const { store, n } = await setup({ u1: [row('unseen-ancient', 90, false), row('unseen-old', 20, false)] });
    await n.prune(['u1'], POLICY, { now: NOW });
    expect(store.rows('u1').map((x) => x.id)).toStrictEqual(['unseen-old']);
  });

  it('the type has no single cutoff to pass by accident', () => {
    // @ts-expect-error one age for everything is not a PrunePolicy
    const one: PrunePolicy = { olderThanMs: 30 * DAY, keepNewest: 0 };
    expect(one).toBeDefined();
  });
});

describe('the subscriber\'s own retention is read on every prune (AC1)', () => {
  it('a non-default value is honoured — proven by the surviving rows, not by ok', async () => {
    const { store, n } = await setup(
      { keeps: [row('a', 20, true), row('b', 5, true)], deflt: [row('c', 20, true), row('d', 5, true)] },
      { retentionFor: (s) => (s === 'keeps' ? { seenOlderThanMs: 30 * DAY } : undefined) },
    );
    await n.prune(['keeps', 'deflt'], POLICY, { now: NOW });
    expect(store.rows('keeps').map((x) => x.id)).toStrictEqual(['a', 'b']); // 30 days: 20-day-old row survives
    expect(store.rows('deflt').map((x) => x.id)).toStrictEqual(['d']);      // default 10 days: it goes
  });

  it('...and it is read AGAIN on the next prune, never cached', async () => {
    let days = 30;
    const { store, n } = await setup({ u: [row('a', 20, true)] }, { retentionFor: () => ({ seenOlderThanMs: days * DAY }) });
    await n.prune(['u'], POLICY, { now: NOW });
    expect(store.rows('u')).toHaveLength(1);
    days = 15;
    await n.prune(['u'], POLICY, { now: NOW });
    expect(store.rows('u')).toHaveLength(0);
  });
});

describe('pruning announces the STORE\'s recount (AC2, AC3)', () => {
  it('announces with a number arithmetic on the pruned ids could not produce', async () => {
    const mem = createMemoryStore();
    for (const r of [row('old', 20, true), row('x', 1, false)]) await mem.insert('u', r);
    const store: NotificationStore = { ...mem, countUnseen: async () => 41 };
    const announced: number[] = [];
    const n = createNotifications({ store, onCountChanged: (_s, c) => { announced.push(c); } });
    const r = await n.prune(['u'], POLICY, { now: NOW });
    expect(announced).toStrictEqual([41]);
    expect(r).toMatchObject({ ran: true, pruned: [{ subjectId: 'u', count: 41 }] });
  });

  it('a prune that removes only ALREADY-SEEN rows still announces', async () => {
    const { n, announced } = await setup({ u: [row('seen-old', 20, true), row('unseen', 1, false)] });
    await n.prune(['u'], POLICY, { now: NOW });
    expect(announced).toStrictEqual([['u', 1]]);
  });

  it('«nothing matched» and «could not run» are two different answers, neither silent', async () => {
    const { n, announced } = await setup({ u: [row('fresh', 1, true)] });
    expect(await n.prune(['u'], POLICY, { now: NOW })).toStrictEqual({ ran: true, pruned: [], untouched: ['u'] });
    expect(announced).toStrictEqual([]);
    const { prune: _drop, ...noPrune } = createMemoryStore();
    const m = createNotifications({ store: noPrune as NotificationStore, onCountChanged: () => {} });
    expect(await m.prune(['u'], POLICY)).toStrictEqual({ ran: false, reason: 'this store does not implement prune(), so nothing was pruned' });
  });
});

describe('a sweep of THREE subjects where only TWO lose rows announces exactly twice (AC8)', () => {
  it('the swept set and the affected set differ', async () => {
    const { n, announced } = await setup({
      a: [row('a-old', 20, true)],
      b: [row('b-new', 1, true)], // swept, loses nothing
      c: [row('c-old', 20, true), row('c-new', 1, false)],
    });
    const r = await n.prune(['a', 'b', 'c'], POLICY, { now: NOW });
    expect(announced.map(([s]) => s)).toStrictEqual(['a', 'c']);
    expect(r).toMatchObject({ ran: true, untouched: ['b'] });
  });
});

describe('batches — the consumer chooses the size, and announcements come per batch (AC9)', () => {
  it('batchSize 2 over 5 affected subjects: store.prune is called per batch, each batch announced before the next', async () => {
    const mem = createMemoryStore();
    for (const s of ['s1', 's2', 's3', 's4', 's5']) await mem.insert(s, row(`${s}-old`, 20, true));
    const events: string[] = [];
    const store: NotificationStore = {
      ...mem,
      prune: async (batch) => { events.push(`prune ${batch.map((b) => b.subjectId).join(',')}`); return mem.prune!(batch); },
    };
    const n = createNotifications({ store, onCountChanged: (s) => { events.push(`announce ${s}`); } });
    await n.prune(['s1', 's2', 's3', 's4', 's5'], POLICY, { now: NOW, batchSize: 2 });
    expect(events).toStrictEqual([
      'prune s1,s2', 'announce s1', 'announce s2',
      'prune s3,s4', 'announce s3', 'announce s4',
      'prune s5', 'announce s5',
    ]);
  });
});

describe('the COUNT floor holds independently of the ages (AC10)', () => {
  it('every row expired: the newest N still stay', async () => {
    const { store, n } = await setup({ small: [row('r1', 400, true), row('r2', 300, false), row('r3', 200, true), row('r4', 100, true)] });
    await n.prune(['small'], { ...POLICY, keepNewest: 2 }, { now: NOW });
    expect(store.rows('small').map((x) => x.id).sort()).toStrictEqual(['r3', 'r4']);
  });
});

describe('through the path a real consumer uses (AC7) — a nightly cleanup job, not a direct call', () => {
  // Entered where fd-sundhed's api/cron/notification-cleanup enters: a job that
  // reads its numbers from ENV STRINGS and its subscriber list from its own
  // table, then calls notifications.prune. Strings, because that is what the
  // real caller holds — xrt81's prefix bug passed five unit tests that called
  // the function with a value the real caller never sends.
  async function cleanupJob(env: Record<string, string>, members: { id: string }[], notifications: ReturnType<typeof createNotifications>, now: number) {
    const policy: PrunePolicy = {
      seenOlderThanMs: Number(env.NOTIF_SEEN_DAYS) * DAY,
      unseenOlderThanMs: Number(env.NOTIF_UNSEEN_DAYS) * DAY,
      keepNewest: Number(env.NOTIF_KEEP_NEWEST),
    };
    if (![policy.seenOlderThanMs, policy.unseenOlderThanMs, policy.keepNewest].every(Number.isFinite)) throw new Error('cleanup: prune numbers missing from env');
    return notifications.prune(members.map((m) => m.id), policy, { now, batchSize: Number(env.NOTIF_BATCH ?? 100) });
  }

  it('env-configured job prunes, honours a member\'s own setting, and announces', async () => {
    const { store, n, announced } = await setup(
      { m1: [row('old', 40, true), row('keep', 1, false)], m2: [row('old2', 40, true)] },
      { retentionFor: (s) => (s === 'm2' ? { seenOlderThanMs: 90 * DAY } : undefined) },
    );
    const r = await cleanupJob({ NOTIF_SEEN_DAYS: '30', NOTIF_UNSEEN_DAYS: '90', NOTIF_KEEP_NEWEST: '0', NOTIF_BATCH: '1' }, [{ id: 'm1' }, { id: 'm2' }], n, NOW);
    expect(store.rows('m1').map((x) => x.id)).toStrictEqual(['keep']);
    expect(store.rows('m2').map((x) => x.id)).toStrictEqual(['old2']);
    expect(announced).toStrictEqual([['m1', 1]]);
    expect(r).toMatchObject({ ran: true, untouched: ['m2'] });
  });

  it('a job with its numbers missing from env refuses instead of pruning on NaN', async () => {
    const { n } = await setup({ m1: [row('old', 40, true)] });
    await expect(cleanupJob({}, [{ id: 'm1' }], n, NOW)).rejects.toThrow(/missing from env/);
  });
});
