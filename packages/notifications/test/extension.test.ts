// F074.1 — a consumer's own fields must survive without a core change.
//
// cardmem carries projectId (their chip + deep link); moovyy carries the film
// poster. If extending needed a generic parameter juggled at every call-site or
// a cast, the seam would be wrong and each consumer would fork the row.
import { describe, it, expect } from 'vitest';
import { createNotifications, createMemoryStore } from '../src/index.js';
import type { NotificationRow } from '../src/types.js';

interface CardmemRow extends NotificationRow { projectId: string | null }
interface MoovyyRow extends NotificationRow { poster: string }

describe('F074.1 — the row extends structurally', () => {
  it('cardmem\'s projectId survives notify -> read untouched', async () => {
    const store = createMemoryStore<CardmemRow>();
    const n = createNotifications({ store, onCountChanged: () => {} });
    await n.notify('u1', {
      id: 'c1', kind: 'review', title: 'Kort klar til review', body: 'F074.1',
      navigate: '/board/f074', refId: 'card-1', createdAt: 1, seenAt: null,
      projectId: 'components',
    });
    expect(store.rows('u1')[0]!.projectId).toBe('components');
  });

  it('moovyy\'s poster survives too, with no core change between them', async () => {
    const store = createMemoryStore<MoovyyRow>();
    const n = createNotifications({ store, onCountChanged: () => {} });
    await n.notify('u1', {
      id: 'm1', kind: 'ny-film', title: 'Dune', body: null,
      navigate: '/#/film/dune', refId: 'drive-abc', createdAt: 1, seenAt: null,
      poster: 'https://example.test/dune.jpg',
    });
    expect(store.rows('u1')[0]!.poster).toBe('https://example.test/dune.jpg');
  });

  it('a projectId is never consulted by the core — the badge is per SUBJECT', async () => {
    // cardmem measured this: 3 unopened in one project + 2 in another = badge 5.
    // If the core ever grew project awareness, this count would split.
    const store = createMemoryStore<CardmemRow>();
    const n = createNotifications({ store, onCountChanged: () => {} });
    const base = { kind: 'k', title: 't', body: null, navigate: '/x', refId: null, createdAt: 1, seenAt: null } as const;
    for (const [id, projectId] of [['a', 'p1'], ['b', 'p1'], ['c', 'p1'], ['d', 'p2'], ['e', 'p2']]) {
      await n.notify('u1', { ...base, id: id!, projectId: projectId! });
    }
    expect(await n.unseenCount('u1')).toBe(5);
  });
});
