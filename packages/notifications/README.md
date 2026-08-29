# @broberg/notifications

Headless in-app notification core for the broberg.ai fleet: the bell, the list,
and the OS badge all read **one** number, so they cannot disagree.

The package does **not** own your database, your count query, or your list UI.
You supply a store; it owns the choreography.

```bash
npm i @broberg/notifications
```

## v0.2.0 — a failing fan-out no longer undoes the mutation

Filed by moovyy after adopting 0.1.0, and it bit in production shape.

`onCountChanged` is awaited after every mutation. Until 0.2.0 it was awaited
**bare** — so a dead phone, a `410 Gone`, or a wrong VAPID key rejected the whole
`notify()`, *after the row was already written*. Their case: a downloaded film
would not be booked because a **number** could not be moved. And a caller that
retries then writes the row twice.

**The write already happened, so the operation succeeded; only the announcement
failed. Those are two different facts, and the caller is entitled to the first.**

```ts
createNotifications({
  store,
  onCountChanged: (subjectId, count) => sendSilent({ badge: count }),
  onCountChangedError: (err, subjectId, count) => log.warn({ err, subjectId, count }),
})
```

**It is never swallowed.** Without `onCountChangedError` the failure goes to
`console.error`. Silence would leave the badge and the list disagreeing with
nobody told — which is the defect this package exists to prevent, moved inside
the package.

**A failing STORE still throws.** Only the fan-out is forgiving: if the write did
not happen, the caller must hear about it. Both directions have a test.

### Two things to do when you upgrade from 0.1.0

Both reported by moovyy after running the upgrade against their own suite rather
than taking the release note's word for it.

**1 · You will silently lose a red test.** If you wrapped `onCountChanged` in
your own `try/catch` — as you should have on 0.1.0 — the mutation *"remove the
consumer's error handling"* was RED before this release and is GREEN after,
because the guard now lives here. That is correct, and it is invisible: nothing
tells you a test stopped defending anything. Re-run your mutation pass after
upgrading, and delete or re-aim the ones that have gone equivalent.

**Re-running is only half of it** — moovyy's sharpening, after they did the first
half and caught themselves. They found the equivalent mutant and wrote it in the
commit message, but the test kept its old name and its old promise:
*"a failing badge must not cost the message"*. The next person reads the **file**,
not yesterday's commit, and believes it still guards their error handling. It
does not.

> **A test whose name promises something it no longer holds is worse than no
> test. It is a claim somebody believes.**

They re-aimed rather than deleted: it is now named as a **contract** test, its
comment says it proves *this package's* guarantee rather than their own code, and
it goes red again if a future release rolls the guarantee back. That is the shape
to copy.

**2 · `onCountChangedError` is where YOUR log shape goes — not an optional
extra.** The fallback is deliberately neutral: one plain `console.error` line,
no `[ERROR]` prefix, no emoji, because a package has no business deciding how
your logs look. The consequence is that in a viewer which highlights on markers,
the fallback does not stand out — moovyy measured that a phone which never
receives its number disappears into the grey stream. Pass the handler and format
it the way the rest of your system is formatted:

```ts
onCountChangedError: (err, subjectId, count) =>
  log.error(`❌ badge ${count} not delivered to ${subjectId}`, err),
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

---

## `@broberg/notifications/shell` — the bell and its panel (F074.4, in progress)

> **Not published yet.** The headless state machine is here; the `/react` and
> `/preact` wrappers are not. Nothing to adopt until they land.

Four apps each hand-rolled the same bell, and each got the same things wrong. The
row is **not** the shared part — three brands, three row shapes. The *shell* is:

```ts
import { createBellShell } from "@broberg/notifications/shell";

const shell = createBellShell({
  labels,                                   // REQUIRED — see below
  countUnseen: () => notifications.unseenCount(userId),
  markAllSeen: () => notifications.markAllSeen(userId),
  loadRows:    () => db.recentFor(userId, 10),
});
```

### `labels` is required, and there are no defaults anywhere

Not a convenience — the absence of a default **is** the feature.

A consumer's bell had shipped Danish text for months in an app whose UI must be
English. The giveaway was `Loading…` in English one line away: **nobody chose
Danish; nobody chose anything.** A default lets *"no decision"* look exactly like
*"a decision"*, and every consumer inherits whichever language we happened to
write. Omitting `labels` fails your typecheck instead.

`aria-label`s are in there too, for the reason the visible strings are not the
problem: buttons get translated because someone can see them.

> ⚠️ **Two different settings that are easy to confuse, and the confusion is
> structural rather than anyone's mistake:**
>
> - **Project language** governs what language the *agent writes to the human* in
>   (chat, reports, intercom).
> - **App-UI language** is what the *user sees on screen*.
>
> They are independent, and in at least one fleet repo they are deliberately
> different: Danish chat, English UI. A session that reads the first as the second
> builds the wrong screen **with a clear conscience** — which is what makes it hard
> to catch in review.

### The stack, not "one dialog at a time"

A row can open a modal **on top of** the still-open panel. `pushLayer` stacks;
`popLayer` closes the top and returns the focus target *that layer* declared —
for an alarm opened from a row, that is **the row**, not the bell.

### Escape is an outcome, not a close

```ts
shell.pushLayer({ id: "alarm", modal: true, focusReturn: rowEl });
shell.escape();   // → "keep": a modal does not close on Escape by default
```

A shell that hardcoded *"Escape closes"* would let someone dismiss an incident
alarm with one keypress and nothing recorded. That is not an accessibility
detail; it is whether the alarm means anything. Non-modal layers get `"close"`
for free; a modal layer must decide, via `onEscape`.

### One count, however many bells

The count lives in the shell, not in the bell. A consumer rendering the bell in a
mobile bar *and* a desktop bar gets one number — the production bug this replaces
was two components each counting, where "mark all read" zeroed one of them and
the other sat at 2 with every row read.

### `clearedIds` is held for the visit

`markAllSeen()` returns the ids it **actually** cleared, and that set exists
exactly once — afterwards the rows are seen. Open the app, see three highlighted,
tap one, go back, and the other two are gone if you re-derive the highlight per
render. The shell holds it until the panel closes.

### The anchor is captured at the instant of opening

`open(rect)` takes the trigger's measured rect, because a dropdown anchors from
it *at the moment it opens*. A bottom-sheet consumer passes `null` — the shell is
never indifferent to anchoring; it is told.

### If you have a fixed bottom bar

Set `overscroll-behavior: none` on it. The panel opens over it, and on an iPhone
in standalone the rubber-band makes the bar float. It is your CSS, not ours, but
it is only reproducible on that one configuration.
