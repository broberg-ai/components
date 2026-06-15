# F010 — `@broberg/apikey`: API-key mint/verify · scope-cascade · rate-limit

> L1 Identity · runtime-package · effort **M** · impact **high** · owner `trail`. Status: In progress.
> Graduate-candidate: no — stays in `components`.
> **v1 decision (Christian, 2026-06-15): the full cms scope-cascade ships IN v1** (not a fast-follow).

## Motivation
A framework-agnostic package that owns the **primitives** of inbound API-key auth — never the policy. Five fleet repos hand-roll the same generate/hash/verify triad with enough variation to make manual drift painful *and* dangerous (pitch uses a plain `!==` instead of a timing-safe compare — a live security inconsistency). The package lifts the shared crypto + a pluggable rate-limiter + a cms-style authorization cascade behind one dependency, and leaves storage, tenancy, and request-context resolution to the consumer.

## Fleet Q&R synthesis (2026-06-15)
A 9-session scoping questionnaire (broadcast #5313) settled the design. Every claim below is grounded in the responder's actual code.

**Real adopters (mint prefixed keys):**
| Repo | Storage | Tenancy | Scopes | Rate-limit |
|---|---|---|---|---|
| **trail** (pilot) | `trail_`+64hex, **sha256-hashed**, shown 1× | **selector-not-grant**: a `scope=all` key spans the owning user's memberships, `X-Trail-Tenant` header *selects*, non-member slug → **hard 401** (never silent home-fallback) | one grov `scope` text field | none today; engine is **stateless multi-machine** → needs a **shared** store (Turso/Redis), in-memory would leak per machine |
| **cardmem** (pilot) | `pa_`/`pi_`/`piw_`+64hex, **sha256-hashed**, shown 1×, `hash_prefix`=hash.slice(0,6) for display | tenant from the key row (userId / projectId) | **scope encoded in the prefix** | in-memory sliding-window on `piw_` only (single Fly machine) |
| **cms** (pilot — cascade) | `wh_`+64hex, **sha256-hashed** in filesystem JSON (no DB), shown 1×, displayPrefix=raw.slice(0,14) | per-tenant but token-store is global; the key carries *what it may touch*, the **proxy** resolves *what the request hits* (`?site=` / `X-CMS-Active-Site`) | **full Cloudflare-style cascade** per token: `permissions[]` (`area:action`, `*`, `area:*`) × `resources[]` (scope+include/exclude+targets) × `ipFilters[]` (CIDR) × TTL (notBefore/notAfter). **Flat allow/deny = downgrade, not drop-in.** |
| **upmetrics** | `uk_`+48hex, **plaintext in DB**, equality lookup | per-project; the key *is* the tenant | allow/deny scoped to project_id | in-memory (single machine) |
| **vn-leker** (future) | `vnl_`+hex, hashed, single-tenant | **none** (single-tenant) | allow/deny + `readOnly` + grov (`orders:read`) | in-memory (single machine) |

**Not a fit (correctly scoped out):** `ai-sdk` (library — consumes *outbound* provider keys, no inbound surface), `fds` (Supabase-Auth JWT + plain `.env` shared-secrets, single-tenant, RLS), `xrt81`/`sanne` (session-cookies / signed purpose+TTL+single-use JWTs — a *different* primitive, not minted API keys).

**Honest reach:** v1's near-term value is the **trail + cardmem** dedup (identical hash-once pattern, real drift risk) + **cms**'s cascade migration, with upmetrics/vn covered by core. It is *not* a 9-repo win — 4 of 9 have no minted-key surface.

**The 5 deal-breakers → one rule: own the primitives, never the policy.**
1. **Storage:** never force hashing (upmetrics stores plaintext-revealable) *or* hashing-only (cardmem). Provide `hashKey` + a timing-safe compare that works on hashed *or* plaintext; the consumer supplies `lookup()`.
2. **Tenancy:** never assumed. Optional `selectTenant()` models trail's membership-validated, hard-refuse selector without imposing trail's schema.
3. **Scopes:** simple `hasScope()` in core (trail/cardmem/vn/upmetrics) **+** an optional `@broberg/apikey/authorize` cascade (cms) — both in v1.
4. **Rate-limit:** in-memory default **+ pluggable async store interface** (trail's shared multi-machine need is opt-in, never forced; never hardcode Redis).
5. **Prefixes:** configurable, per-prefix scope semantics. Never a single fixed prefix.

## Scope

### In scope (v1)
- **Core** (`@broberg/apikey`): `generateKey`, `hashKey`, `timingSafeEqual`, `verifyKey`, `makeKeyPreview`, `hasScope`.
- **Rate-limit** (`@broberg/apikey`): `SlidingWindowRateLimiter` + `RateLimitStore` interface + in-memory default (`MemoryRateLimitStore`).
- **Authorize cascade** (`@broberg/apikey/authorize`): `evaluateToken(grant, ctx)` modelling permission × resource-filter × CIDR × TTL, with a zero-dep CIDR matcher (IPv4 + IPv6).
- **Tenant selector** (`@broberg/apikey/authorize`): `selectTenant({...})` + `TenantAccessError` (trail's selector-not-grant).
- **Adapters**: `@broberg/apikey/hono` + `@broberg/apikey/next` middleware (consumer supplies `lookup`; optional `authorize` hook + rate-limit middleware).

### Out of scope
- The DB / filesystem CRUD layer (each repo owns its own store: Drizzle, libSQL, JSON).
- Request→tenant resolution from URL/headers (cms's proxy job; trail's header is fed *into* `selectTenant`).
- A bundled Redis/Turso store impl (we ship the *interface* + in-memory; trail/others write the adapter to their own client).

## Architecture

### Best source (reference implementations, cross-checked in the Q&R)
- `broberg/trail` `apps/admin-server/src/{keys,proxy}.ts` — full lifecycle, sha256-at-rest, selector-not-grant tenant model (the `selectTenant` reference).
- `broberg/cardmem` `packages/mcp-tools/src/tools/{mcp-keys,inbox-webhook-keys,incident-keys}.ts` — multi-prefix, hash_prefix display, per-prefix scope.
- `webhouse/cms` `cms-admin/src/lib/access-tokens.ts` (F134) — the Cloudflare-style cascade (permission+resource-filter+CIDR+TTL) → the `evaluateToken` reference.
- `webhouse/dns-api` `src/rate-limit.ts` — cleanest standalone sliding-window (per-key, prune via `setInterval().unref()`), the in-memory store reference.

### Public API
```ts
// '@broberg/apikey' (core)
generateKey(prefix: string, bytes?: number): string          // `${prefix}_${hex}` (bytes default 32)
hashKey(raw: string): string                                 // sha256 hex
timingSafeEqual(a: string, b: string): boolean               // length-checked, constant-time (the pitch `!==` fix)
verifyKey(presented: string, stored: string, opts?: { hashed?: boolean }): boolean
                                                             // hashed=true (default): timingSafeEqual(hashKey(presented), stored)
                                                             // hashed=false: timingSafeEqual(presented, stored)  ← upmetrics plaintext
makeKeyPreview(raw: string, length?: number): string         // first `length` chars (default 14); display anchor
hasScope(granted: string[], required: string[]): boolean     // exact + `*` + `area:*` wildcards

class SlidingWindowRateLimiter {
  constructor(o: { windowMs: number; max: number; store?: RateLimitStore });   // store defaults to in-memory
  check(key: string, now?: number): Promise<RateLimitResult>;                  // { allowed, remaining, resetAt }
  destroy(): void;
}
interface RateLimitStore {                                   // trail plugs Turso here; default = MemoryRateLimitStore
  hit(key: string, now: number, windowMs: number): Promise<{ count: number; oldest: number }>;
}

// '@broberg/apikey/authorize'
evaluateToken(grant: TokenGrant, ctx: AuthContext): AuthDecision   // { allowed, reason? } — full cascade, exclude-wins
selectTenant(o: { requestedSlug?: string; homeTenant: string; spansAll: boolean;
                  isMember: (slug: string) => boolean }): string   // throws TenantAccessError on non-member (→ 401)

// '@broberg/apikey/hono'   honoApiKeyMiddleware({ lookup, headerName?, authorize? }), honoRateLimit(limiter, keyFn?)
// '@broberg/apikey/next'   withApiKeyAuth(handler, { lookup, authorize? }), nextRateLimit(limiter, keyFn?)
```

## Stories
- **F010.1 — Core crypto** — `generateKey`/`hashKey`/`timingSafeEqual`/`verifyKey`/`makeKeyPreview`/`hasScope`. _AC:_ `generateKey('trail')`→`trail_`+64hex; `verifyKey` provably timing-safe for both hashed + plaintext modes (equal result for wrong-length vs wrong-byte, no throw, tested with distinct-length strings); `hasScope` honours `*`/`area:*`; no framework import; ≥95% branch coverage.
- **F010.2 — Rate-limiter + pluggable store** — `SlidingWindowRateLimiter` async over a `RateLimitStore`; in-memory default with prune (`.unref()`). _AC:_ `check` returns `{allowed,remaining,resetAt}`; window correct with injected `now`; a custom (fake-async) store is honoured end-to-end; `destroy()` clears the interval.
- **F010.3 — Authorize cascade** — `evaluateToken` (permission × resource include/exclude × CIDR × TTL) + zero-dep CIDR matcher. _AC:_ TTL window enforced; permission wildcard (`*`, `area:*`) matches; resource exclude beats include; IPv4 + IPv6 CIDR in/not_in; first-failing reason returned; the cms F134 fixtures (`deploy:trigger` on `site:fysiodk` only, IP-filtered) evaluate correctly.
- **F010.4 — Tenant selector** — `selectTenant` + `TenantAccessError`. _AC:_ requested non-member slug throws (→401, never silent home-fallback); no header → home; `spansAll=false` + foreign slug throws; `isMember` callback drives membership (no schema assumption).
- **F010.5 — Hono adapter** — `honoApiKeyMiddleware` (Bearer/x-api-key → `lookup` → `c.set`, 401/403, optional `authorize`) + `honoRateLimit` (429 + Retry-After). _AC:_ via Hono testClient.
- **F010.6 — Next adapter** — `withApiKeyAuth` + `nextRateLimit`; `next/server` only (edge-safe; node:crypto vs Web Crypto guard). _AC:_ via MockNextRequest.
- **F010.7 — Publish + OIDC + inventory/mockup** — v0.1.0 (bootstrap) + `apikey-v*` OIDC job; bump F010 inventory→shipped; sync mockup.
- **F010.8 — Pilots (coordination, gated on Christian)** — trail (core + selectTenant), cardmem (core + multi-prefix), cms (core + authorize cascade), adopt back with no regression (runtime-verified, same 401/403/429 shapes).

## Acceptance criteria
1. `@broberg/apikey` builds + typechecks clean; core + authorize import **no** framework packages.
2. Each story (F010.1–F010.6) meets its own AC; cascade + CIDR are unit-proven against cms's real F134 shapes.
3. Published to npm (v0.1.0) with `apikey-v*` OIDC job wired.
4. Pilots (F010.8) coordinated via intercom; adoption gated on Christian per repo.

## Dependencies
- External: `node:crypto` (built-in). Adapters: `hono` (peer, optional), `next` (peer, optional). **No Redis/Turso dep** — store is an interface.
- Related: F007 MCP toolkit (consumes key auth); F008 oauth (sibling L1 identity).

## Rollout
Strangler: 1) ship the package (core + authorize + adapters); 2) pilot **cardmem** first (cleanest multi-prefix hash-once, single-machine — proves core + prefix scope); 3) **trail** (proves `selectTenant` + pluggable shared store); 4) **cms** (proves the cascade — biggest migration, F134); 5) spread to upmetrics (plaintext mode) + vn (single-tenant) + future minters. Never big-bang; each pilot gated on Christian.

## Open questions — RESOLVED by the fleet Q&R
- ~~Pluggable rate-limiter backend (Redis) or in-memory?~~ → **Both**: in-memory default + pluggable async `RateLimitStore` (trail multi-machine = opt-in).
- ~~Canonical preview length — 8 or 14?~~ → **Configurable** (`makeKeyPreview(raw, length=14)`); cardmem's hash_prefix is its own `hash.slice(0,6)` on the stored hash.
- ~~Include the DB CRUD layer?~~ → **No** — storage stays the consumer's (BYO `lookup`); the package is crypto/authorize/middleware only.
- ~~Include cms `evaluateToken` (CIDR + resource-filter) now or wait?~~ → **Now, in v1** (Christian's decision) — cms is the confirmed consumer + it's its core value; shipped as the optional `/authorize` export so simple adopters ignore it.

## Risks
- Security drift is the live risk (pitch's plain `!==`; cardmem's guard duplicated 3×) — one timing-safe primitive removes it.
- The cascade + CIDR matcher is the complexity hotspot — must be unit-proven against cms's real F134 shapes (IPv6 especially).
- Next adapter must run on Node **and** edge (`node:crypto` is only the Web Crypto subset at the edge) — guard + test both.
- In-memory store resets on restart + doesn't protect multi-machine — documented; trail supplies a shared store via the interface.

## Effort estimate
**M** — owner session `trail`; built + published by `components`. Reuse model: runtime-package.
