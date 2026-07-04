# F050 — @broberg/lens-engine: export standalone resolveTarget for daemon self-heal parity (v0.1.2)

**Status:** in progress · **Owner:** components · **Package:** `@broberg/lens-engine` · **Source:** reuse-first request from cardmem (intercom #15976)

## Motivation

Storeform must drive **App Store Connect** (device/IP-bound 2FA) to self-heal-fill Apple's testid-less fields. The **cloud** Lens self-heals (LocateSpec, F215.7) but Apple **rejects the cloud Fly-IP**, so ASC can only be driven from the **local daemon** running on Christian's IP. But the daemon's flow-runner is testid/CSS-only — a `role`/`label` target is hard-rejected (`fill step requires a string testid`). So right now **no surface** can run a self-heal-fill against ASC from Christian's IP.

The engine (@broberg/lens-engine@0.1.1) HAS the self-heal resolver — but it lives as a **private** `resolveTarget` inside `runFlow` (flow.ts), not exported. The daemon can't reuse it without reimplementing the layered self-heal = exactly the drift the single shared engine (F046) exists to prevent.

## Scope

Extract + **export** a standalone resolver so BOTH cloud `runFlow` AND the daemon call **one** function:

```ts
export async function resolveTarget(
  page: Page,
  target: Target,               // string (CSS/testid) OR self-healing LocateSpec
  opts?: { action?: string },   // label for the not-found error only
): Promise<{ locator: Locator; resolved_via: string }>;
```

Layer order unchanged: `testid → css → role → label → placeholder → text` + the Set-of-Marks vision fallback. `resolved_via` = the matching layer (same field as `FlowStepReport.resolved_via`). Throws cleanly on no-match (never guesses). Exported from the package root. `runFlow` is rewired to call this SAME function (additive; string targets + behavior unchanged).

### Non-goals
- No behavior change to `runFlow` (same resolution, same `resolved_via` surfaced).
- No Frame scope yet — `Page` matches the daemon's need (it drives a Page; vision fallback screenshots a Page). Widening to `Page | Frame` for the DOM layers is a trivial follow-up if a consumer needs it.
- No Playwright version change in the engine (stays 1.61.1).

## Architecture / cross-version safety

The resolver **never constructs** a Page — it receives `page` and calls only stable Locator-factory methods (`getByTestId`/`getByRole`/`getByLabel`/`getByPlaceholder`/`getByText`/`locator`). So it is **runtime duck-typed-safe across Playwright minor versions** (daemon 1.60.0 vs engine 1.61.1). Recommendation to cardmem: align the daemon to playwright 1.61.1 (patch bump, matches the engine) so the TYPES also match exactly — one Playwright version across the Lens surfaces = less drift. If they stay on 1.60 short-term, runtime is safe; they cast their Page at the call.

## Testing

- **Offline unit** seals the public contract: `resolveTarget` is exported; a **string** target resolves via `'selector'` with the testid-wrapped locator (`resolveSelector`); a nullish target throws with the action label. (The live DOM-layer resolution against a real page is proven by the consumer — the daemon — same division as F046/F049; the package's tests stay offline.)

## Rollout

1. components ships `@broberg/lens-engine@0.1.2` via OIDC tag `lens-engine-v0.1.2` (no OTP).
2. components reports the version to cardmem.
3. cardmem adds the engine as a daemon dep + wires the daemon's flow-steps through `resolveTarget` (additive; string targets untouched), then proves ASC self-heal-fill from the local daemon.
4. Discovery roster bumped to ver 0.1.2.

## Dependencies
None new. `@broberg/lens` stays untouched (dep-free).