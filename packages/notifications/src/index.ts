import type {
  ClearResult,
  NotificationRow,
  NotificationStore,
  NotificationsConfig,
  RemoveResult,
} from './types.js';

export type {
  ClearResult,
  NotificationRow,
  NotificationStore,
  NotificationsConfig,
  RemoveResult,
} from './types.js';

export interface Notifications<Row extends NotificationRow = NotificationRow> {
  notify(subjectId: string, row: Row): Promise<{ count: number }>;
  markSeen(subjectId: string, ids: readonly string[]): Promise<ClearResult>;
  markAllSeen(subjectId: string): Promise<ClearResult>;
  markSeenByRef(subjectId: string, kinds: readonly string[], refId: string): Promise<ClearResult>;
  unseenCount(subjectId: string): Promise<number>;
  /** Delete rows THROUGH the core, so the badge moves with them. */
  remove(subjectId: string, ids: readonly string[]): Promise<RemoveResult>;
  removeAll(subjectId: string): Promise<RemoveResult>;
  /** Whether this store can delete at all (F074.5, asked for by cardmem).
   *
   *  Read it to HIDE a delete control rather than render one that throws.
   *  Without it the defect only moves — from "the badge lies" to "the button
   *  does not do what it says" — which is better and still a surface claiming
   *  something it cannot hold. */
  readonly canRemove: boolean;
}

/** Wire a store and a fan-out into the five operations.
 *
 *  The whole package is the ORDER of the three lines inside each operation:
 *  write, then recount through the store's single counting function, then
 *  announce. Get that order wrong — or skip the announce on one path — and you
 *  have the defect this exists to prevent: a list showing five unopened rows
 *  above a clean app icon, with the user believing neither. */
/** Declared rather than pulled in from `lib: dom` or `@types/node`. This package
 *  is deliberately environment-agnostic — browser, node, bun, service worker —
 *  and widening the lib to reach one global would let every other one in. */
declare const console: { error(...args: unknown[]): void; warn(...args: unknown[]): void };

export function createNotifications<Row extends NotificationRow = NotificationRow>(
  config: NotificationsConfig<Row>,
): Notifications<Row> {
  const { store, onCountChanged, onCountChangedError } = config;

  /** Recount and announce. Never call `onCountChanged` from anywhere else: one
   *  place means a new operation cannot forget it, only fail to call this.
   *
   *  A FAILING FAN-OUT MUST NOT UNDO THE MUTATION (F074.3, filed by moovyy after
   *  adopting 0.1.0). Until 0.2.0 this awaited `onCountChanged` bare, so a dead
   *  phone or a wrong VAPID key rejected the whole `notify()` — AFTER the row was
   *  already written. Their case: a downloaded film would not be booked because a
   *  NUMBER could not be moved, and a caller that retries then writes the row
   *  twice.
   *
   *  The write already happened, so the operation succeeded; only the
   *  announcement failed. Those are two different facts and the caller is
   *  entitled to the first one.
   *
   *  IT IS NEVER SWALLOWED, because then the badge and the list disagree with
   *  nobody told — the exact defect this package exists to prevent. It goes to
   *  `onCountChangedError` if given, and to `console.error` if not. */
  async function settle(subjectId: string): Promise<number> {
    const count = await store.countUnseen(subjectId);
    try {
      await onCountChanged(subjectId, count);
    } catch (err) {
      if (onCountChangedError) onCountChangedError(err, subjectId, count);
      else console.error('[@broberg/notifications] onCountChanged failed', { subjectId, count, err });
    }
    return count;
  }

  /** Write, recount, announce — in that ORDER, in ONE place.
   *
   *  Clearing and removal both run through here. Two copies of these three
   *  lines would be two places to get the order wrong, and the order is the
   *  entire package. */
  async function mutate(
    subjectId: string,
    run: () => Promise<string[]>,
  ): Promise<{ ids: string[]; count: number }> {
    // The store's answer, never the request. Returning the requested ids would
    // hand the surface a set pointing at rows the user never had.
    const ids = await run();
    return { ids, count: await settle(subjectId) };
  }

  async function clear(subjectId: string, run: () => Promise<string[]>): Promise<ClearResult> {
    const { ids, count } = await mutate(subjectId, run);
    return { clearedIds: ids, count };
  }

  async function drop(subjectId: string, run: () => Promise<string[]>): Promise<RemoveResult> {
    const { ids, count } = await mutate(subjectId, run);
    return { removedIds: ids, count };
  }

  /** BOTH or neither. A store that can delete one row can delete all of them,
   *  and a half-implemented pair is a third state nobody asked for. */
  const canRemove = typeof store.remove === 'function' && typeof store.removeAll === 'function';

  // THE WARNING FIRES HERE, NOT FROM remove(). A consumer who deletes rows in
  // their own table never calls remove(), so a throwing remove() never reaches
  // the person actually in danger. fd-sundhed's correction; see types.ts.
  if (!canRemove) {
    const missing = [
      typeof store.remove === 'function' ? null : 'remove()',
      typeof store.removeAll === 'function' ? null : 'removeAll()',
    ]
      .filter(Boolean)
      .join(' and ');
    console.warn(
      `[@broberg/notifications] this store does not implement ${missing}, so this package cannot keep the badge in step with a DELETION. ` +
        'If your app deletes notification rows anywhere — its own table, an admin screen, a cleanup job — onCountChanged never fires: the badge keeps its old number over a list that is already empty. ' +
        'That is the defect this package prevents for every other mutation, in the one corner it does not cover. ' +
        'Route deletes through notifications.remove()/removeAll(), or read notifications.canRemove and hide the control.',
    );
  }

  return {
    async notify(subjectId, row) {
      // Refused HERE rather than on the wire: @broberg/webpush's send() already
      // rejects a titleless message, and a notification with no text is sent,
      // accepted, delivered and shows nothing. Cheaper to fail at the source.
      if (typeof row?.title !== 'string' || row.title.trim() === '') {
        throw new Error(
          'notify: `title` is required and cannot be blank — a notification with no title renders as an empty banner and no error is raised anywhere downstream',
        );
      }
      await store.insert(subjectId, row);
      // Fires with no client anywhere: a background writer with nothing open is
      // one consumer's NORMAL state, and the silent push that carries the number
      // to a locked phone hangs off this callback.
      return { count: await settle(subjectId) };
    },

    markSeen(subjectId, ids) {
      return clear(subjectId, () => store.markSeen(subjectId, ids));
    },

    markAllSeen(subjectId) {
      return clear(subjectId, () => store.markAllSeen(subjectId));
    },

    markSeenByRef(subjectId, kinds, refId) {
      return clear(subjectId, () => store.markSeenByRef(subjectId, kinds, refId));
    },

    unseenCount(subjectId) {
      return store.countUnseen(subjectId);
    },

    // Secondary to the construction warning, never a substitute for it: named
    // and greppable, so a consumer who DOES route through the core gets an
    // error they can search for rather than a silent no-op or a false success.
    async remove(subjectId, ids) {
      const run = store.remove;
      if (!run) {
        throw new Error(
          'notifications.remove: this store does not implement remove(). Add it to your store, or read notifications.canRemove and hide the delete control — a delete that goes around the core leaves the badge showing rows that are gone.',
        );
      }
      return drop(subjectId, () => run.call(store, subjectId, ids));
    },

    async removeAll(subjectId) {
      const run = store.removeAll;
      if (!run) {
        throw new Error(
          'notifications.removeAll: this store does not implement removeAll(). Add it to your store, or read notifications.canRemove and hide the delete control — a delete that goes around the core leaves the badge showing rows that are gone.',
        );
      }
      return drop(subjectId, () => run.call(store, subjectId));
    },

    canRemove,
  };
}

/** An in-memory store with the reference semantics — the spec the five methods
 *  are written against, and a real starting point for a consumer who has not
 *  built the table yet.
 *
 *  It counts `seenAt === null` and nothing else, which is the SIMPLEST rule and
 *  NOT the right one for an app with per-user muting: swap in your own query
 *  the moment kinds can be switched off (see the README). */
export function createMemoryStore<Row extends NotificationRow = NotificationRow>(): NotificationStore<Row> & {
  rows(subjectId: string): Row[];
} {
  const bySubject = new Map<string, Row[]>();
  const rowsFor = (subjectId: string): Row[] => {
    let rows = bySubject.get(subjectId);
    if (!rows) bySubject.set(subjectId, (rows = []));
    return rows;
  };

  /** Mark the matching rows, and return only those that were actually unseen —
   *  the transition, not the request. */
  const transition = (subjectId: string, match: (r: Row) => boolean): string[] => {
    const cleared: string[] = [];
    for (const row of rowsFor(subjectId)) {
      if (row.seenAt === null && match(row)) {
        row.seenAt = 1;
        cleared.push(row.id);
      }
    }
    return cleared;
  };

  return {
    rows: (subjectId) => rowsFor(subjectId),
    async insert(subjectId, row) {
      rowsFor(subjectId).push({ ...row });
    },
    async countUnseen(subjectId) {
      return rowsFor(subjectId).filter((r) => r.seenAt === null).length;
    },
    async markSeen(subjectId, ids) {
      const wanted = new Set(ids);
      return transition(subjectId, (r) => wanted.has(r.id));
    },
    async markAllSeen(subjectId) {
      return transition(subjectId, () => true);
    },
    async markSeenByRef(subjectId, kinds, refId) {
      const wanted = new Set(kinds);
      return transition(subjectId, (r) => r.refId === refId && wanted.has(r.kind));
    },
    /** Returns what was actually there, in the order it was stored — never the
     *  ids requested. An id that did not exist is simply absent. */
    async remove(subjectId, ids) {
      const wanted = new Set(ids);
      const rows = rowsFor(subjectId);
      const removed = rows.filter((r) => wanted.has(r.id)).map((r) => r.id);
      // Spliced in place rather than swapped for a filtered copy: `rows()`
      // hands out the live array, and replacing it would leave any caller
      // holding the old one reading rows that are gone.
      for (let i = rows.length - 1; i >= 0; i--) if (wanted.has(rows[i]!.id)) rows.splice(i, 1);
      return removed;
    },
    async removeAll(subjectId) {
      const rows = rowsFor(subjectId);
      const removed = rows.map((r) => r.id);
      rows.length = 0;
      return removed;
    },
  };
}
