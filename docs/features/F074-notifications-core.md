# F074 — `@broberg/notifications`: three apps, one counting rule

**Status:** planned · **Filed by:** Christian · **Owner:** components

## Motivation

Christian noticed that cardmem, xrt81 and moovyy all have the same in-app
notification list — a bottom sheet, *"Markér alle læst"*, rows carrying a
category chip, a title, an excerpt and a relative time, feeding an OS badge — and
asked why there is no npm for it. All three are Stack B (Bun/Hono/Preact).

> *"trods det at det er UI burde der ikke være en npm til dette, altså selve
> menuen … Alle 3 løsninger er Stack B Bun/Hono/Preact mener jeg så det burde
> være lige til at lave noget fælles"*

**The uncomfortable half of the answer: the menu is the part that should NOT be
shared.** The three lists look genuinely different and each consumer named what
they will not give up. What *is* shared — and invisible, which is why it drifts —
is the counting.

## Reuse

Searched Discovery before designing. **No `@broberg/*` package covers this.**

| Package | What it is | Covers this? |
|---|---|---|
| `@broberg/ui-controls-core` | toasts, modals, select, datepicker (headless) | No |
| `@broberg/event-log` | append-only audit trail | No — different thing |
| `@broberg/cmdk` | ⌘K palette | No |
| `@broberg/webpush` | Web Push delivery + badge helpers | **No — and says so explicitly:** the consumer owns subscriptions, prefs, history and the brand UI |

So this is a build. It **consumes** `@broberg/webpush` (`sendSilent`, `syncBadge`)
rather than reimplementing the badge half — the silent push that carries a number
to a phone with nothing running is already shipped and proven on real iPhones.

## What the three consumers actually run

Asked before designing, because five of the six defects in `@broberg/webpush` were
found by consumers answering this kind of question rather than by anyone reading
code. All three answered.

### xrt81 — production, and the only real-device signal

```ts
interface NotificationRow {
  id: string; kind: string; title: string; body: string | null;
  navigate: string | null; refId: string | null;
  createdAt: string; seen: boolean;
}
```

`notifications(id, tenant_id, member_id, kind, title, body, navigate, ref_id,
created_at, seen_at NULL)` + `index(member_id, created_at)`.

**One counting place**, `unseenCount(memberId)`, read by all 14 call-sites — the
bell, `app_badge` on every push, and the API response. Its filter is two rules:
`seen_at IS NULL AND navigate IS NOT NULL`, plus *the category is not muted*.

`navigate IS NOT NULL` is not decoration: **a notification with no destination
cannot be cleared by any action**, so the badge would hang forever. An unknown
`kind` is counted **in** — nothing is hidden because a mapping was forgotten.

Clearing is one endpoint, `POST /notifications/seen-all` → `markAllSeen()` +
`syncBadge(member.id, 0)` fire-and-forget, sent as a **silent** push so the
member's other devices follow without a banner. *Their note:* this works precisely
**because** `0` means "remove the badge" — the same property that bit them, used
deliberately.

**No pruning, and they call it a gap rather than a design.** Measured on
production: **304 rows in ~10 days, 230 unseen, 217 of them `chat_all`** —
projecting ~11,000/year for a 15-person club.

### cardmem — the only multi-project consumer

```ts
// packages/db/src/schema.ts:1564 (drizzle)
id, userId, kind, title, body /* notNull */, navigate /* nullable */,
projectId /* nullable */, createdAt /* timestamp_ms */, seenAt /* nullable = unread */
index('notifications_user_created_idx').on(userId, createdAt)
```

**The answer only they could give: the badge is per USER, not per (user ×
project).** 3 unopened in one project + 2 in another = **badge 5**. `projectId`
sits on the row for the chip and the deep link and **never enters the count**. So
`subjectId` alone is enough and no signature widens — their cross-project nature
is a *rendering* property, not a *counting* one.

**One counting place**, `unseenCount(db, userId)` at `api/push.ts:143`, read by
the HTTP response, the `notification_changed` SSE and the OS badge alike.

Clearing is one endpoint, `POST /api/push/seen` → a single `UPDATE … WHERE userId
AND seenAt IS NULL`, followed by **both** halves: the SSE for open clients and
`sendSilentBadge()` for closed PWAs. A single-row `POST /seen/:id` exists too,
scoped to the caller so a foreign id matches nothing, and it returns the fresh
count **so the client never decrements a number itself**.

**They never prune**, and said explicitly: don't design a TTL from an assumption
that we have one.

### moovyy — has not built it yet, which is the most useful answer of the three

Only push, proven on Christian's iPhone. They put the pencil down rather than
write the fourth implementation. So they **adopt** the core instead of migrating
to it, and their constraints are unencumbered by an existing schema:

- The row is written by a **background job comparing Drive against what we know,
  with no client running.** That is their normal case, not a corner case: the core
  must take "here is a new row" from the server alone and get the number onto a
  closed phone by itself.
- Their number means *"new films have arrived"* — one fact, not N separate
  errands — so it is right to clear on app-open. xrt81's means *"N things want
  something from you, individually"*.

## The finding that decides the API

**"Unread" and "counted" are not the same set — and two of the three discovered
that independently, by different routes.**

```
xrt81    counts  seen_at IS NULL AND navigate IS NOT NULL  + category not muted
cardmem  counts  seenAt IS NULL                            + kind not muted
```

The obvious core — `count = rows WHERE seen IS NULL` — is therefore **wrong for
two of three consumers on day one, and wrong silently**. cardmem put the
consequence plainly:

> *"Hvis kernen antager `count = rows WHERE seen IS NULL`, kan vi ikke bruge den
> uden at genindføre vores egen tæller — og så er I tilbage ved det
> dobbelt-tælle-problem xrt81's F071.5 var."*

That problem has a price tag already. On xrt81 (F074.27) the bell counted
*unopened notifications* while a test route counted *unread messages*; it sent
`badge=0`, which is not "no badge" but **"remove the badge"**, and so deleted the
number it existed to prove.

**So the core does not own the count query.** Both consumers already have working,
non-trivial count SQL with app-specific filters, and a shared package that forces
them to keep a second counter recreates the exact defect it was built to prevent.

## What the number MEANS — the definition, not a note

cardmem named this as the thing they will not give up, and it was not on the list
I guessed:

> *"vores badge tæller UÅBNEDE, ikke hele indbakke-backloggen. Badget er «ting
> der har pushet dig som du ikke har åbnet» — ikke «alt du ikke har læst». Hvis
> kernen kun kan tælle det ene, skal det være dette."*

So it is the core's definition rather than a consumer preference:

> **`unseenCount` is "things that pushed you and you have not opened" — never
> "everything you have not read".**

The two are easy to conflate and expensive to conflate. It is precisely the
distinction xrt81's F074.27 fell on: the bell counted unopened notifications while
a test route counted unread messages, sent `badge=0` — which is not "no badge"
but *"remove the badge"* — and so deleted the number it existed to prove. A
package whose whole purpose is one counting rule must state which rule, or the
second implementation is free to pick the other one and nothing will fail.

It also explains why muting belongs in the count and not only in the list: a kind
you turned off did not "push you", so it cannot be a thing you have not opened,
even though the row is real and belongs in the list.

## The seam

**The core owns the choreography, not the query.** Every mutation recounts through
the consumer's *one* counting function and fires the change — so the row and the
badge cannot disagree, whoever wrote the row and whether or not a client is
running.

```ts
const notifications = createNotifications({ store, onCountChanged });

notify(subjectId, row)      // writes the row  + recount + notify
markAllSeen(subjectId)      // clears          + recount + notify → { clearedIds }
markSeenByRef(subjectId, kinds, refId)  // same, scoped to one thing
markSeen(subjectId, ids)    // one row         + recount + notify
unseenCount(subjectId)      // delegates to the store — THE one counting place
```

`onCountChanged(subjectId, count)` is where a consumer wires its own fan-out —
cardmem fires SSE **and** a silent push; xrt81 and moovyy fire the silent push
alone. **The core calls it after every mutation, which is the enforcement** of the
invariant both xrt81 and moovyy asked for: badge and list clear in the same
action, never one without the other.

### The row

```ts
interface NotificationRow {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  navigate: string | null;
  refId: string | null;
  createdAt: number;      // epoch ms
  seenAt: number | null;  // null = unseen
}
```

xrt81's names, kept for a reason stronger than seniority: **`title` / `body` /
`navigate` are exactly the three fields `@broberg/webpush`'s `buildPayload`
reads**, so the same names run the whole length of the pipe.

moovyy had already paid for getting that wrong one layer in — their sender passed
Danish field names to `buildPayload`, so every message would have arrived **empty**,
and **four mutations survived it** because the tests only read `send()`'s return
value and never the body on the wire. Identical names end to end makes that
*structurally impossible* rather than merely tested against.

Consumers extend it structurally — cardmem's `projectId`, moovyy's poster — with
no core change.

## Decisions, and who filed them

| Decision | Filed by |
|---|---|
| `subjectId` alone; the badge is per user, `projectId` never enters the count | cardmem |
| The count takes the consumer's predicate; the core never assumes `seen IS NULL` | cardmem |
| `markAllSeen()` returns `clearedIds` | moovyy |
| The core must not own user prefs — muting is the app's, via the store's query | xrt81 |
| `refId` + `markSeenByRef` are standard, not optional | xrt81 |
| Server-only write path with no client running is a first-class case | moovyy |
| `body` is nullable — the superset; cardmem's `notNull` is a consumer constraint | components |

### The one I refused

moovyy proposed `clearOn: 'open' | 'interaction'` as core configuration. **The
core cannot honour it** — it does not know when an app opens. That is not a
setting, it is which call-site you put `markAllSeen()` on. An option describing
something the core does not execute is documentation disguised as API, and it is
the same failure shape as everything else this week: *a field that is accepted and
does nothing*.

### The trap that ships as a contract, not a README note

`clearedIds` is the **only** time that set exists — the rows are `seen` afterwards,
so a second call returns empty. Open the app, see three highlighted, tap one, go
back, and the other two are gone if the surface re-derives the highlight per
render. **The caller owns that set for the visit.** It is the same failure moovyy
is trying to avoid, moved one layer out, and just as silent.

## Non-goals

- **The list UI.** Three consumers, three brands, three row shapes. A shared
  renderer becomes a prop-soup nobody dares change, and it is the half that is
  cheap to write and expensive to share.
- **Owning user preferences.** xrt81's count asks `members.pushPrefs`; cardmem's
  asks its own mute list. A core that owned this would fit exactly one app.
- **Re-implementing push.** `sendSilent` / `syncBadge` are `@broberg/webpush`'s and
  stay there. This package calls them; it does not learn about VAPID.
- **A prune/TTL policy in v0.1.0.** See below — it is a separate story with real
  numbers rather than a guess.
- **The transport.** No HTTP routes, no SSE. `onCountChanged` is the seam; how a
  consumer fans it out is theirs.

## Open questions

1. **Pruning.** xrt81 has ~11,000 rows/year coming and calls its absence a gap;
   cardmem never prunes and warned against designing a TTL from an assumption they
   have one. Needs its own story, with xrt81's numbers as the input.
2. ~~**`navigate IS NOT NULL` in the count.**~~ **Settled — and the measurement
   weakened the argument that raised it.** xrt81 ran the two filters separately
   across all 30 members:

   ```
   cost of `navigate IS NOT NULL`:  0 rows   (across ALL 30 members)
   cost of the mute exclusion:      3 rows   (one member)
   ```

   **The destination filter removes nothing in production today**, because the
   guard effectively lives with the *writers*: none of their ten kinds writes a
   notification without a destination. It is a **backstop, not a working filter**
   — cheap, and it catches the day someone adds a kind with nowhere to go, but it
   is not a number that can carry a contract. **v0.1.0's argument must not be
   built on it.** Recorded because xrt81 volunteered it against their own
   recommendation from the day before.

   Their sentence, adopted as the shared guidance:

   > **"Count a notification only if there is somewhere the user can go that
   > CLEARS it. Whether the destination is stored on the row or derived does not
   > matter — but if it cannot be derived, the row must fall OUT of the count
   > rather than count with a link that clears nothing: a number no action can
   > remove teaches people to ignore it."**

   It covers cardmem's derived `?p=<slug>` (derived is fine) *and* their legacy
   risk (a slug that no longer resolves yields a link that clears nothing, so it
   must not count).
3. ~~**One measurement to take up** — the muted-kind exclusion, the load-bearing
   divergence.~~ **Measured on cardmem's production, 2026-08-18:**

   ```
   reach control first: notifications=1751 rows, notification_prefs=2 rows
     (without it, "0 differences" is indistinguishable from an empty table)

   user 019e1de8   muted=[review]   raw_unseen=0    excl_muted=0    (same)
   user 019f2548   muted=[review]   raw_unseen=50   excl_muted=1    <- DIFFERS
   ```

   **50 against 1.** A core built on `count = rows WHERE seen IS NULL` would have
   shown that user **badge 50** where the product shows **1** — a bell permanently
   red with a kind they explicitly turned off, which is the fastest way to teach
   someone to ignore a badge. The seam below is now backed by a number rather than
   by two sessions reading each other's code.

   **Their own limit on it, kept because it bounds what was proved:** only 2 users
   on all of production have a prefs row, and both mute exactly `review`. So the
   exclusion is proven to *work*, on one muted kind for one user. Nothing is proven
   about several simultaneous mutes or the other six kinds.

   **xrt81, measured the same day — and the finding is that they do NOT close that
   gap:**

   ```
   members total                30
   with a prefs row              1     <- not 14
   with >=1 mute                 1
   with SEVERAL simultaneous mutes   0  <- still unmeasured across ALL THREE

   ra@agat.dk   mutes=[chatAll]   raw=3 -> after_navigate=3 -> final=0
   ```

   100% of that member's badge, same direction as cardmem's 50→1 — and n=1 again.

   > **Two independent measurements of the SAME narrow shape are not two proofs.
   > They are one proof, twice.** (xrt81's words, and they are right.) One user,
   > one muted kind, zero multi-mutes — on both systems. So the core's contract
   > currently rests on the exclusion being **right in principle**, not on its
   > having been measured broadly. A later reader must not mistake corroboration
   > for coverage.

   xrt81 have filed **F079** for their adoption, carrying *parity after a
   preference change* as an explicit AC. That is the measurement that will
   actually widen the shape, and it arrives with their migration, not before.

## Rollout

1. **F074.1 — the headless core + the store contract.** Row type, the five
   functions, `onCountChanged` fired after every mutation, `clearedIds`. Tests
   assert on what reaches the store and the callback, never on a return value
   alone — moovyy's four surviving mutations are the reason that is written down.
2. Publish `v0.1.0`. **moovyy adopts first**, because they have nothing to
   migrate and every defect they hit is one the other two never pay for.

   **But be precise about what that adoption proves, because it is less than it
   looks.** xrt81's observation, and it is the sharpest thing said about the
   rollout: *v0.1.0's only production experience will come from the consumer who
   cannot reveal a parity error.* moovyy has no old counter to compare the new
   one against, so their adoption can prove the core **works** and can never
   prove it **agrees**. The first real test of the contract is a migration, not
   an adoption.

3. xrt81 and cardmem migrate behind proven parity — their existing counters keep
   running until the core's number matches theirs on live data. **No naked
   cutover:** replace, prove, then remove.

   **Name who can do what, or the measurement waits on "somebody".** The one
   measurement that widens the evidence past one-user-one-kind is *parity after a
   preference change* — a user mutes or unmutes something and the number has to
   follow. It can only be taken by a repo that HAS an old counter to measure the
   new one against:

   | | can prove parity? | why |
   |---|---|---|
   | **xrt81** | yes — filed as **F079**, with this as an explicit AC | old counter, live mutes |
   | **cardmem** | yes | old counter, live mutes |
   | **moovyy** | **no** | nothing to migrate from |

   So if the shape is to be covered before `v0.2.0`, xrt81 or cardmem cover it.
   Written down because an unassigned measurement is an unperformed one.
4. Prune story, informed by xrt81's measured growth.
5. Tell Discovery, so the fourth app never writes this again.
