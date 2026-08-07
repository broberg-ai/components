import type { Context, MiddlewareHandler } from "hono";
import type { RateLimitResult, SlidingWindowRateLimiter } from "./rate-limit";
import { resolveRateLimitKey, type RateLimitKey } from "./rate-limit";

/**
 * Hono adapter. The consumer supplies `lookup` (it does the hash + DB read, so
 * the package never owns storage); the middleware reads the bearer/x-api-key
 * header, resolves the record, optionally authorizes it, and stashes it on the
 * context. 401 on missing/invalid, 403 when `authorize` rejects.
 *
 * The response BODY is the app's contract, not the package's — supply
 * `onUnauthorized` / `onForbidden` to render it yourself. The middleware still
 * decides *what* happened; the hook only decides how it is written down.
 */
export interface HonoApiKeyOptions<T> {
  lookup: (presented: string) => Promise<T | null> | T | null;
  /** Override the header. Default: `Authorization: Bearer …` then `x-api-key`. */
  headerName?: string;
  authorize?: (record: T, c: Context) => boolean | Promise<boolean>;
  /** Context key the resolved record is set under. Default: `"apiKey"`. */
  contextKey?: string;
  /**
   * Narrow what lands on the context. By default the WHOLE looked-up record is
   * stored — including whatever your storage row carries (a `hash` column, for
   * instance). That is not a credential leak (a hash is not usable), but it is
   * more than a handler needs, and one `c.json(caller)` later it becomes a
   * response body. Supply `project` to hand handlers a caller shape you chose.
   */
  project?: (record: T) => unknown;
  /**
   * Render the 401. `reason` is `"missing"` when no key was presented and
   * `"invalid"` when `lookup` returned null. Both answer 401 by default, but the
   * distinction is worth having: 401 means "I don't know who you are" and is
   * fixed by fetching a token — a caller may want to be told which case it hit.
   */
  onUnauthorized?: (c: Context, reason: "missing" | "invalid") => Response;
  /**
   * Render the 403 — "I know exactly who you are, and this isn't yours", fixed
   * by requesting a different role. Receives the resolved record.
   */
  onForbidden?: (c: Context, record: T) => Response;
}

export function honoApiKeyMiddleware<T>(opts: HonoApiKeyOptions<T>): MiddlewareHandler {
  const ctxKey = opts.contextKey ?? "apiKey";
  return async (c, next) => {
    const presented = extractKey(c, opts.headerName);
    if (!presented) {
      return opts.onUnauthorized?.(c, "missing") ?? c.json({ error: "missing_api_key" }, 401);
    }

    const record = await opts.lookup(presented);
    if (!record) {
      return opts.onUnauthorized?.(c, "invalid") ?? c.json({ error: "invalid_api_key" }, 401);
    }

    if (opts.authorize && !(await opts.authorize(record, c))) {
      return opts.onForbidden?.(c, record) ?? c.json({ error: "forbidden" }, 403);
    }

    c.set(ctxKey, opts.project ? opts.project(record) : record);
    await next();
  };
}

export interface HonoRateLimitOptions {
  /**
   * Render the 429. The `X-RateLimit-*` and `Retry-After` headers are still set
   * by the middleware — the hook shapes the body only.
   */
  onLimited?: (c: Context, result: RateLimitResult) => Response;
}

export function honoRateLimit(
  limiter: SlidingWindowRateLimiter,
  keyFn?: (c: Context) => RateLimitKey,
  opts?: HonoRateLimitOptions,
): MiddlewareHandler {
  return async (c, next) => {
    const { key, max } = resolveRateLimitKey(keyFn ? keyFn(c) : clientIp(c));
    const r = await limiter.check(key, max === undefined ? {} : { max });
    c.header("X-RateLimit-Limit", String(r.limit));
    c.header("X-RateLimit-Remaining", String(r.remaining));
    if (!r.allowed) {
      c.header("Retry-After", String(Math.max(0, Math.ceil((r.resetAt - Date.now()) / 1000))));
      return opts?.onLimited?.(c, r) ?? c.json({ error: "rate_limited" }, 429);
    }
    await next();
  };
}

function extractKey(c: Context, headerName?: string): string | null {
  if (headerName) return c.req.header(headerName) ?? null;
  const auth = c.req.header("Authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  return c.req.header("x-api-key") ?? null;
}

/**
 * Default rate-limit bucket key. NOTE: with no `x-forwarded-for` this returns
 * `"unknown"`, so on a loopback-bound service with no proxy in front EVERY
 * caller shares one bucket. That is usually not what you want — pass a `keyFn`
 * that keys on the token/record id instead.
 */
function clientIp(c: Context): string {
  const xff = c.req.header("x-forwarded-for");
  return xff ? xff.split(",")[0]!.trim() : "unknown";
}
