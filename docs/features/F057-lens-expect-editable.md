# F057 — `expectEditable` flow step for @broberg/lens-engine

> **Status:** planned · **Owner:** components · **Package:** `@broberg/lens-engine` (0.3.0 → **0.4.0**)
> **Requested by:** Christian, 2026-07-12 · **Consumers to notify:** cms, sanne

## Motivation

The fleet is rolling out click-to-edit inline editing (`@broberg/cms-inline-edit`'s `wireField`/`wireRichField`) as the gold standard on every `@webhouse/cms` site (broberg.ai now, Sanne next). An element becomes editable by getting `contenteditable=true` on click. Today the ONLY way to prove, in a Lens flow, that a field actually became editable is the generic escape-hatch:

```ts
{ action: 'assert', js: "document.querySelector('[data-testid=bio]').isContentEditable === true" }
```

That is hand-rolled per repo, bypasses the self-healing locator stack (testid→css→role→…), and gives no consistent error or `resolved_via`. `coverage()` (F056) proves a field is *tagged* (`data-cms-field`); it does NOT prove the field is *live-editable* when clicked. That gap is this epic.

## Scope

One new **additive** step in the frozen Zod flow grammar: `expectEditable`.

- **Schema:** `{ action: 'expectEditable', target }` — `target` is the same `LocateSpec` every other step takes.
- **Semantics:** resolve the target via the self-healing locator, wait visible, then assert the element is editable. Editable =
  - `contenteditable` — nearest ancestor carrying the attribute wins (`""`/`true`/`plaintext-only` ⇒ editable; `false` ⇒ not; inherited from an ancestor counts), OR
  - an **enabled, non-readonly** native form control: `<input>`/`<textarea>` not `disabled` and not `readOnly`, or a `<select>` not `disabled`.
- **Pass:** editable. **Fail:** present-but-not-editable → a clear thrown error naming the target (which is how a still-idle field surfaces).
- Predicate extracted as a pure, exported `isEditableElement(el)` so it is offline-unit-testable over jsdom AND serialized into the page via `locator.evaluate` at runtime (one definition, both sides).

## Non-goals

- No `expectNotEditable` (the generic `assert({js})` still covers the negative; add later only if a real consumer asks).
- The step does NOT click to make the field editable — it asserts current state; compose it after a `click` step.
- No new capability in the hosted daemon / MCP — this is the engine primitive; cardmem's flow-runner inherits it automatically because it imports this one engine.

## Architecture

- `src/schema.ts` — add `expectEditable` to `flowStepSchema` (discriminated union).
- `src/flow.ts` — export `isEditableElement(el: Element): boolean` (pure) + add the `case 'expectEditable'` that resolves the target and `locator.evaluate(isEditableElement)`.
- `src/index.ts` — re-export `isEditableElement`.
- `README.md` — add `expectEditable` to the frozen-grammar list + a short usage section.
- `test/editable.test.ts` — jsdom unit tests for the predicate + a zod schema round-trip.

## Dependencies

None new. Additive to the existing grammar; no breaking change to any current flow.

## Rollout

1. Build + typecheck + vitest green.
2. Bump `package.json` 0.3.0 → **0.4.0**; bump the Discovery roster (`scripts/inventory-data.mjs`) lens-engine 0.3.0 → 0.4.0 + note.
3. Commit; tag `lens-engine-v0.4.0`; push tag → token-free OIDC publish (npm@11.5.1). Registry-verify `dist-tags.latest=0.4.0`.
4. Notify **cms** + **sanne** with the exact step usage so they replace their hand-rolled `assert({js})` inline-edit checks.
