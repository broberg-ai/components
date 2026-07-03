# F046 — @broberg/lens-engine: shared Lens capture/flow engine

**Status:** planned — design LOCKED with cardmem (intercom #15662→#15664, 2026-07-03). Awaiting cardmem's code/PR delivery; no rush (the daemon migration must be done slowly).
**Owner:** `components` (owns + reviews + publishes the npm). **Code originator:** `cardmem` (wrote the newest/cleanest engine in `apps/lens-cloud/src`; delivers the extraction as a PR — secret-scan precedent: originator delivers, components publishes).
**Coordinates with:** cardmem **F215.1** (their side: migrate lens-cloud + the daemon onto the published package).

## Motivation
There are now TWO drifting capture engines in the fleet: the cardmem **daemon** (`apps/agent/src/lens`, ~5575 LOC — capture+flow+critic+verify+baselines+video+scrape) and **lens-cloud** (`apps/lens-cloud/src`, ~1655 LOC — capture + full flow-step grammar + self-healing locators: F215.7 DOM-layer testid→css→role→label→placeholder→text + F215.8 vision via Set-of-Marks). The self-healing locators + the frozen flow-grammar live ONLY in cloud, so every future improvement must be written twice or the two engines drift. Classic single-source drift — exactly what `@broberg/*` exists to kill.

## Key architecture decision (the load-bearing call)
**The engine does NOT go into `@broberg/lens`.** Verified 2026-07-03: `@broberg/lens@0.1.2` is a 325-LOC, ZERO-runtime-dep mint/compliance surface (only `hono` as a peer), imported by apps' AUTH/mint flows. Folding a ~1655-LOC Playwright engine into it would drag Chromium into EVERY mint consumer — an app that only mints a Lens session must never install Playwright. Two fundamentally different dependency profiles → **two packages**.

- **`@broberg/lens`** — stays the clean, dep-free mint/compliance surface. **Untouched by this epic.**
- **`@broberg/lens-engine`** (NEW) — the heavy capture/flow engine, Playwright as a direct dep, its own version cadence.

## Scope (in) — the SHARED core to package (from cardmem `apps/lens-cloud/src/`)
- **capture.ts** — warm-browser lifecycle (getBrowser/idle-close), settle, takeShot, viewport/device-resolve, `capture(body) → { png, dom_hash, dims, title }`.
- **flow.ts** — `runFlow` + step-grammar (goto/click/fill/type/press/select/upload/waitFor/assert/expectText/expectVisible/screenshot) + self-healing `resolveTarget` (DOM-layer) + `plannedLayers`.
- **vision.ts** — Set-of-Marks (markInteractive/clearBadges/resolveVisionElement) via `@broberg/ai-sdk` (route env-configurable); ship-dark `visionEnabled`.
- **schema.ts** — the whole Zod boundary (captureBodySchema, flowBodySchema, locateSpecSchema/targetSchema, uploadFileSchema, mintAuthSchema, storageStateSchema).
- **mint.ts** — storageState fetch/apply (mint-auth for capture). Can live in engine or as a thin adapter — decide at packaging.
- **tests** — port lens-cloud.test.ts (39, offline: schema + plannedLayers + Set-of-Marks gate + upload one-of) as the package regression fixture.

## Scope (out)
- **Stays daemon-side (NOT in engine):** baselines/store, DOM/vision critic, verify, video, scrape. These sit ON TOP of the engine; the engine is capture+flow+locators only.
- **Stays app-side (consumer responsibility):** `r2.ts` (storage), `auth.ts` (Bearer), `service.ts` (R2 wiring), `index.ts` (Hono), `mcp.ts` (MCP surface). The engine returns PNG bytes; storage/serve is the consumer's job.
- **The migrations themselves** (lens-cloud, then the daemon) are **cardmem's work** (F215.1), not this epic. components' scope = own + publish the package.

## Public API (agreed shape)
```ts
capture(opts) → artifact   // { png, dom_hash, dims, title }
runFlow(flow) → report      // step results + self-healing resolution layers
```
Zod boundary preserved + exported. Playwright is a dep of `@broberg/lens-engine` ONLY.

## Dependencies
**Runtime:** `playwright` (or `playwright-core`), `zod`, `@broberg/ai-sdk` (vision route). Dev: tsup, typescript, vitest. Mirrors the monorepo conventions (pnpm workspace + turbo + tsup dual ESM/CJS/DTS).

## Migration order (no naked cutover — harness contract)
1. **components publishes `@broberg/lens-engine` v0.1.0** (this epic).
2. cardmem migrates **lens-cloud** onto it (low risk — 39 tests + live proofs guard it).
3. cardmem migrates the **daemon** capture/flow CAREFULLY, test-gated — the daemon is the fleet's primary LOCAL Lens verification; a bad migration breaks localhost verification for everyone. Only the shared core moves; critic/baselines stay on top. (Steps 2–3 are cardmem F215.1.)

## Acceptance criteria (epic)
- `@broberg/lens-engine` v0.1.0 on npm; `capture` + `runFlow` + Zod schemas resolve + types.
- Playwright is a dep of `@broberg/lens-engine` ONLY; **`@broberg/lens` stays 0-runtime-dep, untouched.**
- Ported 39 offline tests green (schema + plannedLayers + Set-of-Marks gate + upload one-of).
- Discovery roster lists F046 @broberg/lens-engine; components self-enrolled.
- lens-cloud migratable onto it (cardmem confirms parity) — the proof the extraction is faithful.