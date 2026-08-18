// F074.1 — the package IS the choreography, so the tests assert on what reaches
// the store and the callback, never on a return value alone.
//
// That rule is not stylistic. A consumer's sender passed its own field names to
// @broberg/webpush's buildPayload, so every message would have arrived EMPTY —
// and FOUR mutations survived it, because the suite only ever read send()'s
// return value and never the body that went over the wire.
import { describe, it, expect, vi } from 'vitest';
import { createNotifications, createMemoryStore } from '../src/index.js';
import type { NotificationRow, NotificationStore } from '../src/types.js';

const row = (over: Partial<NotificationRow> = {}): NotificationRow => ({
  id: 'n1', kind: 'chat', title: 'Ny besked', body: null,
  navigate: '/chat/1', refId: null, createdAt: 1, seenAt: null, ...over,
});

describe('F074.1 — the core never computes a count itself', () => {
  it('returns and announces the STORE\'s number, not one derived from the rows', async () => {
    // The store genuinely holds 3 unseen rows. Its counting function says 7 —
    // which is what a real muted-kind filter does: it makes the count disagree
    // with a naive row tally ON PURPOSE. Measured on cardmem production
    // 2026-08-18: raw_unseen=50, shown count=1.
    const store = createMemoryStore();
    for (const id of ['a', 'b', 'c']) await store.insert('u1', row({ id }));
    const seen: number[] = [];
    const notifications = createNotifications({
      store: { ...store, countUnseen: async () => 7 },
      onCountChanged: (_s, count) => void seen.push(count),
    });

    expect(await store.countUnseen('u1')).toBe(3);   // the rows really say 3
    expect(await notifications.unseenCount('u1')).toBe(7);

    await notifications.notify('u1', row({ id: 'd' }));
    await notifications.markAllSeen('u1');
    expect(seen).toEqual([7, 7]);
  });
});

describe('F074.1 — every mutation recounts, then announces, exactly once', () => {
  /** A store that logs each call, so ORDER can be asserted rather than assumed. */
  function tracingStore() {
    const log: string[] = [];
    const inner = createMemoryStore();
    const store: NotificationStore = {
      insert: async (s, r) => { log.push('insert'); return inner.insert(s, r); },
      countUnseen: async (s) => { log.push('countUnseen'); return inner.countUnseen(s); },
      markSeen: async (s, i) => { log.push('markSeen'); return inner.markSeen(s, i); },
      markAllSeen: async (s) => { log.push('markAllSeen'); return inner.markAllSeen(s); },
      markSeenByRef: async (s, k, r) => { log.push('markSeenByRef'); return inner.markSeenByRef(s, k, r); },
    };
    return { store, log };
  }

  const MUTATORS: Array<[string, (n: ReturnType<typeof createNotifications>) => Promise<unknown>]> = [
    ['notify', (n) => n.notify('u1', row())],
    ['markSeen', (n) => n.markSeen('u1', ['n1'])],
    ['markAllSeen', (n) => n.markAllSeen('u1')],
    ['markSeenByRef', (n) => n.markSeenByRef('u1', ['chat'], 'r1')],
  ];

  it.each(MUTATORS)('%s writes, THEN recounts, THEN announces', async (name, run) => {
    const { store, log } = tracingStore();
    const onCountChanged = vi.fn(async () => { log.push('onCountChanged'); });
    await run(createNotifications({ store, onCountChanged }));

    expect(onCountChanged).toHaveBeenCalledTimes(1);
    // The write must be OBSERVED before the count, and the count before the
    // announce. A callback racing the write announces a number for a row that
    // may not exist yet.
    expect(log.indexOf('countUnseen')).toBeGreaterThan(0);
    expect(log.at(-1)).toBe('onCountChanged');
    expect(log.at(-2)).toBe('countUnseen');
  });

  it('unseenCount is a READ — it must not announce anything', async () => {
    const onCountChanged = vi.fn();
    const n = createNotifications({ store: createMemoryStore(), onCountChanged });
    await n.unseenCount('u1');
    expect(onCountChanged).not.toHaveBeenCalled();
  });
});

describe('F074.1 — a failed write must not announce', () => {
  // The inverse of the defect, and just as silent: every device left showing a
  // number for a row that was never written.
  const boom = new Error('db down');

  it.each([
    ['notify', { insert: async () => { throw boom; } }, (n: any) => n.notify('u1', row())],
    ['markSeen', { markSeen: async () => { throw boom; } }, (n: any) => n.markSeen('u1', ['n1'])],
    ['markAllSeen', { markAllSeen: async () => { throw boom; } }, (n: any) => n.markAllSeen('u1')],
    ['markSeenByRef', { markSeenByRef: async () => { throw boom; } }, (n: any) => n.markSeenByRef('u1', ['chat'], 'r1')],
  ])('%s propagates the error and stays silent', async (_name, override, run) => {
    const onCountChanged = vi.fn();
    const n = createNotifications({
      store: { ...createMemoryStore(), ...(override as object) } as NotificationStore,
      onCountChanged,
    });
    await expect(run(n)).rejects.toThrow('db down');
    expect(onCountChanged).not.toHaveBeenCalled();
  });
});

describe('F074.1 — notify refuses a message that would render as nothing', () => {
  it.each([undefined, null, '', '   '])('rejects title %j, naming the field', async (title) => {
    const onCountChanged = vi.fn();
    const store = createMemoryStore();
    const n = createNotifications({ store, onCountChanged });
    await expect(n.notify('u1', row({ title: title as string }))).rejects.toThrow(/title/);
    // Nothing written, nothing announced — the refusal is total.
    expect(store.rows('u1')).toHaveLength(0);
    expect(onCountChanged).not.toHaveBeenCalled();
  });

  it('accepts a null body — only the title is load-bearing', async () => {
    const store = createMemoryStore();
    const n = createNotifications({ store, onCountChanged: () => {} });
    await expect(n.notify('u1', row({ body: null }))).resolves.toEqual({ count: 1 });
  });
});

describe('F074.1 — the server-only write path, with no client anywhere', () => {
  it('notify() writes and announces with nothing open, nothing subscribed', async () => {
    // moovyy's NORMAL state, not a corner case: a background watcher compares
    // Drive against what is known and writes a row with no tab, no foreground
    // app, and a locked phone. A suite that only ever runs with a live client
    // leaves one of three consumers untested exactly where they live.
    const store = createMemoryStore();
    const carried: Array<[string, number]> = [];
    const n = createNotifications({
      store,
      // The whole fan-out: no SSE subscriber, no socket, nobody listening. The
      // consumer's silent push hangs off precisely this call.
      onCountChanged: (subjectId, count) => void carried.push([subjectId, count]),
    });

    await n.notify('u1', row({ id: 'film-1', kind: 'ny-film', title: 'Dune', refId: 'drive-abc' }));

    expect(store.rows('u1')).toHaveLength(1);
    expect(carried).toEqual([['u1', 1]]);
  });
});
