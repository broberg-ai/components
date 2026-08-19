# F075 — Discovery cannot say who depends on a package, and the field that looks like it can is hand-written

**Status:** planned · **Found by:** storeform (twice) and cardmem · **Owner:** components

## Motivation

I told storeform they were "green to bump to lens-engine 0.9.0". They measured
their own tree and answered that there is nothing to bump:

```
package.json           @broberg/lens-engine  → not present
only @broberg dep      @broberg/lens-client 0.1.0
its own deps           {}   (empty)
node_modules/@broberg  @broberg/lens-client — and nothing else
```

Their schemas are executed by the **daemon**, so the version that decides
anything for them is cardmem's. Their sentence is the one to keep: **for them,
"green" is not "ready to bump", it is "safe for you to bump".**

**Second time this mistake has shipped from here**, and the first is written down
— torrent-search-api filed it after five repos each spent time proving they were
unaffected by 0.6.1, one of them having run 144 Lens runs without ever having had
the package installed. I had the note and made the mistake anyway. **A lesson
that must be remembered at the moment of writing a release note is not a
control.**

## What is actually there — measured, after I got it wrong once

The first version of this doc claimed `/api/fleet` returns `{ s, r, pub }` and
has no `uses`. **That was wrong, and the way it was produced is the week's own
failure form:** I printed `rows[0].keys()` and reported it as the shape of every
row. Row 0 is `components`, which has no `uses`.

Measured across **all** rows (2026-08-19):

```
fields across all rows   s · r · pub · src · uses · note · isNew
rows with a non-empty uses   6 of 11

  cardmem  uses = lens · seti-client · seti-server
  trail    uses = lens · secret-scan · mail
  sanne    uses = lens · mail
  xrt81    uses = lens · forms-turnstile
  fds      uses = lens · webpush
  fdaa     uses = mail
  storeform            — NO ROW AT ALL
```

**Two defects, and the second is worse than a missing field.**

**1 · `uses` on `/api/fleet` is HAND-WRITTEN.** It lives in
`scripts/inventory-data.mjs`, not in the enrollment table. cardmem's row lists
`lens`, `seti-client`, `seti-server` — and omits `lens-engine`, which their
daemon demonstrably imports (`resolveTarget`, since their F074.23). So the field
is **stale by construction: it agrees with whoever last edited the roster and can
never contradict them.** Same shape as the `detail` field this repo fixed in
F071.6 — see [[a-field-that-cannot-contradict-you]].

**2 · A repo that HAS self-reported is absent from the fleet map entirely.**
`GET /api/sessions/storeform` returns their enrolment, twenty days old:

```json
{"pkg":"@broberg/lens-client","version":"0.1.0","role":"uses","updated_at":1783120403176}
```

`/api/fleet` has no storeform row. The data exists on the write side and is lost
on the way to the read side. **An absence does not look like a hole** — I looked
at the fleet map, saw no storeform, and reasonably concluded they had nothing to
do with Lens. An empty `uses` field would at least have shown the row existed.
storeform's reading: *"we have not recorded it" and "we never looked" cannot be
told apart from the call-site* — the week's failure form, now in the registry
itself.

## The thing neither defect would have fixed

storeform's second point, and it decides the shape: **even a complete index would
not have saved this release note.** They consume `@broberg/lens-client`, not
`@broberg/lens-engine`. A correct lookup for "who depends on lens-engine" still
would not have found them — and that is the *right* answer, because they do not
have it.

So the query must be **exact on the package name**, never on the capability. That
was the whole distance between "who uses Lens" and "who has the package
installed", and an index that blurs it reintroduces the defect with better data.

## Design — cardmem's, adopted

They declined a better registry and asked for something narrower: *an endpoint
that answers a question it can actually answer.*

1. **Name the field for what it IS.** `declared_dependents`, not `users`. A field
   called `users` that means *self-reported declarers* is the same failure family
   as a `detail` that reads like an answer.

2. **The answer carries its own scope IN THE PAYLOAD, never in the docs:**

   ```json
   { "package": "@broberg/lens-engine",
     "declared_dependents": ["cardmem"],
     "enrolment": "voluntary",
     "repos_that_have_ever_enrolled": 14,
     "repos_known_to_the_fleet": 29,
     "warning": "absence here is NOT evidence of non-use; a repo can execute schemas via the daemon without installing the package" }
   ```

   The last line is the load-bearing one. Had it been in the response yesterday,
   the release note would have gone to the right set.

3. **The authoritative source is involuntary.** Dependencies are in `package.json`
   in git — a scan of the fleet's manifests is complete and checkable, unlike
   self-reporting. Self-reporting stays as a **supplement** (it catches
   *drives-it-without-installing-it*, which a manifest cannot see) but must not
   be the basis.

## Non-goals

- **Keeping the hand-written `uses`.** Fixing its contents is not the fix; a
  curated list is the defect.
- **Transitive resolution**, in a first version. Real — it is exactly what
  storeform checked — but answering the direct question correctly beats answering
  both approximately.
- **Scanning from Discovery's runtime.** It has no filesystem access to the repos
  and should not grow one; the manifest scan belongs where the checkouts are.

## Open questions

- Does a repo that drives a package as a *service* want a role of its own?
  storeform's position suggests a third value — *drives it, does not install it* —
  which is genuinely useful and is not `uses`.
- storeform offered to re-enrol as a clean experiment on whether the lost row is a
  write-side or read-side failure. One call from them, and it decides where to
  look first.
