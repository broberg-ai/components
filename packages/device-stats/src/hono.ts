/**
 * Stack B adapter — Hono (Bun / edge).
 *
 * NO Hono type is imported. Structural slices only, so this works with Hono,
 * with anything that hands you a `Request`, and with a future version that
 * renames its context type. See `RequestLike` in the core for why.
 */
import { deviceFromRequest, type DeviceFacts, type FromRequestOptions } from "./index";

/** What we touch on a Hono context. Structural — not `Context`. */
export interface HonoContextLike {
  req: { raw: { headers: Headers; url?: string | null } };
}

/** Derive device facts directly from a Hono context. */
export function deviceFromContext(c: HonoContextLike, opts: FromRequestOptions = {}): DeviceFacts {
  return deviceFromRequest(c.req.raw, opts);
}

export interface DeviceMiddlewareOptions extends FromRequestOptions {
  /**
   * Receives the derived facts, once per request. Send them wherever you like.
   *
   * If this throws — or rejects — the request is UNAFFECTED. A device statistic
   * is never worth a 500 on a user's page.
   */
  onDevice: (facts: DeviceFacts, c: HonoContextLike) => void | Promise<void>;
  /** Called with whatever `onDevice` threw. Default: silence. */
  onError?: (err: unknown) => void;
}

/**
 * Hono middleware that derives device facts and hands them to `onDevice`.
 *
 * ```ts
 * app.use("*", deviceMiddleware({ onDevice: (facts) => sink.record(facts) }));
 * ```
 *
 * Ship dark by construction: the derivation and the sink are both wrapped, so a
 * broken sink degrades the statistic and never the request.
 */
export function deviceMiddleware(opts: DeviceMiddlewareOptions) {
  const { onDevice, onError, ...rest } = opts;

  return async function deviceStats(c: HonoContextLike, next: () => Promise<void>): Promise<void> {
    try {
      const facts = deviceFromRequest(c.req.raw, rest);
      // Awaited so a rejecting async sink is caught here rather than surfacing
      // later as an unhandled rejection — which on some runtimes kills the
      // process, turning "the statistic failed" into "the server died".
      await onDevice(facts, c);
    } catch (err) {
      onError?.(err);
    }
    await next();
  };
}
