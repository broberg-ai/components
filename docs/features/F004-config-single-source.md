# F004 — Config single-source helper

> L0 Rails · runtime-package · effort **S** · impact **high** · owner `xrt81`. Status: Backlog.
> LEAP-candidate: no — stays in `components`.

## Motivation
A framework-agnostic TypeScript utility that enforces the "one source, trickle down" rule across the fleet. Two primitives: a Zod-based env parser that validates + types `process.env` at boot (fail-fast with a clear list of offending keys, not a confusing deep runtime crash), and a `defineConfig` factory for typed business-constant objects (fee tiers, shop settings, magic numbers) that prevents values being re-declared across files. Thin wrappers — type-safety, boot-time validation, a conventional import boundary; not abstraction for its own sake. This is Christian's UFRAVIGELIG "ALDRIG hardcoded values" rule as a reusable mechanism (the sanneandersen.dk URL hardcoded in 9 files is the motivating incident).

## Solution
**runtime-package.** The env-parsing pattern exists in 3 repos with near-identical intent but diverging implementations: xrt81 has the most complete Zod envSchema+parseEnv (packages/shared/src/env.ts); upmetrics has a hand-rolled int coercer + production-guard (apps/server/src/config.ts); sanneandersen has no central validator at all (fee/shop config as plain objects). Syncing manually is already painful. The core is stable (Zod parse + a defineConfig identity fn change rarely). Per-repo schema *content* stays in each repo — only the parser machinery is shared.

## Scope

### In scope
- Extract from `broberg/xrt81` `packages/shared/src/env.ts` (parseEnv + Zod schema machinery).
- Add coerceInt/coerceBool + productionGuard (from upmetrics config.ts lines 79-86).
- defineConfig identity factory for business-constant objects.

### Out of scope
- The per-repo schema content / business values themselves.
- A clientEnv build-time NEXT_PUBLIC_* validator (forward-looking only).

## Architecture

### Best source (reference implementation)
`broberg/xrt81` — `packages/shared/src/env.ts`: full Zod schema with coercions, optional/required discrimination, typed defaults, `parseEnv(source?)` accepting any Record (testable), and an error message listing every offending variable. 116 lines, no framework coupling.

### Other implementations seen
- `broberg/upmetrics` `apps/server/src/config.ts` — hand-rolled int() + production guard (throw on missing required secret when NODE_ENV=production).
- `webhouse/sanneandersen` `site/src/lib/stripe/fees.ts` + `site/src/lib/shop/config.ts` — the defineConfig target shape (PLATFORM_FEE_PERCENT, SHOP_CONFIG typed consts).
- `broberg/cardmem` `apps/agent/src/config.ts` — DEFAULTS→disk JSON→env merge variant (CLI/daemon).

### Headless core vs. adapters
- **Core (no framework):** parseEnv(schema, source?), defineConfig<T>(config):T (identity), coerceInt(name,fallback), coerceBool(name,fallback), productionGuard(config, requiredKeys[]). Zod is a peer dep.
- **Stack A:** re-exports unchanged; process.env / NEXT_PUBLIC_* behave identically. Optional per-repo serverEnv.ts convention (not in package) to prevent client-bundle secret leakage.
- **Stack B:** re-exports unchanged; Bun exposes process.env identically. coerceInt/coerceBool especially useful for the lightweight no-Zod plain-object pattern.

### Public API
```ts
// @broberg/config
export function parseEnv<T extends z.ZodRawShape>(schema: z.ZodObject<T>, source?: Record<string,string|undefined>): z.infer<z.ZodObject<T>>;
export function defineConfig<T>(config: T): T;
export function coerceInt(name: string, fallback: number): number;
export function coerceBool(name: string, fallback: boolean): boolean;
export function productionGuard<T extends object>(config: T, requiredKeys: (keyof T)[]): void;
```

## Stories
- **F004.1** — Extract parseEnv into @broberg/config — _AC:_ parseEnv(schema) accepts any ZodObject + custom source; on failure throws listing each offending key + Zod message; xrt81 env.ts re-exports from the package with no behavioural change (existing xrt81 tests pass).
- **F004.2** — Add defineConfig + coerce helpers — _AC:_ defineConfig<T> typed; coerceInt matches upmetrics int() (throws on non-int, fallback when absent); coerceBool parses true/false/1/0; all unit-tested.
- **F004.3** — Add productionGuard + document the contract — _AC:_ productionGuard(config,['authSecret','resendApiKey']) throws listing falsy required keys when NODE_ENV=production; mirrors upmetrics guard; tested both ways.
- **F004.4** — Pilot adoption in upmetrics — _AC:_ upmetrics config.ts replaces hand-rolled int() + guard with coerceInt + productionGuard; config shape + types unchanged; dev boots; guard still fires on dev-default AUTH_SECRET.
- **F004.5** — Adopt in sanneandersen (new env layer) — _AC:_ new site/src/lib/env.ts calls parseEnv covering STRIPE_SECRET_KEY, NEXT_PUBLIC_SITE_URL, RESEND_API_KEY; imported at instrumentation entry; missing key = clear startup error not silent undefined.
- **F004.6** — Document business-constant convention — _AC:_ CONVENTIONS.md shows defineConfig using sanneandersen SHOP_CONFIG + PLATFORM_FEE_PERCENT; explains defineConfig is an identity fn (value = typed import boundary).

## Acceptance criteria
1. @broberg/config builds + typechecks clean; core imports no framework packages.
2. Each story (F004.1–F004.6) meets its own AC.
3. Piloted in xrt81 and adopted back with no regression (runtime-verified).
4. A second consumer (upmetrics) migrates off its hand-rolled coercer/guard with identical behaviour.

## Dependencies
- External: zod (peer, ^3).

## Rollout
Strangler: 1) extract parseEnv+defineConfig from xrt81 env.ts + coerceInt/coerceBool/productionGuard from upmetrics → @broberg/config 1.0.0; 2) pilot in xrt81 (re-export = zero behaviour change); 3) adopt in upmetrics; 4) adopt in sanneandersen (no validator today); 5) spread to trail/cardmem/buddy on next touch.

LEAP-candidate: no — stays in `components`.

## Open Questions
- parseEnv accept z.ZodObject only, or also z.ZodEffects (refine/transform) later?
- clientEnv build-time NEXT_PUBLIC_* variant needed (forward-looking)?
- ESM-only or CJS+ESM dual output (fleet is ESM-first)?

## Effort estimate
**S** — owner session: `xrt81`. Reuse model: runtime-package.

## Risks
Next.js NEXT_PUBLIC_* vars must NOT pass through parseEnv server-side (inlined by bundler, absent from runtime process.env) — README must call this out. Zod major conflicts mitigated by peer-dep (>=3) + sticking to ZodObject.safeParse (stable across 3.x). coerceInt/coerceBool are the no-Zod escape hatch.