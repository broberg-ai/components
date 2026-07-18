# F061 — Build hardening: seal the tsup clean-race across multi-entry packages

> Epic. From idea `019f728a`; Christian GO 2026-07-18. Propagates the fix already shipped in @broberg/pwa 0.2.2 and @broberg/auth 0.1.2. First story: F061.1 (round-1 sweep of bodymap/gravatar/soundkit/stripe).

## Motivation

A tsup **array** config with `clean: true` on one entry non-deterministically wipes the **sibling** entries' `.d.ts` during the DTS emit. It silently dropped `react.d.ts` from `@broberg/pwa` 0.2.1 and `hono.d.ts` from `@broberg/auth` 0.1.2 — two live regressions, each caught only when a consumer's typecheck failed (`TS7016 could not find a declaration file`). A published package that a consumer cannot type-check, with **zero CI signal** at publish time.

A 2026-07-18 scan found **4 more** multi-entry packages carrying the same latent pattern and no seal:

| Package | exports | published tarball today |
|---|---|---|
| `@broberg/bodymap` | 4 (`.`/`./react`/`./three` + `./models/*` asset) | intact |
| `@broberg/gravatar` | 3 | intact |
| `@broberg/soundkit` | 4 | intact |
| `@broberg/stripe` | 2 | intact (**prod-critical payments**) |

All four current tarballs are verified intact (lucky, since the race is non-deterministic) — so **no urgent republish**. The risk is the **next** publish of any of them silently shipping broken types.

## Scope (F061.1 — round 1)

Apply the proven fix to each of the 4 packages, source-only:

1. Remove `clean: true` from the tsup config (one-line comment noting why, matching pwa/auth).
2. Build script → `rm -rf dist && tsup && node verify-exports.mjs` (clean dist ONCE up front, then seal).
3. Add the **generic** `verify-exports.mjs` (reads `package.json` exports, fails the build if any target is missing from dist — byte-identical to the file already in pwa/auth).

### Non-goals

- **No version bumps, no npm publishes** — the seal guards each package's NEXT release; republishing now is unnecessary (current tarballs intact).
- No runtime/API change; no touching the 2 already-sealed packages (pwa, auth).
- Not making verify-exports.mjs a shared package (a 30-line zero-dep build script; copy is cheaper than a dependency). Reconsider if a 3rd duplication pain appears.

## Architecture

The seal is the harness-contract 'wire your own mechanical gate' applied to the build: `pnpm build` (hence the publish workflow's Build step) fails RED if `dist` is missing any file the `exports` map points at. Clean-once removes the race entirely (a single `rm -rf dist` before tsup runs); the seal is the backstop that turns any future regression into a red build instead of a broken tarball.

## Reuse

Reuse-first / harness-contract in action — one proven fix propagated across the fleet so the whole estate is immune, not just the two packages that already bled. No Discovery search applies (hardening owned packages' build). Precedent: F054.6 (pwa) + F008.8 (auth).

## Rollout

Per package: edit → `pnpm build` prints the seal's '✓ all N export targets resolve' → prove the seal REDs (delete a built .d.ts → non-zero exit → restore) for at least one → `pnpm test` green. One commit for the sweep. No tags, no publishes. Future rounds add any new multi-entry package as it lands.
