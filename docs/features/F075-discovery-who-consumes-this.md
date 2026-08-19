# F075 — Discovery knows who PUBLISHES a package and not who USES it

**Status:** planned · **Found by:** storeform, by correcting a release note aimed at them · **Owner:** components

## Motivation

I told storeform they were "green to bump to 0.9.0". They measured their own tree
and answered that there is nothing to bump:

```
package.json           @broberg/lens-engine  → not present
only @broberg dep      @broberg/lens-client 0.1.0
its own deps           {}   (empty)
node_modules/@broberg  @broberg/lens-client — and nothing else
```

`@broberg/lens-engine` does not reach them directly or transitively. Their
schemas are executed by the **daemon**, so the version that decides whether their
`check-terms` target breaks is *cardmem's*, not theirs. Their sentence is the one
worth keeping: **for them, "green" is not "ready to bump", it is "safe for you to
bump".**

**This is the second time the same mistake has shipped from this repo**, and the
first one is already written down. From the `@broberg/lens-engine` notes, filed
by torrent-search-api after five repos each spent time proving they were
unaffected by v0.6.1:

> *filter on has-lens-engine-in-node_modules, NOT on uses-Lens. The two sets are
> very different — most repos drive Lens as a SERVICE through the cardmem daemon
> or the MCP and only ever see the finished status field. One of them had run 144
> Lens runs without ever having had the package installed.*

I had that note. I made the mistake anyway. **A lesson that has to be remembered
at the moment of writing a release note is not a control** — the same argument
this fleet applies everywhere else, and the reason the harness rule says the
reminder is not the gate.

## What is actually missing

Discovery collects the right data and cannot answer the question.

- `POST /api/enroll` already takes `{ session, pkg, version, role }` where
  `role` is `"uses"` or `"src"`. Repos self-report adoptions.
- `GET /api/sessions/<session>` answers **one session's** view: what it is
  enrolled in, plus its gap.
- `GET /api/fleet` returns 11 rows shaped `{ s, r, pub }` — **`pub` only**. Who
  publishes. There is no `uses`.

So the reverse index — *given a package, who consumes it* — does not exist on any
endpoint, and the only way to answer it today is to ask every repo one at a time
and hope they measure rather than remember.

Measured 2026-08-19: `/api/fleet` mentions `@broberg/lens-engine` on exactly one
row, `components`, and that is the `pub` field.

## Non-goals

- **Guessing from the roster.** A `uses` list built from anything other than a
  repo's own measured `package.json` would recreate the defect one layer down: an
  authoritative-looking answer that agrees with whoever wrote it. See
  [[a-field-that-cannot-contradict-you]].
- **Scanning repos from Discovery.** It has no filesystem access to them and
  should not grow one. The repo measures itself and reports; Discovery indexes.
- **Transitive resolution.** A package reaching a repo *through* another
  `@broberg/*` package is real — it is exactly what storeform checked for — but a
  first version that answers the direct question correctly is worth more than one
  that answers both approximately.

## Sketch

1. **`GET /api/packages/:name/consumers`** → the sessions that have self-reported
   `role: "uses"` for that package, with the version each reported and when.
2. **`uses` on `/api/fleet` rows**, so the fleet map shows both directions.
3. **A `stale` marker.** An enrollment is a claim made on a date; a repo that
   reported `0.4.1` eleven releases ago is not evidence that it still consumes it.
   The row carries its own age, per the rule that a state is forever and a
   measurement has a date.
4. **The release-note step becomes mechanical**: before announcing a breaking or
   behaviour-changing release, fetch the consumer list and address exactly that
   set. Not "who uses Lens" — who has it installed.

## Open questions

- **Coverage is the whole risk.** Enrollment is voluntary, so an empty consumer
  list means *nobody reported*, not *nobody consumes*. The endpoint must say which
  of those two it is, or it becomes another answer that collapses two facts.
  Likeliest answer: return the roster of enrolled sessions alongside, so a reader
  can see the denominator.
- Does a repo consuming through the daemon-as-a-service want to appear at all?
  storeform's position suggests a third role — *drives it, does not install it* —
  which is genuinely useful to know and is not `uses`.
