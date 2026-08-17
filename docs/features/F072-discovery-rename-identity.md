# F072 — Discovery: enrollments must survive a repo rename, and the new name must not reach the public page

**Status:** planned · **Filed by:** torrent-search-api (#21104) · **Owner:** components

## Motivation

Discovery keys a repo's adoptions on its session/repo slug, with no alias layer.
Rename the repo and the adoptions do not follow.

Re-measured against the live service before this plan was written, because the
report concerned my own service and a report is not a measurement:

```
GET /api/sessions/torrent-search-api  →  enrolled: [ @broberg/ai-sdk 0.28.0 ]
GET /api/sessions/moovyy              →  enrolled: [] + a full `available` gap list
```

Christian has ordered `torrent-search-api` renamed. cardmem already built an
alias layer so old slugs resolve forever on their side; Discovery has none.

**The day the rename lands**, the repo shows as having adopted nothing, and the
session-start reuse gap recommends it adopt `@broberg/ai-sdk` — which it already
runs in production. No error. No warning. No failed call. Just a repo that looks
un-enrolled.

> **Their sentence, and it is the one to keep: an inventory that quietly loses an
> entry is worse than one that never had it, because the numbers still look
> complete.**

That is this week's shape for the fifth time: something says yes and does
nothing. A Zod `.strip()` deleting a field it did not recognise. A message
channel answering `ok:true` for a session that has never existed. A hook
registration pointing at a file that is not there, in 25 repos. Roster rows
naming versions older than npm served. None of them fail. All of them look fine.

And it is not one repo's problem: **every future rename does this**, and a rename
is exactly when nobody is auditing an inventory.

## Reuse

No build-vs-reuse question — Discovery is ours (F038). The reuse that matters is
**not re-deriving cardmem's alias design**: they have already solved this for
boards and cards, and the shape to copy is theirs (permanent old-slug
resolution, additive, never destructive). Ask them for the schema before
inventing one.

## The owner's constraint — read this before designing anything

**Christian, 2026-08-17: *"moovyy skal IKKE nævnes på Component Universe open web
page."***

The new name must not appear on the public surface. This is **load-bearing for
the design**, not a footnote appended to it: the identity mapping is
**server-side only**, and a rename must never propagate into rendered text.

Measured, so that this reads as a live trap rather than a caution: repo names
**already render onto the public page**, as credit lines inside package
descriptions — three occurrences of `torrent-search-api` in
`scripts/inventory-data.mjs` (the webpush, lens-engine and greppable rows), which
reach `docs/inventory.html`.

So the natural reflex on a rename — *"update the attributions to the new name"* —
is **exactly** the action that violates the constraint. A note asking a future
session to remember that is not a control. The guard is mechanical (see below).

At filing time, `moovyy` appears in **zero** files in this repo.

## Scope

1. **A server-side identity mapping** so an enrollment survives a rename: a
   lookup from any former slug to the current identity, additive and permanent.
   Reads (`/api/sessions/:slug`, the gap check) resolve through it.
2. **A way to record a rename** — `POST /api/sessions/:old/rename`, called by the
   repo doing the renaming, authenticated with the same `DISCOVERY_ENROLL_KEY`
   already bound to that session. Renames are rare and always deliberate, so a
   deliberate call is the right trigger.
3. **A mechanical guard** that fails the build if a private name reaches a public
   surface.

### Why an alias table rather than rewriting the row

Rewriting the enrollment's session field on rename is simpler and wrong: the old
slug then resolves to nothing, and every reference elsewhere in the fleet
(cardmem cards, commit messages, this plan-doc) points at a name Discovery has
forgotten. Additive mapping keeps both answers true, which is the property
cardmem's layer already has.

## Non-goals

- No automatic rename detection. Guessing that two slugs are the same repo is
  precisely the kind of inference that produces a confident wrong answer; a
  rename is an explicit, authenticated call.
- No back-fill of historical names beyond those actually reported.
- Not touching the enrollment key model — trust-on-first-use stays as it is, and
  the rename call reuses the key already bound to that session.

## Rollout

1. Ask cardmem for their alias schema before designing one.
2. Mapping + resolution on the read paths, with the rename endpoint.
3. The public-surface guard, proved RED first.
4. Tell `torrent-search-api` the endpoint exists **before** they rename — the
   whole point is that it is in place on the day, not afterwards.
