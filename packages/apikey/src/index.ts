/**
 * @broberg/apikey — inbound API-key primitives for the broberg.ai fleet.
 *
 * Core (this entry): mint / hash / timing-safe verify / preview / scope-check +
 * a sliding-window rate limiter over a pluggable store.
 *
 * Optional sub-exports:
 *   - `@broberg/apikey/authorize` — Cloudflare-style cascade (permission ×
 *     resource-filter × CIDR × TTL) + a membership-validated tenant selector.
 *   - `@broberg/apikey/hono` — Hono middleware (bring your own `lookup`).
 *   - `@broberg/apikey/next` — Next.js route-handler wrappers (Web-standard,
 *     edge-safe).
 */
export {
  generateKey,
  hashKey,
  timingSafeEqual,
  verifyKey,
  makeKeyPreview,
  hasScope,
} from "./core";

export {
  SlidingWindowRateLimiter,
  MemoryRateLimitStore,
  type RateLimitStore,
  type RateLimitResult,
} from "./rate-limit";
