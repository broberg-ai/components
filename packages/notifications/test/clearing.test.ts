// F074.1 — what a clearing call gives back, and what it must never give back.
//
// The surface highlights "what just cleared" from this set, so a requested id
// that did not transition would point the user at rows they never had.
import { describe, it, expect } from 'vitest';
import { createNotifications, createMemoryStore } from '../src/index.js';
import type { NotificationRow } from '../src/types.js';

const row = (over: Partial<NotificationRow> = {}): NotificationRow => ({
  id: 'n1', kind: 'chat', title: 't', body: null,
  navigate: '/x', refId: null, createdAt: 1, seenAt: null, ...over,
});

async function seeded() {
  const store = createMemoryStore();
  const n = createNotifications({ store, onCountChanged: () => {} });
  await store.insert('mine', row({ id: 'unseen', seenAt: null }));
  await store.insert('mine', row({ id: 'already', seenAt: 999 }));
  await store.insert('theirs', row({ id: 'foreign', seenAt: null }));
  return { store, n };
}

describe('F074.1 — clearedIds is the TRANSITION, never the request', () => {
  it('markSeen returns only the ids that went from unseen to seen', async () => {
    const { n } = await seeded();
    // A mixed batch on purpose: one clearable, one already seen, one belonging
    // to somebody else. All three are passed EXPLICITLY.
    const { clearedIds } = await n.markSeen('mine', ['unseen', 'already', 'foreign']);
    expect(clearedIds).toEqual(['unseen']);
  });

  it('markAllSeen returns only this call\'s transitions, and the second call is empty', async () => {
    const { n } = await seeded();
    expect((await n.markAllSeen('mine')).clearedIds).toEqual(['unseen']);
    // The set exists exactly ONCE. This is why the caller must hold it for the
    // visit: there is no way to ask for it again.
    expect((await n.markAllSeen('mine')).clearedIds).toEqual([]);
  });

  it('another subject\'s rows are untouched by markAllSeen', async () => {
    const { store, n } = await seeded();
    await n.markAllSeen('mine');
    expect(store.rows('theirs')[0]!.seenAt).toBeNull();
  });

  it('every clear also returns the fresh count, so no client decrements its own', async () => {
    const { n } = await seeded();
    const res = await n.markAllSeen('mine');
    expect(res).toEqual({ clearedIds: ['unseen'], count: 0 });
  });
});

describe('F074.1 — markSeenByRef needs all three to match', () => {
  async function refFixture() {
    const store = createMemoryStore();
    const n = createNotifications({ store, onCountChanged: () => {} });
    await store.insert('mine', row({ id: 'hit', kind: 'ny-film', refId: 'drive-1' }));
    await store.insert('mine', row({ id: 'wrong-kind', kind: 'chat', refId: 'drive-1' }));
    await store.insert('mine', row({ id: 'wrong-ref', kind: 'ny-film', refId: 'drive-2' }));
    await store.insert('theirs', row({ id: 'wrong-subject', kind: 'ny-film', refId: 'drive-1' }));
    return { store, n };
  }

  it('clears the matching row', async () => {
    const { n } = await refFixture();
    expect((await n.markSeenByRef('mine', ['ny-film'], 'drive-1')).clearedIds).toEqual(['hit']);
  });

  // The negative controls carry the weight here: nothing FAILS when this rule is
  // wrong. The bell simply keeps promising something the user already read.
  it.each([
    ['same refId, wrong kind', 'mine', ['ny-film'], 'drive-1', 'wrong-kind'],
    ['same kind, wrong refId', 'mine', ['ny-film'], 'drive-1', 'wrong-ref'],
  ])('%s stays unseen', async (_n, subject, kinds, refId, survivor) => {
    const { store, n } = await refFixture();
    await n.markSeenByRef(subject, kinds as string[], refId as string);
    expect(store.rows('mine').find((r) => r.id === survivor)!.seenAt).toBeNull();
  });

  it('a matching row belonging to another subject stays unseen', async () => {
    const { store, n } = await refFixture();
    await n.markSeenByRef('mine', ['ny-film'], 'drive-1');
    expect(store.rows('theirs')[0]!.seenAt).toBeNull();
  });

  it('several kinds may be cleared at once', async () => {
    const { n } = await refFixture();
    const { clearedIds } = await n.markSeenByRef('mine', ['ny-film', 'chat'], 'drive-1');
    expect(clearedIds.sort()).toEqual(['hit', 'wrong-kind']);
  });
});
