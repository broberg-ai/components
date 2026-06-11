# F036 — `@broberg/lens` · Lens-mint compliance npm

> **Status:** building (GO from Christian, 2026-06-11). Same flow as `@broberg/secret-scan` (F035).
> **Owner:** components owns + publishes `@broberg/lens` (npm, OIDC trusted-publishing). cardmem owns the canonical spec (`docs/LENS-MINT-ENDPOINT.md`, F098.1) + the reference impl.
> **Build handoff:** `docs/LENS-BUILD-HANDOFF.md` (the durable brief + cardmem's resolved contract).

## Why

Cardmem **Lens** verifies the surface users actually see — which, for almost every fleet app, is **behind a login wall**. Lens can't hard-code logins (every app has different auth: Better Auth, NextAuth, Supabase, custom JWT). The fleet standard (cardmem F098.1, `docs/LENS-MINT-ENDPOINT.md`) is: each app exposes **one** endpoint that mints a short-lived, read-only session on demand; Lens calls it just before capture, uses the session, discards it.

The contract is identical in every repo, only the *minting* step differs — so today **every repo hand-rolls the same ~80 lines**, and that 80 lines is *security-sensitive* (it mints sessions) and *easy to get subtly wrong*:

- **sanneandersen (Fly, 2026-06-05):** cookie `domain` derived from the bound address → `0.0.0.0` → browser never sends the cookie → Lens captured the public shell. A `no_diff` smoke passed **green** (a login redirect renders without error) = a silent false-green.
- **upmetrics (2026-06-05):** mint returned an own-HMAC token that authed the API routes (so `curl` looked green) but **not** Better Auth's `getSession` → the SPA bounced to login → Lens captured a login wall.

`>3` consumers (every authed fleet service + every customer site we run Lens on, incl. prod) + security-sensitive = exactly the bar for **one audited shared npm**, not N hand-rolled copies. This is the same ruthless-share logic that produced `@broberg/secret-scan`.

> **components itself does NOT need it** — it's npm packages + a static inventory page, no auth. This package is *for the other repos*.

## What it is

A shared npm that ships the **uniform + secure ~80%** of the mint endpoint as a headless core, plus thin per-framework adapters. The app supplies only the **auth-specific 20%** — a `createLensSession(ctx)` hook that mints its own session + signs its own cookie.

### The contract (cardmem's F098.1 spec — fixed return shape)

`POST /api/lens-session`, header `Authorization: Bearer <LENS_MINT_SECRET>` → **200 with a Playwright `storageState` JSON** (NOT `Set-Cookie`, NOT a bearer):

```json
{ "cookies": [ { "name": "<app-session-cookie>", "value": "<signed token>",
    "domain": "<LENS_COOKIE_DOMAIN ?? request host>", "path": "/",
    "httpOnly": true, "secure": true, "sameSite": "Lax",
    "expires": 1733430000 } ],
  "origins": [] }
```

The Lens daemon injects these cookies (`context.addCookies`) before capture. **`expires` is unix SECONDS, not ms.**

## Architecture (headless core + thin adapters — the components signature)

### Core (`@broberg/lens`, framework-agnostic) — the UNIVERSAL + SECURE part

`createLensMintHandler(opts) → (req) => Promise<res>` — a normalized handler that:

- **503 ship-dark:** returns `503` while the secret is unset (read per-request from `opts.secret ?? process.env.LENS_MINT_SECRET`) — deploying to prod is inert until Christian provisions the secret. No restart needed to flip it on.
- **401 + constant-time bearer:** compares the provided bearer to the secret in **constant time** (`crypto.timingSafeEqual` over SHA-256 digests, so it's length-independent and never throws). Missing/wrong → `401`.
- **Principal guard (never cb@):** `principal` is required at construction; constructing with `cb@webhouse.dk` (the permanent human admin) or an empty principal **throws** — the lens identity MUST be a dedicated read-only user.
- **TTL clamp:** `ttlMs` clamped to `[60s, 10min]` (default 10min); stamps the cookie `expires` and passes `expiresAt` to the hook so the app clamps its session row to the SAME TTL.
- **Rate-limit:** a basic per-handler fixed-window limiter (default 30/min) → `429` on burst — defense-in-depth on a session-minting endpoint.
- **Assembles the storageState:** calls the app's `createLensSession(ctx)`, fills cookie defaults (`path:'/'`, `httpOnly:true`, `sameSite:'Lax'`, `domain` from `cookieDomain ?? LENS_COOKIE_DOMAIN ?? host`, `secure` from the request), returns the fixed shape.

### Adapters (thin) — translate framework req/res ↔ the normalized shape

- **`@broberg/lens/next`** — `createLensRoute(opts) → { POST }` for a Next.js 16 route handler (`app/api/lens-session/route.ts` → `export const { POST } = createLensRoute({...})`). Uses Web `Request`/`Response` — zero framework dep.
- **`@broberg/lens/hono`** — `lensSessionHandler(opts) → (c) => Response` for Stack B (Bun/Hono). `hono` is an optional peer dep.
- Any other framework calls `createLensMintHandler(opts)` directly with `{ authorization, host, secure }` — that normalized handler IS the generic escape hatch (no separate `/node` entry needed).

### The app supplies the auth-specific 20% — `createLensSession(ctx)`

```ts
createLensRoute({
  principal: 'lens@myapp.local',           // dedicated read-only identity, never cb@
  async createSession({ principal, expiresAt }) {
    const session = await mintReadOnlySessionFor(principal, expiresAt); // app's own auth
    return { name: 'myapp.session_token', value: session.signedCookie }; // core fills the rest
  },
})
```

`ctx = { principal, host, secure, ttlMs, expiresAt }`. The hook returns `{ name, value, domain?, path?, httpOnly?, secure?, sameSite?, expires? }` (or an array); the core assembles the storageState. **Cookie name + signing are auth-specific** (Better Auth `internalAdapter.createSession` + better-call signing / NextAuth encode / Supabase service-role mint / jose HS256) and live ONLY in the hook.

## Security guardrails the package encodes (cardmem's mint standard)

- Dedicated synthetic **lens principal**, **never `cb@webhouse.dk`** (construction-time guard; per the global ufravigelig rule).
- **Read-only is enforced app-side** (a write-guard returning 403 on mutation when principal == lens) — the package documents this loudly; it can't enforce it from inside the mint endpoint. Non-goal to ship the write-guard (auth-specific).
- Secret via **env only** (never inline/committed); short TTL; constant-time compare; ship-dark 503; basic rate-limit.
- **PII:** capture PII surfaces as `no_diff` smoke, never a stored pixel baseline (app/Lens-manifest concern; documented, not enforced).

## Scope

**In scope:** the core handler + Next + Hono adapters + types + a thorough vitest suite + README with Better-Auth & custom-JWT worked examples; publish v0.1.0; OIDC `lens-v*` release job; inventory + mockup; one pilot consumer that validates end-to-end.

**Non-goals:** (1) the per-app `createLensSession` impl — that's the consuming app's job; (2) the app-side read-only write-guard; (3) the Lens daemon side (cardmem owns it); (4) migrating *every* hand-rolled mint at once — only the pilot, then fleet-wide via intercom over time.

## Dependencies

- cardmem owns the spec + reference (`apps/server/src/api/lens-session.ts`) — **RESOLVED** (reply #4434): contract + ownership confirmed.
- Christian provisions the npm Trusted Publisher for `@broberg/lens` (repo `broberg-ai/components`, workflow `publish.yml`) after v0.1.0 bootstrap.
- A pilot consumer app (coordinate with cardmem — candidates: cms (Next/Stack A), or migrate sanneandersen/upmetrics off their hand-rolled mint).

## Rollout

1. Build core + adapters + tests.
2. Bootstrap-publish **v0.1.0** by hand (Christian's npm token, env-only via a temp gitignored `.npmrc`; npm has no pending-publisher for a brand-new package).
3. Christian adds the Trusted Publisher → add a `publish-lens` job (tag `lens-v*`) to `.github/workflows/publish.yml` mirroring `publish-secret-scan` (⚠️ NO `version:` on `pnpm/action-setup` — it conflicts with root `packageManager`). v0.1.1+ release via `git tag lens-v<ver> && git push` → OIDC, token-free + provenance.
4. Inventory: add the `@broberg/lens` spoke to `docs/INVENTORY.md` + the footer in `scripts/build-inventory.mjs` (regenerate `docs/inventory.html`) + re-save the cardmem mockup.
5. **Done-gate:** a pilot fleet app mounts `@broberg/lens` and Lens captures its authed surface via the minted session. NOT Done until the pilot validates (same as secret-scan's trail gate).

## Stories

- **F036.1** — Headless core `createLensMintHandler` + types + vitest suite (503/401/constant-time/TTL-clamp/principal-guard/storageState-assembly/rate-limit).
- **F036.2** — `@broberg/lens/next` adapter (Next.js 16 route handler).
- **F036.3** — `@broberg/lens/hono` adapter (Stack B Bun/Hono).
- **F036.4** — Publish v0.1.0 (bootstrap token) + `lens-v*` OIDC job + inventory/mockup update.
- **F036.5** — Pilot consumer Done-gate (a fleet app adopts it; Lens captures its authed surface).
