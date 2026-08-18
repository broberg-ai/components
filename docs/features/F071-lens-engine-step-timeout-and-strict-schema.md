# F071 — lens-engine: a settable step timeout, and a schema that refuses instead of dropping

**Status:** planned · **Filed by:** cardmem (#20630) · **Owner:** components

## Motivation

cardmem reported three findings against `@broberg/lens-engine`. They measured on
**0.4.1** and said so explicitly — *"jeg har målt på 0.4.1's dist, ikke på 0.6.1,
og vil ikke påstå noget om jeres nyeste"*. That caveat is the reason this plan
exists in the shape it does: **I re-measured against 0.6.1 before accepting any
of it**, and both of the two I am taking still reproduce.

```
flowStepSchema.safeParse({ action:'click', target:'#save', timeout_ms:1000, timeout:1000 })
  ok: true
  survived: {"action":"click","target":"#save"}          <- BOTH fields gone, silently

flowBodySchema.safeParse({ …, timeout_ms:5000, wat:true })
  ok: true
  survived: {"base_url":…,"steps":[…]}                    <- same

flowStepSchema.safeParse({ type:'click', target:'#x' })  -> rejected   (finding 3)
```

### Why now

cardmem had just closed **F074.51**, where the daemon's step-level `timeout_ms`
was accepted and ignored. Measured on the wire: `timeout_ms:1000` produced
**15.03s** and the message *"Timeout 15000ms exceeded"* — a number the caller
never chose. **storeform believed Google Play Console was slow for two days.**

The daemon half is fixed. This is the engine half — and the engine path is the
one we recommend to the fleet through `@broberg/lens-client`. It is currently the
poorest of our three paths and the one we point people at.

> **cardmem's formulation, adopted verbatim: a missing capability fails visibly;
> an ignored field lies.**

This is the third instance this week of one answer collapsing two different
facts: `greppable` reporting clean after reading zero files, `/api/peer/ask`
answering `ok:true` for a session that has never existed, and now a schema that
says yes to a field it deletes.

## Reuse

There is no build-vs-reuse question here — the capability *is* ours
(`@broberg/lens-engine`, F046). The reuse decision worth recording is **which of
our three Lens paths gets the fix**: the daemon grammar (already fixed by
cardmem in F074.51), the engine (this plan), and `@broberg/lens-client` (a thin
client over the engine, so it inherits). The engine is the right layer because it
is the one that actually calls Playwright, and because it is the layer we
advertise.

## The correction that makes this small

cardmem wrote that the engine has *no* per-step timeout machinery. **That is not
right, and the difference matters.** The timeout is already threaded end to end:

```
locator.click({ timeout: timeoutMs })
locator.fill(…, { timeout: timeoutMs })
locator.pressSequentially(…, { timeout: timeoutMs })
locator.press(…, { timeout: timeoutMs })
locator.selectOption(…, { timeout: timeoutMs })
locator.setInputFiles(…, { timeout: timeoutMs })
settle(page, step.waitFor, timeoutMs)
takeShot(page, mode, null, timeoutMs)
```

Only the **inlet** is missing:

```ts
flow.ts:356    const timeoutMs = DEFAULT_TIMEOUT_MS;   // 30_000, a const, no way in
```

So this is not *"build timeouts"*. It is *"open the pipe that is already laid"* —
one schema field and one line that reads it. Recorded because it changes the risk
calculation on a grammar we froze deliberately.

## Scope, in this order

**The guard ships before the capability, and the order is not negotiable.** If the
field lands first, a consumer who mistypes it (`timeout`, `timeoutMs`,
`timeout_s`) is in exactly the position cardmem's consumers were in yesterday —
and the new feature would have *created* a fresh instance of the bug it was meant
to close.

1. **`.strict()` on `flowBodySchema` and on every member of `flowStepSchema`.**
   An unknown key is rejected, by name, in the error.
2. **`timeout_ms` on a step** (optional, bounded), plus **`timeout_ms` on the
   body** as the default for every step. Step beats body; body beats the built-in
   30s.
3. **The chosen value must appear in the failure.** A timeout error that reports a
   number the caller did not choose is the original F074.51 symptom, and it must
   be impossible to reproduce from this layer.

## Non-goals

- **Finding 3 — the `action` vs `type` discriminator mismatch — is NOT being
  fixed**, and cardmem agrees. It fails **visibly**: the discriminated union
  rejects a `type`-keyed step outright. Changing the discriminator would break
  every existing flow in the fleet to spare people an error message they already
  get. A visible failure is not worth a breaking change.
- No whole-flow budget in this epic. It is a real gap (an idea is already
  captured for it) but it is a different mechanism — a deadline across steps, not
  a limit per step — and bundling them would hide which one a timeout came from.
- No change to the locator grammar, the capture modes, or the vision fallback.

## The breaking change, stated plainly

**`.strict()` will start rejecting flows that pass today.** That is the point, not
a side effect: every flow it breaks is a flow carrying a field that has never done
anything. But a consumer whose manuscript "works" today will see it fail after the
bump, and they are entitled to know before it happens rather than after.

So: tell cardmem **before** publishing, not after — they hold the largest corpus
of real flows and can measure the blast radius in a way this repo cannot. A minor
bump with a loud changelog entry, and the error names the offending field so the
fix is mechanical.

## F071.2 — a bare tag name is silently reinterpreted (found during F071.1's review)

The same family, one layer further in, and found by the corpus check that F071.1's
review demanded. cardmem ran **every** `clickSelector`/`fillSelector` argument the
fleet has ever sent — 224 calls, 115 unique selectors — through this package's own
`resolveSelector`, copied out of the shipped dist rather than retyped:

```js
const looksLikeCss = /[.#\[\]:>~+*()="' ]/.test(selector);
return looksLikeCss ? selector : `[data-testid="${selector}"]`;
```

114 of 115 passed through unchanged. **One did not, and it is a class rather than
a one-off:**

```
"body"  ->  [data-testid="body"]      matches nothing, and says nothing
"main"  ->  [data-testid="main"]
"form"  ->  [data-testid="form"]
"h1"    ->  [data-testid="h1"]
```

Reproduced here against 0.7.0's dist before accepting it. A bare element selector
carries no CSS punctuation, so the heuristic reads it as a test-id and rewrites
it. The locator then matches zero elements — **not an error, just nothing** —
which is the exact shape of everything else in this epic: the input is accepted,
silently altered, and the failure arrives somewhere else wearing a different face.

**The heuristic itself is not the thing to change.** `main` is a plausible
`data-testid` value as well as a plausible tag, so no rule can read a bare string
correctly every time. The ambiguity is inherent in the bare-string convenience,
and `LocateSpec` already offers both explicit forms (`{ css }`, `{ testid }`).

**What must change is the silence.** When a bare string was rewritten to a
test-id selector and the locator finds nothing, the failure has to say which
reading was taken and name the other one — turning a zero-match into a one-line
fix instead of a hunt.

**Shipped in 0.7.1.** `selectorMissHint(original)` returns the sentence, or
`null` when it would be noise, and `execStep` attaches it to a step failure only
when the locator really did resolve to zero elements:

```
locator.click: Timeout 30000ms exceeded.
waiting for locator('[data-testid="body"]')

"body" has no CSS punctuation, so it was read as a data-testid VALUE and resolved
to [data-testid="body"] — which matched nothing. "body" is also an HTML element
name: if you meant the element, pass { css: "body" }; if you meant the test id,
that element does not exist yet.
```

The element-name list explains a miss; it never decides a resolution. That
distinction is the whole story — a mutation that moves the list into
`resolveSelector` is in the pass precisely because it *looks* like the same fix
and is a breaking change for anyone whose test id is an element name.

### The acceptance criterion that could not be met as written

AC#6 asked for two mutations with **non-overlapping** red sets — hint-removal
reddening only the hint tests, heuristic-change reddening only the pins.
Measured, the second set strictly contains the first:

```
hint removed        →  9 red
heuristic changed   → 11 red   (the same 9, plus 2)
shared              →  9
only-heuristic      →  the two resolveSelector pins for "body" and "main"
only-hint           →  (empty)
```

**That is not a gap in the tests; it is a property of the code.** The hint is
downstream of the heuristic — teach `resolveSelector` about tag names and nothing
is rewritten, so there is nothing left to hint about and the hint tests fail too.
No test of the hint can be independent of the rule it explains.

What the criterion was reaching for *is* satisfied: the suite tells the two
decisions apart, because the two pins redden for one mutation and not the other.
The wrong unit here is the same error as F073's *"the verdicts must sum to 419"*
— a plausible-sounding number written before the thing was measured. Recorded
rather than quietly re-scoped.

A third mutation carries the property the other two cannot: dropping the
zero-match check (`if (count !== 0) return err`) reddens exactly one test — the
tag-named target that **exists** and failed for another reason. That is the
control that keeps the hint from becoming noise attached to every failure, and it
is genuinely orthogonal to both others.

Also worth recording, because it settles a worry rather than raising one: every
Playwright selector-engine form in the corpus — `:has-text()`, `:visible`,
`>> nth=3`, `text=`, `:nth-match()` — passes through untouched. Nothing to
implement there.

> **cardmem's method is the transferable part.** Their first pass used a
> hand-written regex for "is this a Playwright dialect" and it was wrong in both
> directions: a false positive on `[data-cms-richtext="true"]` (the substring
> `text=` sits inside `richtext="true"`) and a false negative on
> `:nth-match(.dp-trigger, 2)`. It was also answering the wrong question — *"is
> this plain CSS"* rather than *"what does the engine DO with it"*. The only
> correct instrument was our own shipped function, and it was sitting in
> `node_modules` the whole time.

## Rollout

1. `.strict()` + tests (RED first against today's silent-drop).
2. `timeout_ms` inlet + tests, including the unchanged-default control.
3. Mutation pass — reverting each decision must redden a different set.
4. Tell cardmem the exact version before it ships; publish via the
   `lens-engine-v*` OIDC tag.
5. `@broberg/lens-client` picks it up and exposes the field on its own surface.
