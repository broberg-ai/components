import { resolveRateLimitKey, type RateLimitKey, type SlidingWindowRateLimiter } from "./rate-limit";

/**
 * Next.js (App Router) adapter — built on the Web-standard `Request`/`Response`
 * that route handlers already use, so it is edge-safe and pulls in no `next`
 * dependency. The consumer supplies `lookup` (hash + DB read).
 */
export interface ApiKeyAuthOptions<T> {
  lookup: (presented: string) => Promise<T | null> | T | null;
  /** Override the header. Default: `Authorization: Bearer …` then `x-api-key`. */
  headerName?: string;
  authorize?: (record: T, req: Request) => boolean | Promise<boolean>;
  /**
   * Narrow what the handler receives. By default the WHOLE looked-up record is
   * passed through — including a storage `hash` column and anything else on the
   * row. Not a credential leak, but more than a handler needs; supply `project`
   * to pass a caller shape you chose. (Mirrors the Hono adapter.)
   */
  project?: (record: T) => unknown;
}

type RouteHandler<T> = (req: Request, record: T, ...rest: unknown[]) => Response | Promise<Response>;

/**
 * Wrap a route handler so it only runs with a valid, authorized key; the
 * resolved record is passed as the 2nd argument. 401 on missing/invalid,
 * 403 when `authorize` rejects.
 */
export function withApiKeyAuth<T>(
  handler: RouteHandler<T>,
  opts: ApiKeyAuthOptions<T>,
): (req: Request, ...rest: unknown[]) => Promise<Response> {
  return async (req, ...rest) => {
    const presented = extractKey(req, opts.headerName);
    if (!presented) return json({ error: "missing_api_key" }, 401);

    const record = await opts.lookup(presented);
    if (!record) return json({ error: "invalid_api_key" }, 401);

    if (opts.authorize && !(await opts.authorize(record, req))) {
      return json({ error: "forbidden" }, 403);
    }

    return handler(req, (opts.project ? opts.project(record) : record) as T, ...rest);
  };
}

/** Returns a 429 `Response` when over the limit, or `null` to continue. */
export function nextRateLimit(
  limiter: SlidingWindowRateLimiter,
  keyFn?: (req: Request) => RateLimitKey,
): (req: Request) => Promise<Response | null> {
  return async (req) => {
    const { key, max } = resolveRateLimitKey(keyFn ? keyFn(req) : clientIp(req));
    const r = await limiter.check(key, max === undefined ? {} : { max });
    if (r.allowed) return null;
    const retry = Math.max(1, Math.ceil((r.resetAt - Date.now()) / 1000));
    return json({ error: "rate_limited" }, 429, {
      "Retry-After": String(retry),
      "X-RateLimit-Limit": String(r.limit),
      "X-RateLimit-Remaining": "0",
    });
  };
}

function extractKey(req: Request, headerName?: string): string | null {
  if (headerName) return req.headers.get(headerName);
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  return req.headers.get("x-api-key");
}

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  return xff ? xff.split(",")[0]!.trim() : "unknown";
}

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}
