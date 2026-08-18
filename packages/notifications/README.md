# @broberg/notifications

Headless in-app notification core for the broberg.ai fleet: the bell, the list,
and the OS badge all read **one** number, so they cannot disagree.

The package does **not** own your database, your count query, or your list UI.
You supply a store; it owns the choreography.

```bash
npm i @broberg/notifications
```

## Why this exists

Three apps built the same notification list. They looked different and behaved
the same — and the part they got wrong was never the menu.

**On xrt81 the bell counted *unopened notifications* while a test route counted
*unread messages*.** The route sent `badge = 0`, which does not mean "no badge"
but **"remove the badge"** — so the test deleted the number it existed to prove.
One counting rule, in one place, is the whole product.

## Use

```ts
import { createNotifications } from "@broberg/notifications";

const notifications = createNotifications({
  store,                                    // your database, behind 5 methods
  onCountChanged: async (subjectId, count) => {
    sse.publish(subjectId, { count });      // open clients
    await syncBadge(subjectId, count);      // closed phones — @broberg/webpush
  },
});

await notifications.notify(userId, row);              // → { count }
await notifications.markAllSeen(userId);              // → { clearedIds, count }
await notifications.markSeenByRef(userId, ["ny-film"], driveId);
await notifications.unseenCount(userId);              // → number
```

`onCountChanged` fires after **every** mutation, with the recounted number. That
is the enforcement: the row and the badge change together or not at all.

## The counting rule

> **`unseenCount` is "things that pushed you and you have not opened" — never
> "everything you have not read".**

And the destination rule, from xrt81:

> **Count a notification only if there is somewhere the user can go that CLEARS
> it.** Whether that destination is stored on the row or derived does not matter
> — but if it cannot be derived, the row must fall **out** of the count rather
> than count with a link that clears nothing. *A number no action can remove
> teaches people to ignore it.*

### The core never writes the count query — you do

`store.countUnseen(subjectId)` is **your** SQL, and it is deliberately yours,
because the obvious rule is wrong:

```sql
-- WRONG for at least two of the three consumers
SELECT count(*) FROM notifications WHERE subject_id = ? AND seen_at IS NULL
```

Both cardmem and xrt81 exclude a user's **muted** kinds from the count, so
*unread* and *counted* are different sets. Measured on cardmem's production
(2026-08-18) one live user had `raw_unseen = 50` against a shown count of **1** —
a badge permanently red with a kind they had switched off, which is the fastest
way to teach someone to ignore a badge.

If the core assumed `seen IS NULL`, both apps would have to keep a second
counter, which is exactly the defect above.

> **Scope of that evidence, stated plainly:** cardmem and xrt81 each measured one
> user, one muted kind, and zero simultaneous mutes. Two measurements of the same
> narrow shape are one proof twice, not two proofs. The rule is right in
> principle; it is not yet measured broadly.

`createMemoryStore()` ships as the reference implementation and a real starting
point — but it counts `seenAt === null` and nothing else. **Swap in your own
query the moment kinds can be muted.**

## `clearedIds` exists exactly once — a contract, not a tip

Every clearing call returns the ids whose `seenAt` transitioned **on that call**
— never the ids you requested, so an already-seen row and somebody else's row are
both absent.

It is how a surface highlights *"here are the three that were new"* after a badge
brought the user in. **There is no way to ask for it again:** the rows are seen
afterwards, so a second call returns an empty set.

```ts
const { clearedIds } = await notifications.markAllSeen(userId);
holdForThisVisit(clearedIds);          // ✅ survives navigation
// ❌ re-deriving the highlight per render loses the rest after the first tap
```

## The row

```ts
interface NotificationRow {
  id: string;
  kind: string;            // your category — an UNKNOWN kind must still count
  title: string;           // required, non-blank
  body: string | null;
  navigate: string | null; // where tapping it goes
  refId: string | null;    // WHAT it is about — see markSeenByRef
  createdAt: number;       // epoch ms
  seenAt: number | null;   // null = unseen
}
```

`title` / `body` / `navigate` are exactly the three fields
[`@broberg/webpush`](https://www.npmjs.com/package/@broberg/webpush)'s
`buildPayload` reads, so the same names run the whole length of the pipe. A
consumer once passed its own field names into that boundary and every message
would have arrived **empty** — and four mutations survived it, because the tests
read `send()`'s return value and never the body on the wire.

**Extend it structurally.** cardmem adds `projectId`, moovyy a poster; no core
change, no cast, no generic to thread through your call-sites.

```ts
interface MyRow extends NotificationRow { poster: string }
const store = createMemoryStore<MyRow>();
```

### `refId` and `markSeenByRef`

The rule nothing fails without: **read the thing somewhere else in the app, and
the notification about it clears.** Leave it out and nothing breaks — the bell
just keeps promising something the user already read.

## The store

```ts
interface NotificationStore<Row extends NotificationRow = NotificationRow> {
  insert(subjectId, row): Promise<void>;
  countUnseen(subjectId): Promise<number>;                 // THE one counting place
  markSeen(subjectId, ids): Promise<string[]>;             // transitioned ids
  markAllSeen(subjectId): Promise<string[]>;
  markSeenByRef(subjectId, kinds, refId): Promise<string[]>;
}
```

Every `mark*` returns the ids whose `seenAt` went from null **on this call**.

## What is deliberately absent

- **A list component.** Three consumers, three brands, three row shapes. A shared
  renderer becomes a prop-soup nobody dares change.
- **A `clearOn` option.** Clearing on app-open versus on interaction is *which
  call-site you put `markAllSeen()` on* — the core cannot know when your app
  opens, and an option describing something it does not execute is documentation
  disguised as API.
- **User preferences.** Muting lives in your count query, because a core that
  owned it would fit exactly one app.
- **Push.** `sendSilent` / `syncBadge` belong to `@broberg/webpush`. Wire them in
  `onCountChanged`; this package has no runtime dependencies at all.
- **A prune/TTL policy.** Neither production consumer prunes today. xrt81
  measured ~11,000 rows/year for a 15-person club and calls the absence a gap;
  cardmem warned against designing a TTL from an assumption they have one. It
  gets its own release, with real numbers.

## Notes

The server-only write path is first-class: `notify()` works with **no client
anywhere** — no tab, no foreground app, a locked phone — because one consumer's
normal state is a background watcher writing rows with nobody watching. Your
silent push hangs off `onCountChanged`.

---

Part of the [broberg.ai shared inventory](https://discovery.broberg.ai). Built by
`components` · F074.
