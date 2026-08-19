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

## What is actually there — measured three times, wrong twice

**The endpoint already exists, and it would have answered the question.**
`GET /api/enrollments` serves the live self-reported roster: 92 rows, 20
sessions. Asked about the release I got wrong:

```
@broberg/lens-engine   cms 0.4.0 (uses) · cardmem 0.4.2 (uses) · components (src)
@broberg/lens-client   storeform 0.1.0 (uses) · autodoc 0.1.0 (uses) · components (src)
```

storeform is not on `lens-engine`. **Had I read this endpoint, the wrong release
note would never have been written.** The failure was not a missing capability —
it was that nothing in the release path points at the endpoint that exists, and I
never looked. Which is this card's own thesis, now with the sharpest possible
evidence: *the control was already built and went unused.*

Two earlier readings of this section were wrong, and both are worth keeping
because they are the same mistake at different depths:

1. *"`/api/fleet` returns `{ s, r, pub }` and has no `uses`."* Produced by
   printing `rows[0].keys()` and reporting it as the shape of every row. Row 0 is
   `components`, which has no `uses`. Six of eleven rows carry one.
2. *"the reverse index does not exist."* It does. I checked `/api/fleet` and
   `/api/sessions/:s`, and stopped one endpoint short.

### The real defect: two sources, and the hand-written one is a fiction

`app.get("/api/fleet", c => c.json({ count: FLEET.length, fleet: FLEET }))` —
`FLEET` is the hardcoded array in `scripts/inventory-data.mjs`. It never touches
the enrollment table. Measured against the live data (2026-08-19):

```
session      hand-written /api/fleet          live /api/enrollments
components   -                                -
buddy        -                                ai-sdk, cron, db-sdk, fleet-contracts, secret-scan
upmetrics    -                                @upmetrics/sdk, config, lens, mail
cardmem      lens, seti-client, seti-server   ai-sdk, apikey, auth, gravatar, lens, LENS-ENGINE,
                                              mail, media-transform, seti-client, seti-server, webpush
trail        lens, mail, secret-scan          + ai-sdk, apikey, speech-dictionary
sanne        lens, mail                       + @upmetrics/sdk, ai-sdk
cms          -                                @upmetrics/sdk, ai-sdk, LENS-ENGINE, mail
xrt81        forms-turnstile, lens            + ai-sdk, config, cron, gravatar, mail, mcp, media, media-transform, webpush
fds          lens, webpush                    ai-sdk, lens          ← webpush claimed, not enrolled
fdaa         mail                             -                     ← claims one, has none
```

**Ten of eleven rows disagree.** And ten enrolled sessions have no row at all:
`storeform`, `autodoc`, `torrent-search-api`, `fd-sundhed`, `sanneandersen`,
`beacon`, `cronjobs`, `pitch-vault`, `happy-little-place`, plus one enrolled
under a raw UUID instead of a name.

The hand-written list is wrong in **both** directions — it omits `lens-engine`
for cardmem (the fact I needed) and claims `mail` for `fdaa` (who never enrolled
it). It agrees with whoever last edited the roster and with nothing else. Same
shape as the `detail` field fixed in F071.6 — see
[[a-field-that-cannot-contradict-you]].

### And storeform's experiment localised the other half

They re-enrolled as a clean test (#21445):

```
POST /api/enroll            → 200 {"ok":true,"key":"matched"}, updated_at moved
GET /api/sessions/storeform → the row is there, fresh, with their probe note
GET /api/fleet   before     11 rows · storeform 0
GET /api/fleet   after      11 rows · storeform 0
POSITIVE CONTROL: the fleet response is BYTE-IDENTICAL before and after
```

The byte-identical control is what makes it a diagnosis rather than a guess: had
`/api/fleet` merely been slow or cached, something would have moved. **The write
side is fine; the read side never consults it.** Exactly what a hardcoded array
predicts.

**This strengthens the case for an involuntary basis rather than weakening it.**
Self-reporting works here — the key matched, the row was written, the timestamp
moved. It is not an unreliable input; it is simply never read by the surface
people look at.

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
