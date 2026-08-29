// F074.5 — the store cannot delete.
//
// Filed by fd-sundhed out of the PUBLISHED 0.3.0 package: their bell lets a user
// DELETE a notification, not only mark it read, built after a sync sent 42 false
// messages the owner had to clear without walking the list one at a time.
//
// Adopt 0.3.0 as it stood and the deletion happens AROUND the core:
// `onCountChanged` never fires, the badge keeps its number, the list is empty.
// That is verbatim the defect this package exists to prevent, moved into the one
// corner the core did not cover — and the consumer who deletes gets the worst
// variant, because it LOOKS protected.
import { describe, expect, it, vi } from 'vitest';
import { createMemoryStore, createNotifications } from '../src/index.js';
import type { NotificationRow, NotificationStore } from '../src/types.js';

const row = (id: string, over: Partial<NotificationRow> = {}): NotificationRow => ({
  id,
  kind: 'chat',
  title: `title ${id}`,
  body: null,
  navigate: '/x',
  refId: null,
  createdAt: 1,
  seenAt: null,
  ...over,
});

/** A store WITHOUT the pair — every consumer on 0.2.x and 0.3.0. */
function storeWithoutRemove(): NotificationStore {
  const base = createMemoryStore();
  const { remove: _r, removeAll: _ra, ...rest } = base as NotificationStore & {
    rows(s: string): NotificationRow[];
  };
  return rest as NotificationStore;
}

describe('remove() runs the same choreography as mark*', () => {
  it('writes, recounts through the store, and announces — in that order', async () => {
    const store = createMemoryStore();
    const seen: number[] = [];
    const n = createNotifications({ store, onCountChanged: (_s, c) => void seen.push(c) });

    await n.notify('u1', row('a'));
    await n.notify('u1', row('b'));
    await n.notify('u1', row('c'));
    expect(seen).toEqual([1, 2, 3]);

    const res = await n.remove('u1', ['a', 'b']);

    expect(res.removedIds).toEqual(['a', 'b']);
    // The announce happened, and it happened AFTER the write: the number is the
    // one you get by counting what is left, not what was there.
    expect(seen).toEqual([1, 2, 3, 1]);
    expect(store.rows('u1').map((r) => r.id)).toEqual(['c']);
  });

  it('announces the STORE’s number, not arithmetic on the ids it was handed', async () => {
    // THE FIXTURE IS THE POINT. The store answers 7 after removing 2 of 5 — a
    // number no arithmetic on the request could produce. If the facade ever
    // computes the count itself instead of asking, this goes red; a fixture
    // where the store agreed with subtraction could not tell the two apart.
    const removed: string[][] = [];
    const store: NotificationStore = {
      async insert() {},
      async countUnseen() {
        return 7;
      },
      async markSeen() {
        return [];
      },
      async markAllSeen() {
        return [];
      },
      async markSeenByRef() {
        return [];
      },
      async remove(_s, ids) {
        removed.push([...ids]);
        return [...ids];
      },
      async removeAll() {
        return [];
      },
    };
    const seen: number[] = [];
    const n = createNotifications({ store, onCountChanged: (_s, c) => void seen.push(c) });

    const res = await n.remove('u1', ['a', 'b']);

    expect(res.count).toBe(7);
    expect(seen).toEqual([7]);
    expect(removed).toEqual([['a', 'b']]);
  });

  it('returns what the store actually removed, never the ids requested', async () => {
    const store = createMemoryStore();
    const n = createNotifications({ store, onCountChanged: () => {} });
    await n.notify('u1', row('a'));

    // 'ghost' was never there, and 'b' belongs to nobody.
    const res = await n.remove('u1', ['a', 'ghost', 'b']);

    expect(res.removedIds).toEqual(['a']);
  });

  it('removeAll() clears the subject and announces the recount', async () => {
    const store = createMemoryStore();
    const seen: number[] = [];
    const n = createNotifications({ store, onCountChanged: (_s, c) => void seen.push(c) });
    await n.notify('u1', row('a'));
    await n.notify('u1', row('b'));
    await n.notify('u2', row('z'));

    const res = await n.removeAll('u1');

    expect(res.removedIds).toEqual(['a', 'b']);
    expect(res.count).toBe(0);
    expect(seen.at(-1)).toBe(0);
    // Another subject's rows are untouched.
    expect(store.rows('u2').map((r) => r.id)).toEqual(['z']);
  });
});

describe('a store that cannot remove is warned about at CONSTRUCTION', () => {
  it('warns once when the store lacks the pair — this is the whole story', async () => {
    // fd-sundhed's correction, and the reason a throwing remove() is not enough:
    // a consumer who deletes in their OWN table never calls remove(), so the
    // only moment we can reach them is when they wire the core up.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      createNotifications({ store: storeWithoutRemove(), onCountChanged: () => {} });
      expect(warn).toHaveBeenCalledTimes(1);
      const msg = String(warn.mock.calls[0]?.[0]);
      expect(msg).toContain('@broberg/notifications');
      expect(msg).toContain('remove()');
      expect(msg).toContain('removeAll()');
      expect(msg).toContain('canRemove');
    } finally {
      warn.mockRestore();
    }
  });

  it('does NOT warn when the store implements the pair', async () => {
    // The negative control. Without it the test above passes on a warning that
    // fires unconditionally, which would be worse than no warning at all.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      createNotifications({ store: createMemoryStore(), onCountChanged: () => {} });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('names the half that is missing when only one is implemented', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const store = createMemoryStore();
      delete (store as { removeAll?: unknown }).removeAll;
      const n = createNotifications({ store, onCountChanged: () => {} });
      expect(String(warn.mock.calls[0]?.[0])).toContain('removeAll()');
      expect(n.canRemove).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });

  it('does NOT throw at construction, and still notifies', async () => {
    // cardmem, xrt81 and moovyy are on 0.2.x and have done nothing wrong.
    // Throwing here would break all three the day they upgrade.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const seen: number[] = [];
      const n = createNotifications({
        store: storeWithoutRemove(),
        onCountChanged: (_s, c) => void seen.push(c),
      });
      await n.notify('u1', row('a'));
      expect(seen).toEqual([1]);
      expect(n.canRemove).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('remove() on a store that cannot remove fails loudly', () => {
  it('throws a named, greppable error — never a no-op, never a success', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const seen: number[] = [];
      const n = createNotifications({
        store: storeWithoutRemove(),
        onCountChanged: (_s, c) => void seen.push(c),
      });

      await expect(n.remove('u1', ['a'])).rejects.toThrow(/notifications\.remove:/);
      await expect(n.removeAll('u1')).rejects.toThrow(/notifications\.removeAll:/);
      // And it did not announce a number for something that never happened.
      expect(seen).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('canRemove — so a surface can hide the control instead of throwing', () => {
  it('is true for a store with the pair and false without it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(createNotifications({ store: createMemoryStore(), onCountChanged: () => {} }).canRemove).toBe(true);
      expect(
        createNotifications({ store: storeWithoutRemove(), onCountChanged: () => {} }).canRemove,
      ).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });
});
