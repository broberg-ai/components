# F064 — `lens-engine` assert: kill the false green

> Consumer-filed defect from **cardmem** (#19259), measured against the running engine.
> **Severity: this is a verification tool that cannot fail.**

## Motivation

`packages/lens-engine/src/flow.ts:279-284`:

```ts
case 'assert': {
  const result = await page.evaluate(step.js);
  if (!result) throw new Error(`assert failed (falsy): ${step.js}`);
```

Two defects in three lines.

**1. Every object is truthy.** `{ pass: false, detail: '…' }` — the natural shape, and the one the shared docs teach — passes. Permanently. An assert written on the contract's own form **can never fail**.

**2. `page.evaluate(string)` evaluates an EXPRESSION**, not a function body, so `return …` is a `SyntaxError` and `await` is impossible. That one is at least loud (a false RED), but it rejects exactly the form the docs teach.

cardmem measured it through their daemon's `/lens/flow`, which hosts our `runFlow` — three probes, not inferred from reading code:

| js | engine's answer |
|---|---|
| `({pass:false})` | **passed** ← can never fail |
| `false` | failed — "assert failed (falsy)" |
| `return document.title.length > 0` | failed — "SyntaxError: Illegal return statement" |

**Row 2 is the discriminator, and it is why row 1 matters.** It proves the assert genuinely *runs* — so "passed" on `{pass:false}` is a real false green, not a skipped step.

**Why this is urgent rather than tidy:** this is the surface **Cloud Lens** runs on, and cloud-Lens is the path for every repo without a local daemon. A false green there is a false green for the whole fleet — and it is invisible, because *an assert that cannot fail looks exactly like an assert that passed.*

## Scope

Adopt cardmem's semantics (already sealed by tests in `broberg-ai/cardmem`, `apps/agent/src/lens/`), rather than reinventing them:

1. **Expression wrapper first, block wrapper as fallback** — so both `x === y` and `return x === y` work. Both **async**, so `await` works.
2. **Read `.pass`** when the value is an object carrying that property; otherwise keep today's truthiness.
3. **Stringify `detail` inside the page** before it crosses the boundary — a DOM node in `detail` fails structured-clone and turns a working assert into a mystery evaluate error.
4. **Three distinct outcomes**: *did not compile* ≠ *threw* ≠ *is false*. "Your predicate is false" and "your predicate never ran" are different sentences, and collapsing them is precisely the family of bug being fixed.

### The design question cardmem asked, and the answer

> Should `{pass:false}` FAIL, or should the engine REJECT objects without `pass`?

**Honour the form.** Two reasons:

- A bare truthy object is **legitimate usage today** — `document.querySelector('#x')` returns an Element. Banning objects would break working asserts to fix broken ones.
- Banning turns a dozen silently-green asserts into a dozen errors. Louder, yes, but it discards the shape people actually want to write.

### Non-goals

- **No polling.** cardmem's version retries until a deadline (an element may not have hydrated). Ours is single-shot, and adding a retry loop changes timing for every existing consumer — a separate decision, not something to smuggle into a defect fix. The *syntax vs threw vs false* distinction is kept regardless, because it costs nothing and is half the value.
- No change to any other step, or to the flow grammar.

## Architecture sketch

```ts
// Serialised INTO the page, so compile + run + stringify all happen page-side.
page.evaluate(evalAssertBody, step.js) -> AssertOutcome
  | { kind: 'syntax', message }   // never becomes valid by waiting
  | { kind: 'threw',  message }   // ran, exploded — not a verdict
  | { kind: 'value',  value, detail? }
```

The step then maps those three to three different errors. `detail` reaches the message, so an author who wrote `{ pass:false, detail:'expected 3 rows, got 0' }` gets *that* back instead of a generic verdict.

## Dependencies

None. Playwright already supports `evaluate(fn, arg)`.

## Reuse

This IS reuse: cardmem hit the bug, fixed it on their three local surfaces (F074.39), measured ours, filed it with the probes AND offered their implementation verbatim rather than patching `node_modules` or building a local detour. We take their semantics. No Discovery search applies — we own the package being fixed.

## Rollout

1. Implement; port their `evalAssertBody` shape into the engine.
2. Tests = cardmem's three probes plus the object/detail/await/DOM-node cases — **each proven red against the old code**.
3. `pnpm typecheck` + `pnpm test` green.
4. Bump `0.4.1 → 0.4.2`; push tag `lens-engine-v0.4.2` **alone** (>3 tags in one push triggers nothing).
5. Verify on npm, update `scripts/inventory-data.mjs`, redeploy Discovery.
6. Tell cardmem — and note that Cloud Lens must pick up the new version for the fleet-wide fix to be real.
