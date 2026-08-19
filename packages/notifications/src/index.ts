import type {
  ClearResult,
  NotificationRow,
  NotificationStore,
  NotificationsConfig,
} from './types.js';

export type {
  ClearResult,
  NotificationRow,
  NotificationStore,
  NotificationsConfig,
} from './types.js';

export interface Notifications<Row extends NotificationRow = NotificationRow> {
  notify(subjectId: string, row: Row): Promise<{ count: number }>;
  markSeen(subjectId: string, ids: readonly string[]): Promise<ClearResult>;
  markAllSeen(subjectId: string): Promise<ClearResult>;
  markSeenByRef(subjectId: string, kinds: readonly string[], refId: string): Promise<ClearResult>;
  unseenCount(subjectId: string): Promise<number>;
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
declare const console: { error(...args: unknown[]): void };

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

  async function clear(
    subjectId: string,
    run: () => Promise<string[]>,
  ): Promise<ClearResult> {
    // The store's answer, never the request. Returning the requested ids would
    // hand the surface a highlight pointing at rows the user never had.
    const clearedIds = await run();
    return { clearedIds, count: await settle(subjectId) };
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
  };
}
