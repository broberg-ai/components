// F074.3 — a failing fan-out must not undo the mutation.
import { describe, it, expect, vi } from 'vitest';
import { createNotifications, createMemoryStore } from '../src/index.js';
import type { NotificationRow } from '../src/types.js';

const row = (id: string): NotificationRow => ({
  id, kind: 'chat', title: 'Ny besked', body: null,
  navigate: '/chat/1', refId: null, createdAt: 1, seenAt: null,
});


// ── F074.3 — a failing fan-out must not undo the mutation ────────────────────
//
// FILED BY moovyy after adopting 0.1.0. `settle()` awaited onCountChanged bare,
// so a dead phone or a wrong VAPID key rejected the whole notify() — AFTER the
// row was written. Their case: a downloaded film would not be booked because a
// NUMBER could not be moved, and a caller that retries then writes the row twice.
describe('F074.3 — the announcement can fail without taking the mutation with it', () => {
  const boom = () => {
    throw new Error('silent push failed: 410 Gone');
  };

  it('notify() SUCCEEDS when onCountChanged throws, and the row is still there', async () => {
    const store = createMemoryStore();
    const n = createNotifications({ store, onCountChanged: boom, onCountChangedError: () => {} });
    await expect(n.notify('u1', row('a'))).resolves.toEqual({ count: 1 });
    // The half that matters: the write stands.
    expect(await store.countUnseen('u1')).toBe(1);
  });

  it('every clearing call survives it too, and still reports what cleared', async () => {
    const store = createMemoryStore();
    const ok = createNotifications({ store, onCountChanged: () => {} });
    await ok.notify('u1', row('a'));
    const n = createNotifications({ store, onCountChanged: boom, onCountChangedError: () => {} });
    const r = await n.markAllSeen('u1');
    expect(r.clearedIds).toEqual(['a']);
    expect(r.count).toBe(0);
  });

  it('the failure is HANDED OVER, with the subject and the count it could not deliver', async () => {
    const seen: Array<[unknown, string, number]> = [];
    const store = createMemoryStore();
    const n = createNotifications({
      store,
      onCountChanged: boom,
      onCountChangedError: (err, subjectId, count) => seen.push([err, subjectId, count]),
    });
    await n.notify('u1', row('a'));
    expect(seen).toHaveLength(1);
    expect((seen[0]![0] as Error).message).toMatch(/410 Gone/);
    expect(seen[0]![1]).toBe('u1');
    expect(seen[0]![2]).toBe(1);
  });

  it('WITHOUT a handler it is NOT silent — it reaches console.error', async () => {
    // Silence here would be the package's own defect turned inward: the badge
    // and the list disagreeing with nobody told.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const n = createNotifications({ store: createMemoryStore(), onCountChanged: boom });
    await n.notify('u1', row('a'));
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it('NEGATIVE CONTROL: a working fan-out still fires, and is not swallowed', async () => {
    const calls: Array<[string, number]> = [];
    const n = createNotifications({
      store: createMemoryStore(),
      onCountChanged: (s, c) => void calls.push([s, c]),
    });
    await n.notify('u1', row('a'));
    expect(calls).toEqual([['u1', 1]]);
  });

  it('NEGATIVE CONTROL: a failing STORE still throws — only the fan-out is forgiving', async () => {
    // The mutation failing and the announcement failing are different facts, and
    // exactly one of them must still reach the caller.
    const store = createMemoryStore();
    store.insert = async () => {
      throw new Error('disk full');
    };
    const n = createNotifications({ store, onCountChanged: () => {} });
    await expect(n.notify('u1', row('a'))).rejects.toThrow(/disk full/);
  });
});
