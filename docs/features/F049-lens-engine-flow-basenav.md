# F049 — @broberg/lens-engine runFlow base_url auto-navigation parity (v0.1.1)

**Status:** in progress · **Owner:** components · **Package:** `@broberg/lens-engine` · **Source:** lens-gap reported by cardmem/storeform (intercom #15924)

## Motivation

Storeform, driving the **hosted** Lens (`lens.cardmem.com`, which runs `@broberg/lens-engine`), hit a behavioral divergence from the **local daemon** flow-runner (`cardmem apps/agent/src/lens/flow.ts`):

- The **daemon** auto-navigates to `base_url` before step 0.
- The **engine** (`runFlow`) does **not** — it creates the page and runs step 0 immediately, so a flow whose first step is `click`/`fill`/… executes on `about:blank`.

So a flow **without a leading `goto`** works on the daemon but fails step 0 on a blank page in the cloud. Storeform patched around it by injecting a leading `goto base_url`. That is exactly the drift the single shared engine (F046) exists to prevent — **consumers must not have to know which Lens surface they hit.**

## Scope

`runFlow` auto-navigates to `base_url` **before step 0** when the first step is **not already a `goto`** (idempotent — a leading `goto` makes this a no-op). Achieves parity with the daemon; backward-compatible.

### Non-goals
- No change to the `goto` step, the step grammar, or the Zod schema.
- No change to auth/`storageState` handling.
- The implicit nav is **not** a reported step on success (declared steps keep indices `0..n-1`, matching the daemon) — only surfaced as a failed step if the nav itself fails.
- No behavior change for flows that already start with a `goto`.

## Architecture

Extract the decision as a **pure, exported** function (mirrors `plannedLayers` — sealed by an offline unit test so the parity contract can't silently drift):

```ts
/** The implicit setup nav before step 0. Returns the base_url to pre-navigate
 *  to, or null when a leading `goto` already handles it (idempotent) or there is
 *  no base_url. */
export function leadingNavigation(body: Pick<FlowBody, 'base_url' | 'steps'>): string | null {
  if (!body.base_url) return null;
  if (body.steps[0]?.action === 'goto') return null;
  return body.base_url;
}
```

`runFlow` calls it right after `context.newPage()`. The navigation is wrapped so a failure yields a **clean failed `FlowResult`** (contract: a failed flow is DATA, never thrown out of `runFlow` — `@broberg/lens-client` relies on this). On success the nav is implicit (not pushed to `steps[]`).

## Testing

- **Offline unit** seals `leadingNavigation`: non-goto-first → `base_url`; goto-first → `null`; no `base_url` → `null`. (The package's tests are 100% offline — real-browser behavior is verified by the consumer, per the existing test strategy.)
- **Runtime browser parity** is verified **live by cardmem**: they bump the `@broberg/lens-engine` dep in `apps/lens-cloud`, redeploy cardmem-lens, and run a real flow-capture WITHOUT a leading goto (must land on `base_url` before step 0). Same division as the F046 migration proof.

## Rollout (sequence matters)

1. components ships `@broberg/lens-engine@0.1.1` to npm via OIDC tag `lens-engine-v0.1.1` (Trusted Publisher — no OTP).
2. components reports the version to cardmem + storeform.
3. cardmem bumps the lens-cloud dep, redeploys, verifies parity live.
4. **Only then** cardmem tells storeform to remove their injected leading goto (not before — else storeform breaks against still-old cloud).
5. Discovery roster bumped to ver 0.1.1.

## Dependencies
None new. `@broberg/lens` stays untouched (dep-free).