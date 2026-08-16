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

## Rollout

1. `.strict()` + tests (RED first against today's silent-drop).
2. `timeout_ms` inlet + tests, including the unchanged-default control.
3. Mutation pass — reverting each decision must redden a different set.
4. Tell cardmem the exact version before it ships; publish via the
   `lens-engine-v*` OIDC tag.
5. `@broberg/lens-client` picks it up and exposes the field on its own surface.
