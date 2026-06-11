# @broberg/lens — build handoff (for the post-compact session)

**Status:** GO from Christian (2026-06-11). Build it. Same flow as `@broberg/secret-scan` (F035).
**Package name (FINAL, Christian's call):** `@broberg/lens` — NOT `@broberg/cardmem-lens`, NOT `@broberg/lens-mint`.
**Idea captured:** components idea_id `019eb649-f179-7fab-a303-424117bf49d1`.
**Read also:** memory `components-owns-secret-scan.md` (release recipe + CI gotcha) and the `Lens mint-endpoint standard` neuron (security rules).

## What it is
A shared npm that makes any app **Lens-compliant**: it exposes the F019 Lens **mint endpoint** so Cardmem Lens can log *past the auth wall* and screenshot the REAL authed surface (incl. in prod), instead of the login page.

**Endpoint contract (cardmem's F019 spec):** `POST /api/lens-session`, header `Authorization: Bearer <LENS_MINT_SECRET>` → returns a **10-minute, READ-ONLY** session for a dedicated **lens-principal** (NEVER cb@/admin). Lens uses it (storageState/cookie) to render authed pages.

Needed by ≫3 repos (every authed fleet service + every customer site we build) → clears components' ruthless-share bar by a wide margin. Security-sensitive (it MINTS sessions) → exactly why it should be one audited impl, not N hand-rolled.

> **components itself does NOT need it** (it's npm packages + a static inventory page, no auth) — this package is FOR the other repos + customer sites.

## Ownership (mirror secret-scan / F035)
- **components owns + publishes** `@broberg/lens` (OIDC trusted-publishing once set up).
- **cardmem owns the canonical SPEC** (`docs/LENS-MINT-ENDPOINT.md`, F098.1/F074.13) + has a reference impl shipped on cardmem's `/roadmap`. **LIFT from it** (like trail's F197 → secret-scan).
- Fleet services + customer sites **consume**.

## cardmem coordination — RESOLVED (cardmem reply #4434)
Ownership CONFIRMED: components owns + publishes `@broberg/lens` (OIDC/Trusted Publisher); cardmem owns the spec + reference impl. Exact parallel to secret-scan.

**Reference files to LIFT from** (`broberg-ai/cardmem` main, public — or local `/Users/cb/Apps/broberg/cardmem`):
- `apps/server/src/api/lens-session.ts` — **THE endpoint** (find-or-create dedicated lens-principal, session-create, 10-min TTL clamp, cookie-signing, return). Verbatim-lift the core logic from here.
- `apps/server/src/auth-mcp-key.ts` — `LENS_PRINCIPAL_EMAIL` + readOnly resolution (write-guard basis).
- `apps/agent/src/lens/auth/index.ts` — the daemon CONSUMER (mintEndpoint + storageState adapter) = the OTHER end of the contract; shows exactly what the daemon sends + expects back.
- Spec: `docs/LENS-MINT-ENDPOINT.md` (F098.1/F074.13).

### THE CONTRACT (the core — the adapter depends ONLY on this return shape)
`POST /api/lens-session`, header `Authorization: Bearer <LENS_MINT_SECRET>` → **200 with JSON body = a Playwright storageState** (NOT Set-Cookie, NOT a bearer):
```json
{ "cookies": [ { "name": "<app-session-cookie-name>", "value": "<signed token>",
    "domain": "<LENS_COOKIE_DOMAIN ?? host; leading-dot for cross-subdomain>",
    "path": "/", "httpOnly": true, "secure": true, "sameSite": "Lax",
    "expires": <UNIX SECONDS> } ],
  "origins": [] }
```
The daemon injects these cookies into the browser context before capture. **`expires` = unix SECONDS (not ms).**
- **UNIVERSAL (lives in the package):** this return shape + status codes + security.
- **PER-APP (`createLensSession` hook):** how you mint the principal's session + **SIGN the cookie** (auth-specific — better-auth / NextAuth / Supabase / jose; cookie name + signing vary per app). The hook returns `{ name, value, domain?, expires? }` (or similar) and the core assembles the storageState.

### Core MUST also (per cardmem):
- **503** when `LENS_MINT_SECRET` is unset → endpoint ships DARK (inert until configured).
- **401** on wrong/missing bearer; **constant-time** compare (`crypto.timingSafeEqual`).
- dedicated **synthetic lens-principal**, **NEVER cb@**.
- 10-min TTL clamp; basic rate-limit.

## Design (headless core + thin adapters — the components pattern)
Package ships the UNIFORM + SECURE ~80%:
- **Core (framework-agnostic):** `createLensMintHandler({ secret, createSession, ttlMs = 600_000, principal })`:
  - constant-time Bearer compare vs `LENS_MINT_SECRET` (`crypto.timingSafeEqual`); 401 on mismatch/missing.
  - enforce 10-min TTL, dedicated **read-only lens-principal**, **never cb@/admin** guard.
  - basic rate-limit.
  - 503 if `LENS_MINT_SECRET` unset (ship-dark); else call the app-supplied `createSession(lensPrincipal)` → assemble + return a **Playwright storageState JSON** (the fixed return shape — see "THE CONTRACT" below).
- **Adapters (thin):** `@broberg/lens/next` (Next.js route handler, `export const POST = …`), `@broberg/lens/hono` (Hono handler), maybe `@broberg/lens/node` (generic `(req,res)`).
- **App supplies the auth-specific 20%:** a small `createLensSession(principal)` wired to ITS auth (NextAuth encode / Supabase admin-mint / custom JWT sign) + the `LENS_MINT_SECRET` env. Near-zero-config for the common Stack-A/NextAuth case (consider a NextAuth helper); callback escape-hatch for the rest.

**Security guardrails the package MUST encode** (cardmem's mint standard): dedicated lens-user/service-role (not a low role); write-guards are app-side (403 on mutation if principal==lens); no PII baselines; **cb@webhouse.dk NEVER touched** (per the global ufravigelig rule); secret via env only (never inline); short TTL; constant-time secret compare.

## Build flow (same as F035 secret-scan)
1. **Get cardmem's reference + spec** (await the intercom reply).
2. **Scope the F-epic:** `cardmem_suggest_next_f_number(project_id 019ea70e-0c53-7a40-8ce6-81a3b0f52bc0)` (likely F036). Write the plan-doc (`docs/features/F0xx-lens.md`) + epic + stories in the SAME turn (UFRAVIGELIG rule — plan-doc lands with the card). Include a **Done-gate AC**: a pilot consumer (pick with Christian/cardmem — e.g. cms or a customer site) mounts `@broberg/lens`, and Lens captures its authed surface via the minted session. NOT Done until the pilot validates (same as secret-scan's trail gate).
3. **Build** `packages/lens/` mirroring `packages/secret-scan` + `packages/theme`. Multi-entry (core + next + hono) → tsup `entry: [...]` + package.json `exports` per subpath (theme's package.json is the multi-entry template: `.`, `./react`, `./preact`, `./design-md`). tsconfig: needs `["node"]` types (uses `crypto`); lib includes node. Mark framework deps as peer/optional + tsup `external` (like theme externals react/preact).
4. **Test** (vitest, node env): Bearer accept/reject (incl. constant-time), TTL expiry, never-cb/admin guard, read-only principal, `createSession` hook called with the lens-principal, adapters wire the handler. Mock the per-app auth.
5. **Publish v0.1.0 (bootstrap):** hand-publish with the npm token (npm has no pending-publisher for a new package — same as secret-scan v0.1.0). Token = the one Christian provides (env-only via a temp gitignored `.npmrc` referencing `${NPM_TOKEN}`, removed after; NEVER commit). No rotation (Christian's call).
6. **Trusted-publishing for v0.1.1+:** ask Christian to add a Trusted Publisher at npmjs for `@broberg/lens` (repo `broberg-ai/components`, workflow `publish.yml`). Then ADD a `publish-lens` job to `.github/workflows/publish.yml` (tag `lens-v*`, `working-directory: packages/lens`) mirroring the `publish-secret-scan` job, gated by `if: … startsWith(github.ref, 'refs/tags/lens-v')`. **CI GOTCHA (already fixed in existing jobs):** do NOT set `pnpm/action-setup` `version:` — it conflicts with root `packageManager: pnpm@10.30.3`. Then release via `git tag lens-v<ver> && git push origin lens-v<ver>` → OIDC, token-free. Watch with `gh run watch`.
7. **Inventory:** add `@broberg/lens` to `docs/INVENTORY.md` (fleet-wheel "Lens-compliance" spoke, components-owned) + the footer in `scripts/build-inventory.mjs` (regenerate `docs/inventory.html`) + re-save the cardmem mockup (id `019eae3c-0727-7908-992f-67a0e50ad4ed`, currently v7). The generator is `scripts/build-inventory.mjs` → `docs/inventory.html`.
8. **Notify** cardmem + fleet that v0.1.0 is live; run the pilot validation → then close the F-epic.

## Conventions / operational facts
- Monorepo: `/Users/cb/Apps/broberg/components`, pnpm workspaces (`packages/*`) + turbo. `packageManager: pnpm@10.30.3`.
- Per-pkg scripts: `pnpm --filter @broberg/lens build|test|typecheck`. tsup → ESM+CJS+dts; vitest.
- Working branch = `main` (Christian merged everything to main this session).
- Existing packages to copy conventions from: `packages/theme` (multi-entry exports + adapters template) and `packages/secret-scan` (pure-core template + the publish.yml job pattern).
- Lens itself for testing: cardmem daemon `127.0.0.1:7475` / `cardmem-lens` MCP (`lens_run_flow` / `lens_capture`). The 3 Lens fixes are now live (numeric waitFor, assert-expression, animation-settle) + F126 composition-critic.
- **Verify screenshots semantically** (memory `verify-screenshots-semantically.md`): a passing flow ≠ correct UI — read the pixels.
