import type { Context, MiddlewareHandler } from "hono";
import type { SlidingWindowRateLimiter } from "./rate-limit";

/**
 * Hono adapter. The consumer supplies `lookup` (it does the hash + DB read, so
 * the package never owns storage); the middleware reads the bearer/x-api-key
 * header, resolves the record, optionally authorizes it, and stashes it on the
 * context. 401 on missing/invalid, 403 when `authorize` rejects.
 */
export interface HonoApiKeyOptions<T> {
  lookup: (presented: string) => Promise<T | null> | T | null;
  /** Override the header. Default: `Authorization: Bearer …` then `x-api-key`. */
  headerName?: string;
  authorize?: (record: T, c: Context) => boolean | Promise<boolean>;
  /** Context key the resolved record is set under. Default: `"apiKey"`. */
  contextKey?: string;
}

export function honoApiKeyMiddleware<T>(opts: HonoApiKeyOptions<T>): MiddlewareHandler {
  const ctxKey = opts.contextKey ?? "apiKey";
  return async (c, next) => {
    const presented = extractKey(c, opts.headerName);
    if (!presented) return c.json({ error: "missing_api_key" }, 401);

    const record = await opts.lookup(presented);
    if (!record) return c.json({ error: "invalid_api_key" }, 401);

    if (opts.authorize && !(await opts.authorize(record, c))) {
      return c.json({ error: "forbidden" }, 403);
    }

    c.set(ctxKey, record);
    await next();
  };
}

export function honoRateLimit(
  limiter: SlidingWindowRateLimiter,
  keyFn?: (c: Context) => string,
): MiddlewareHandler {
  return async (c, next) => {
    const key = keyFn ? keyFn(c) : clientIp(c);
    const r = await limiter.check(key);
    c.header("X-RateLimit-Remaining", String(r.remaining));
    if (!r.allowed) {
      c.header("Retry-After", String(Math.max(0, Math.ceil((r.resetAt - Date.now()) / 1000))));
      return c.json({ error: "rate_limited" }, 429);
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

function clientIp(c: Context): string {
  const xff = c.req.header("x-forwarded-for");
  return xff ? xff.split(",")[0]!.trim() : "unknown";
}
