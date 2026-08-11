# F065 — Fail at boot when the browser is absent, not at first capture (v0.5.0)

> Co-designed with cardmem, 2026-08-11. Notable mostly for what it *stopped* being.

## How this arrived — two designs, both killed by measurement

**Design 1 (cardmem's, and I agreed):** move `playwright` from `dependency` to
`peerDependency`, so a consumer that bakes browsers into its image gets an
install-time warning when the engine's requirement drifts from what they baked.

cardmem attached a condition rather than a request: *prove that pnpm actually
warns, instead of assuming it.* I built that negative control first. It does not.

```
peerDependencies: { playwright: "^1.61.1" }, consumer declares nothing:

  pnpm install
    Packages: +4
    Done in 1.4s
  EXIT=0                       ← no warning. none.
  .pnpm/playwright@1.62.1      ← silently auto-installed
```

pnpm auto-installs peers by default (v8+; both `auto-install-peers` and
`strict-peer-dependencies` unset here). So it resolved **1.62.1** — inside
`^1.61.1`, but not the 1.61.1 cardmem bakes. **Worse than today**: a
deterministic ordinary dependency would have become a free-floating version that
does not even appear in the consumer's own `package.json`. We would have built
the exact trap we set out to remove and called it a fix.

Only when the consumer declares a *conflicting* version does pnpm speak:

```
consumer pins playwright 1.55.0, engine peer wants ^1.61.1:
  WARN  ✕ unmet peer playwright@^1.61.1: found 1.55.0
  EXIT=0                       ← a warning, not a failure
```

A WARN with exit 0 scrolls past in a Docker build. Design 1 is dead.

**Design 2 (mine):** export the Playwright version the engine was built against
and assert it at startup.

cardmem killed this one too, and their reason is sharper than the proposal:
**version is a proxy; the browser revision is the thing.** Measured in their
process, without launching anything:

```
chromium.executablePath() → …/ms-playwright/chromium-1228/…/Google Chrome for Testing
exists on disk            → true
```

Playwright encodes the **revision** in the path. That makes an existence check
an *exact* predicate instead of a heuristic one, and it beats a version compare
in both directions:

- **No false alarms.** Two Playwright versions often share a browser revision
  (typical at patch bumps). A version-string compare would shout about something
  that works — and an alarm that cries wrong is switched off within a week.
- **No false approvals**, which matters more: **the version can match while the
  browser is missing.** If a base image changes without the package changing, a
  version assert says "fine" and the first capture fails anyway. My design could
  not see that case. The path check sees both.

## The change

```ts
// exported; also called internally before the first launch
export function assertBrowserAvailable(): void
```

- Resolve `chromium.executablePath()` (wrapped — it throws if the browser type
  is not installed at all), then check the path exists.
- On failure, throw with the expected path **and**
  `PLAYWRIGHT_BROWSERS_PATH` (or `(unset)`), because those two lines are the
  whole diagnosis.
- The Playwright version belongs **in the message** as diagnostics — never in
  the predicate.

**Throw, not warn.** My worry was that a hard failure also stops deploys where
the mismatch was harmless. That argument holds against a *version compare*,
where "harmless mismatch" is a real category. It does not hold against a missing
executable: there is no harmless version of *the browser is not there*. The
first capture fails regardless. So the only choice is **fail at boot, where it
is a failed deploy**, or fail at the first user action in production.

**Default on, no flag.** cardmem's rule, and it matches what the fleet decided
about template rollout the same day: *a protection you have to remember to
enable only protects the people who did not need it.*

## Non-goals

- Not moving `playwright` to a peerDependency. Measured above; it makes things
  worse.
- No launching a browser to check. The assert must be cheap enough to run at
  boot in every consumer.
- Not checking WebKit/Firefox presence unless a consumer asks — Chromium is what
  `getBrowser()` launches today.

## Rollout

Ship as **0.5.0**. On a `0.x` package the minor IS the breaking position: a
caret (`^0.4.2`) will never resolve `0.5.0`, so no consumer is upgraded into a
new throw without deciding to. That property is the same one buddy surfaced this
week, used deliberately.

## Related

- F064 — the previous lens-engine defect; same consumer, same week
- The rule this instantiates: *the absence of a warning looks like approval* —
  here in package metadata rather than in code
