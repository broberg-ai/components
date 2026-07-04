# F051 — @broberg/lens/next-auth: shared NextAuth Lens-session mint (v0.1.3)

**Status:** in progress · **Owner:** components · **Package:** `@broberg/lens` (new `/next-auth` sub-path) · **Source:** reuse-first, cronjobs daily-sweep flag #16028 + seed #16030

## Motivation

Every NextAuth-behind-login repo that wants Cardmem Lens to screenshot its **authed** pages must mint a short-lived NextAuth session cookie and hand Lens a Playwright `storageState`. cronjobs hand-rolled it (F003, `src/app/api/lens/session/route.ts`); cms + likely trail + any other NextAuth app re-derive the SAME encode + the SAME 3 subtle cookie gotchas. That is exactly the drift the shared inventory kills.

`@broberg/lens` core already splits the mint endpoint into the **uniform 80%** (`createLensMintHandler`: ship-dark, constant-time bearer, never-cb principal guard, TTL clamp, rate-limit, storageState assembly) and an **app-supplied 20%** — a `createSession(ctx) → LensCookie` hook that mints + signs the app's own session cookie. The NextAuth JWT-encode **IS** that 20% every NextAuth app re-rolls.

## Scope

A **dep-free** sub-path `@broberg/lens/next-auth` exporting a ready-made `createSession` hook for NextAuth (v5):

```ts
import { createLensMintHandler } from "@broberg/lens";
import { nextAuthLensSession } from "@broberg/lens/next-auth";

const handler = createLensMintHandler({
  principal: "lens@myapp.local",
  createSession: nextAuthLensSession({ authSecret: process.env.AUTH_SECRET, claims: { id, email, name } }),
});
```

`nextAuthLensSession(opts): CreateLensSession` returns `{ name: cookieName, value: jwt, secure, httpOnly, sameSite }`; the core fills domain/path/expires.

### The 3 gotchas captured ONCE (from cronjobs' battle-tested seed)
1. **`salt` MUST equal the cookie name** — NextAuth `getToken` derives the JWE key with `salt = cookie name`; a mismatch decodes to `null` (silent auth-fail).
2. **`__Secure-` prefix ⇒ `secure: true`** — a `__Secure-`-prefixed cookie is rejected by the browser without the secure flag. Secure mode drives the cookie NAME (`__Secure-authjs.session-token` vs `authjs.session-token`) AND the salt AND the cookie's secure flag, together.
3. **Chromium rejects a secure cookie set by `{domain}` only** (non-secure source-scheme → 307). The Cardmem Lens daemon (cardmem F074.22) now synthesizes an https source-URL from the domain, so `{domain,path}` works fleet-wide — documented so a consumer on a non-daemon env knows to use a `url` cookie instead.

### Non-goals
- **No NextAuth v4 mode yet** — v5-first, grounded in cronjobs' v5 seed (`authjs.session-token`, `next-auth/jwt` `encode` with `salt`). Add a v4 mode only if a v4 consumer surfaces (v4 = `next-auth.session-token`, no salt).
- **No new hard dep** — `next-auth` is an OPTIONAL peer dep, imported lazily (or the `encode` fn is injectable), so `@broberg/lens` core stays 0-dep and a non-NextAuth consumer is unaffected.

## Architecture

`src/next-auth.ts`: `nextAuthLensSession(opts)` → `CreateLensSession`. Options: `authSecret` (required), `claims` (the principal's JWT payload; `sub` defaults to `claims.sub ?? id ?? email ?? ctx.principal`), `secure?` (default `NODE_ENV==='production'` — NextAuth v5's `useSecureCookies` default), `cookieName?`, `maxAgeSec?` (default the core's clamped TTL), `encode?` (injectable; default lazily imports `next-auth/jwt`). tsup builds it as a 4th entry; `next-auth`/`next-auth/jwt` are externalized. package `exports` gains `./next-auth`; `peerDependenciesMeta` marks `next-auth` optional.

## Testing

Offline vitest with an **injected fake `encode`** seals the whole helper without a real JWE or a `next-auth` install: cookie-name selection (secure → `__Secure-` prefix), `salt === cookieName` (the #1 gotcha), `sub` defaulting, `maxAge` from the clamped TTL, and the returned `LensCookie` secure/httpOnly/sameSite. The real JWE encode is next-auth's responsibility, not ours.

## Rollout

1. Ship `@broberg/lens@0.1.3` via OIDC tag `lens-v0.1.3` (no OTP). Discovery roster bumped.
2. cronjobs (first adopter) migrates its hand-rolled route to `@broberg/lens` core + `nextAuthLensSession`, confirms parity — that is the consumer-live done-gate.
3. Ping cms to confirm its NextAuth version (v4 follow-up only if needed).

## Dependencies
`next-auth` (optional peer, consumers already have it). `@broberg/lens` core stays dep-free.