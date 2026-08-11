# F066 — lens-engine: a plain object without `pass` is an assert that can never fail

**Status:** in progress · **Package:** `@broberg/lens-engine` · **Ships as:** v0.6.0

## Motivation

On 2026-08-11 the fleet ran a cross-repo audit of Lens asserts. Four sessions
independently produced a wrong exoneration, each blind in a different way, and
torrent-search-api found a real bug that had been live for six days: an **empty**
assert had hidden that the right edge of all content sat off-screen on iPhone.
cardmem's corrected sweep found 121 empty asserts fleet-wide.

The question that lands on `components`: does OUR engine — the one both the
hosted cloud Lens and the local daemon import — pass an empty assert?

**Measured against the built `dist/` (what consumers actually install), not a
retyped copy of the predicate:**

| body | verdict |
|---|---|
| `""` | fail ✅ |
| `"   "` | fail ✅ |
| `"\n\t\n"` | fail ✅ |
| `"/* intet */"` | fail ✅ |
| `"// intet"` | syntax error ✅ (loud, never green) |
| `"undefined"` / `"null"` | fail ✅ |
| `"true;"` | fail ✅ (trailing semicolon kills the expression wrapper — fail-safe direction) |
| `"1===1"` | PASS ✅ |
| `"1===2"` | fail ✅ |
| **`"({})"`** | **PASS ❌** |
| **`"return {}"`** | **PASS ❌** |

So the empty-assert class is NOT ours. But the same measurement found a false
green that is.

## The defect

`evalAssertBody` (F064) honours the object form by reading `.pass` **when the
value carries one**, and otherwise keeps bare-truthy semantics. That fallback is
deliberate and correct for its stated reason:

```ts
// keep bare-truthy behaviour otherwise (a querySelector Element is a
// legitimate assert today and must keep working)
```

`- assert: document.querySelector('#drawer.open')` returns an Element, which is
an object, and must keep passing.

But the same fallback swallows the case F064 exists to kill. An author who writes

```js
return { passed: drawer.classList.contains('open'), detail: '…' }   // typo: passed, not pass
```

gets an object with no `pass` key → bare-truthy → **unconditionally green,
forever, regardless of the drawer**. Same for `{ok:…}`, `{success:…}`,
`{result:…}`. This is exactly the 121-empty-asserts class, only with plausible
code inside it, which makes it strictly harder to spot in review.

## Design

The discriminator is clean and cheap: **a DOM Element does not have
`Object.prototype` as its prototype.**

- value is a **plain object** (prototype is `Object.prototype` or `null`) **and**
  has no `pass` key ⇒ **hard error** that NAMES the keys it did carry:
  `assert returned an object with no 'pass' key (got: passed, detail) — did you
  mean { pass }? Return a boolean or { pass, detail }.`
- anything else (Element, array, Date, Map, primitive) ⇒ **unchanged** bare-truthy.

Loud-and-wrong beats silent-and-wrong here: the failure mode of the change is an
author getting a precise error naming their own typo; the failure mode of leaving
it is an assert that is green forever.

`{ pass: false }` and `{ pass: … , detail: … }` are unaffected — they already
take the `.pass` branch.

## Scope

**In scope**
- `evalAssertBody` in `packages/lens-engine/src/flow.ts` — the plain-object-
  without-`pass` branch, plus a new `AssertOutcome` kind so the caller can
  produce a distinct message rather than folding it into `threw`.
- The `runFlow` assert case that consumes the outcome.
- Tests, RED first, including that an Element still passes (the regression this
  change could plausibly cause).
- README + inventory entry.

**Non-goals**
- Banning the object form. It is honoured; this only rejects an object that
  clearly *meant* to be a verdict and missed.
- Empty-assert handling — measured correct already; changing it would be work
  without a defect behind it.
- Anything in the cardmem daemon's own assert path. If the 121 empty asserts live
  there, that is cardmem's to fix; the open question raised to them is whether
  the daemon carries a SECOND copy of the verdict logic, since two copies is the
  actual defect.
- `lens_verify`'s top-level `assert` param — object return is its **documented**
  contract ("return boolean or {pass, detail}"), so it is correct there and must
  not be swept up.

## Reuse

Checked Discovery (`discovery.broberg.ai/api/search?q=assert`,
`?q=verdict`, `?q=test+predicate`) before writing this. Nothing in the
`@broberg/*` inventory owns assert-verdict semantics — `@broberg/lens-engine` IS
the fleet's single home for it, which is precisely why the fix belongs here and
not in any consumer. `@broberg/lens` (mint/compliance) is dep-free and unrelated;
`@broberg/lens-client` calls the hosted service and inherits this engine's
behaviour for free once published.

No new dependency. The prototype check is plain JS.

## Rollout

- Ships as **0.6.0**, not 0.5.1. A caret on a `0.x` version locks the minor, so
  no consumer is carried into a new hard error by an automatic update — they opt
  in by bumping. This is the same vehicle used for 0.5.0.
- cardmem imports the engine in both the cloud runner and the local daemon;
  told them the change is coming (#19684) so the daemon upgrade is deliberate.
- Verify the published tarball by installing it fresh, as with 0.5.0 — a green
  local build is not evidence about what npm serves.

## Risks

| Risk | Handling |
|---|---|
| A legitimate assert returns a plain object meaning "truthy" (e.g. `JSON.parse(x)`) | It now errors loudly with a message naming the keys. Recoverable in one edit; the alternative is a silent always-pass. Called out in the README. |
| The Element path regresses and every existing `querySelector` assert breaks | Explicit test that an Element still passes, and one that an array still passes. This is the regression the change could plausibly cause, so it gets its own named test. |
| The new check itself never fires and we believe it works | Proved RED before green — the test that asserts the throw must be seen failing against 0.5.0 behaviour first. |
