# @broberg/apikey

Framework-agnostic **inbound API-key primitives** for the broberg.ai fleet. It owns the dangerous-to-get-wrong bits — minting, constant-time verification, rate-limiting, and a Cloudflare-style authorization cascade — and leaves **storage, tenancy, and request-context resolution to you**. Bring your own `lookup`.

Designed from a 9-repo fleet survey (trail · cardmem · cms · upmetrics · vn): the package never forces hashing, a tenancy model, a fixed prefix, or a rate-limit backend.

```bash
npm i @broberg/apikey      # exact-pin for prod-auth deps
```

## Core (`@broberg/apikey`)

```ts
import { generateKey, hashKey, verifyKey, makeKeyPreview, hasScope } from "@broberg/apikey";

const raw = generateKey("trail");           // "trail_<64 hex>"  — show ONCE
const stored = hashKey(raw);                // sha256 — store this (hash-at-rest)
const preview = makeKeyPreview(raw);         // "trail_0a1b2c3d" — display/grep anchor

// On each request — YOU do the DB read; the package does the constant-time compare:
verifyKey(presented, stored);               // hashed (default): timingSafeEqual(sha256(presented), stored)
verifyKey(presented, stored, { hashed: false }); // plaintext-revealable (upmetrics-style)

hasScope(["content:*"], ["content:write"]); // true — exact / `*` / `area:*`
```

`timingSafeEqual(a, b)` is exported too — the length-checked constant-time compare that replaces unsafe `a !== b` token checks.

## Rate limit — pluggable store

In-memory by default (single-machine). For a **stateless multi-machine** fleet, pass a shared store so the window doesn't leak per machine:

```ts
import { SlidingWindowRateLimiter, type RateLimitStore } from "@broberg/apikey";

const limiter = new SlidingWindowRateLimiter({ windowMs: 60_000, max: 100 });
const { allowed, remaining, resetAt } = await limiter.check(clientKey);

// One limiter, per-key caps — pass a per-check `max` override (v0.1.1):
await limiter.check(clientKey, { max: keyRecord.rateLimitPerHour });

// Shared backend (Turso/Redis): implement one method.
const turso: RateLimitStore = {
  async hit(key, now, windowMs) { /* … */ return { count, oldest }; },
};
new SlidingWindowRateLimiter({ windowMs: 60_000, max: 100, store: turso });
```

## Authorization cascade (`@broberg/apikey/authorize`)

The optional rich tier — permission × resource-filter × CIDR × TTL (modelled on cms F134). Simple adopters skip this and use `hasScope`.

```ts
import { evaluateToken, type TokenGrant } from "@broberg/apikey/authorize";

const grant: TokenGrant = {
  permissions: ["deploy:trigger"],
  resources: [{ scope: "site", effect: "include", targets: ["fysiodk"] }],
  ipFilters: [{ mode: "in", cidrs: ["203.0.113.0/24"] }],
  notBefore: Date.parse("2026-01-01"),
  notAfter: Date.parse("2027-01-01"),
};

const decision = evaluateToken(grant, {
  permission: "deploy:trigger",
  resource: { scope: "site", target: "fysiodk" },
  ip: "203.0.113.5",
});
// → { allowed: true } | { allowed: false, reason: "expired" | "permission_denied" | "resource_denied" | "ip_denied" }
```

Cascade order: TTL → permission → resource (**exclude wins**) → CIDR (IPv4 + IPv6, zero-dep). A scope with no filter is unconstrained.

### Tenant selector (trail's selector-not-grant)

```ts
import { selectTenant, TenantAccessError } from "@broberg/apikey/authorize";

// A `spansAll` key lets the owner pick any tenant they belong to via a header.
// A non-member slug is a HARD refuse — never a silent fall-back to home.
try {
  const tenant = selectTenant({ requestedSlug, homeTenant, spansAll: true, isMember });
} catch (e) {
  if (e instanceof TenantAccessError) return new Response(null, { status: 401 });
}
```

## Adapters

```ts
// Stack B — Hono
import { honoApiKeyMiddleware, honoRateLimit } from "@broberg/apikey/hono";
app.use("/api/*", honoApiKeyMiddleware({ lookup, authorize }));   // 401/403; c.get("apiKey")
app.use("/api/*", honoRateLimit(limiter));                         // 429 + Retry-After

// Stack A — Next.js (Web-standard Request/Response, edge-safe, no `next` dep)
import { withApiKeyAuth, nextRateLimit } from "@broberg/apikey/next";
export const POST = withApiKeyAuth(async (req, record) => Response.json({ ok: true }), { lookup });
```

`lookup(presented) => record | null` is yours: hash + DB/filesystem read, your storage, your tenancy. The package never sees your store.

## Boundaries (what it deliberately does NOT do)

- **No storage** — no DB/CRUD layer; you own the schema (Drizzle / libSQL / JSON).
- **No request→tenant resolution** — that's your proxy/router; feed the result into `selectTenant`.
- **No bundled Redis/Turso** — ships the `RateLimitStore` interface + in-memory only.
- **Core crypto is Node/Bun** (`node:crypto`). At the edge, hash via Web Crypto inside your `lookup`; the adapters themselves are edge-safe.

MIT · part of the [broberg.ai shared inventory](https://discovery.broberg.ai).
