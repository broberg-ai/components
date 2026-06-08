# F010 — API-key + rate-limit helper

> L1 Identity · runtime-package · effort **M** · impact **high** · owner `trail`. Status: Backlog.
> LEAP-candidate: no — stays in `components`.

## Motivation
A framework-agnostic package providing (1) API-key lifecycle: prefixed token generation ({prefix}_{32-randomBytes-hex}), SHA-256 hash before storage, timing-safe verification, soft-revoke, optional lastUsedAt stamping; (2) scope checking against a caller-supplied set; (3) a sliding-window in-memory rate limiter keyed by an arbitrary string (IP, key id, tenant). Thin Hono (Stack B) + Next.js (Stack A) middleware adapters so the core never imports either framework. The pattern is implemented in 8+ repos with enough variation to make manual drift genuinely painful — and dangerous.

## Solution
**runtime-package.** All three ruthless criteria pass. (a) Identical across >=3 repos: the generate/hash/verify triad (randomBytes(32).hex, sha256, timingSafeEqual with length-check) is copy-pasted in trail, cronjobs, cms-mcp-server, cardmem, dns-api. (b) Stable: pure crypto plumbing, unchanged since introduction. (c) Painful + dangerous to sync: the length-check guard is already missing in some repos (pitch uses plain !==) — drift is causing live security inconsistency.

## Scope

### In scope
- Extract from `broberg/trail`: `apps/server/src/routes/api-keys.ts`, `middleware/auth.ts`, `lib/key-index.ts`; sliding-window limiter from `webhouse/dns-api` `src/rate-limit.ts`.
- Core (generate/hash/verify/scope/preview/limiter) + Hono + Next middleware adapters.

### Out of scope
- DB CRUD layer (each repo owns its Drizzle schema).
- trail's key-index multi-tenant dual-write (trail-specific infra).
- Cloudflare-style evaluateToken advanced model (cms-only until a 2nd consumer).

## Architecture

### Best source (reference implementation)
`broberg/trail` — `apps/server/src/routes/api-keys.ts` + `middleware/auth.ts` + `lib/key-index.ts`. Full lifecycle (generate/hash-store/list/soft-revoke), timing-safe verify with the correct length-check guard, fire-and-forget lastUsedAt, key-index dual-write for multi-tenant bearer resolution. Shows both prefixed-key (trail_<64hex>) + env static-token legacy paths in one middleware.

### Other implementations seen
- `webhouse/dns-api` `src/{auth,rate-limit}.ts` — cleanest standalone sliding-window limiter (per-IP, 5-min prune via setInterval().unref(), 35 lines, zero deps).
- `webhouse/cms` `packages/cms-mcp-server/src/auth.ts` (timing-safe multi-key scan) + `cms-admin/src/lib/access-tokens.ts` (Cloudflare-style permission+resource-filter+CIDR+TTL evaluateToken — informs AuthDecision shape).
- `webhouse/cronjobs` `src/lib/auth/api-key.ts` — canonical Next/Drizzle: cj_ prefix, enabled toggle, lastUsedAt, generateApiKey()→{key,hash,preview}; clearest copy-once preview UX.

### Headless core vs. adapters
- **Core (no framework):** generateKey(prefix)→prefix_<64hex>; hashKey(raw)→sha256 hex; verifyKey(presented, stored)→timing-safe (length-check then timingSafeEqual); hasScope(granted, required); SlidingWindowRateLimiter (windowMs+max per key, prune .unref()); makeKeyPreview(raw)→first 14 chars. Types ApiKeyRecord, RateLimitResult {allowed, remaining, resetAt}.
- **Stack B (Hono):** honoApiKeyMiddleware({lookup, headerName?}) reads Bearer/x-api-key, hashKey, lookup, sets c.set('apiKeyRecord'), 401/403; honoRateLimitMiddleware(limiter, keyFn?) extracts IP from x-forwarded-for, 429 + Retry-After.
- **Stack A (Next.js):** withApiKeyAuth(handler, opts) resolves Bearer from headers(), hashKey + lookup, injects record; nextRateLimit(limiter, keyFn?) returns 429 or null. next/server only (edge-compatible).

### Public API
```ts
export function generateKey(prefix: string): string
export function hashKey(raw: string): string
export function verifyKey(presented: string, storedHash: string): boolean
export function hasScope(granted: string[], required: string[]): boolean
export function makeKeyPreview(raw: string): string
export class SlidingWindowRateLimiter { constructor(o:{windowMs:number;max:number}); check(key:string): RateLimitResult; destroy(): void }
// '@broberg/apikey-ratelimit/hono' → honoApiKeyMiddleware, honoRateLimitMiddleware
// '@broberg/apikey-ratelimit/next' → withApiKeyAuth, nextRateLimit
```

## Stories
- **F010.1** — Core: generate/hash/verify/preview — _AC:_ generateKey('trail')→'trail_'+64hex; hashKey→sha256 hex; verifyKey provably timing-safe (same result for wrong-length + wrong-byte, unit-tested with distinct-length strings, no throw); makeKeyPreview→first 14; 100% branch coverage; no framework import.
- **F010.2** — SlidingWindowRateLimiter with auto-prune — _AC:_ check returns {allowed,remaining,resetAt}; prune clears entries older than windowMs; destroy() clears the interval (.unref() pattern); tested with injected Date.now.
- **F010.3** — Hono adapter middleware — _AC:_ honoApiKeyMiddleware resolves Bearer/x-api-key, sets apiKeyRecord, 401 missing / 403 invalid-or-revoked; honoRateLimitMiddleware extracts IP, 429 + Retry-After; both via Hono testClient.
- **F010.4** — Next.js adapter middleware — _AC:_ withApiKeyAuth injects x-resolved-key-id on valid, 401/403 JSON on fail; nextRateLimit returns 429 or null; no next/navigation import; tested with MockNextRequest.
- **F010.5** — Pilot: dns-api adopts the package — _AC:_ dns-api auth.ts + rate-limit.ts deleted, replaced by package imports; all dns-api tests pass; same 401/403/429 shapes.
- **F010.6** — Pilot: trail adopts the package — _AC:_ trail api-keys.ts + auth.ts gen/verify replaced by package imports; trail integration tests pass; key-index dual-write stays in trail (tenant-specific).

## Acceptance criteria
1. @broberg/apikey-ratelimit builds + typechecks clean; headless core imports no framework packages.
2. Each story (F010.1–F010.6) meets its own AC.
3. Piloted in trail and adopted back with no regression (runtime-verified).
4. A second consumer (dns-api or cronjobs) migrates onto the shared package with identical behaviour.

## Dependencies
- External: node:crypto (built-in).
- Related: F007 MCP toolkit (consumes key auth).

## Rollout
Strangler: 1) extract core from trail api-keys/auth + dns-api rate-limit; 2) Hono adapter first, pilot dns-api (smallest); 3) adopt back in trail; 4) Next adapter, pilot cronjobs; 5) spread to upmetrics/cardmem/cms-mcp-server/pitch/codepromptmaker. Never big-bang.

LEAP-candidate: no — stays in `components`.

## Open Questions
- Pluggable rate-limiter backend (Redis) for multi-instance, or in-memory sufficient (Fly single-machine today)?
- Canonical preview length — 8 (cronjobs) or 14 (cms)?
- Include the Drizzle DB CRUD layer or stay crypto/middleware-only?
- Include cms evaluateToken (CIDR + resource-filter) as an optional 'advanced' export now or wait for a 2nd consumer?

## Effort estimate
**M** — owner session: `trail`. Reuse model: runtime-package.

## Risks
Security drift is the live risk: pitch uses plain !== (no timingSafeEqual); cms-mcp-server's guard is duplicated in isolation — both worsen without one package. In-memory limiter resets on restart + doesn't protect multi-instance Fly machines (Redis backend = future story). makeKeyPreview length differs (8 vs 14) — pick one, migrate callsites. Next adapter must be tested on Node AND edge (node:crypto is only the Web Crypto subset at the edge).