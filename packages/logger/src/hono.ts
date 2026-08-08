import type { Context, ErrorHandler, MiddlewareHandler } from "hono";
import type { Logger, LogFields } from "./index";

/**
 * Request logging for Hono. One line per request, with a request id bound to a
 * child logger so anything the handler logs is correlated with its request.
 *
 * `hono` is an OPTIONAL peer — importing this subpath is what pulls it in.
 */

export interface RequestLoggerOptions {
  /** Context key the per-request child logger is stored under. Default `"log"`. */
  contextKey?: string;
  /**
   * Where the request id comes from. Default: an incoming `x-request-id`
   * header, else a generated one — so a caller's trace id survives if it sent
   * one, and there is always a value either way.
   */
  requestId?: (c: Context) => string;
  /** Extra fields on the completion line (e.g. tenant, user id). */
  fields?: (c: Context) => LogFields;
  /**
   * Skip logging for a request — health checks and static assets otherwise
   * drown the signal. Default: log everything.
   */
  skip?: (c: Context) => boolean;
}

function defaultRequestId(c: Context): string {
  const incoming = c.req.header("x-request-id");
  if (incoming) return incoming;
  // crypto.randomUUID is available on Node 19+, Bun and edge runtimes.
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

/**
 * Emits ONE line per request, after the handler runs, at a level chosen from
 * the status: 5xx → error, 4xx → warn, else info.
 *
 * IMPORTANT — this middleware alone cannot tell you WHY a 500 happened. Hono
 * catches a thrown handler itself and turns it into a 500 response, so
 * `await next()` resolves normally and the exception never reaches this
 * middleware: you get `status: 500` and no reason. The `catch` below therefore
 * only fires when an error genuinely escapes (e.g. a custom `onError` that
 * re-throws) — it is a backstop, not the main path.
 *
 * **Wire {@link errorLogger} as `app.onError` to log the exception itself.**
 * A 500 with no cause in the log is the thing you will be staring at during an
 * incident.
 */
export function requestLogger(log: Logger, opts: RequestLoggerOptions = {}): MiddlewareHandler {
  const key = opts.contextKey ?? "log";
  const idOf = opts.requestId ?? defaultRequestId;

  return async (c, next) => {
    if (opts.skip?.(c)) return next();

    const requestId = idOf(c);
    const reqLog = log.child({ requestId });
    c.set(key as never, reqLog as never);
    c.header("x-request-id", requestId);

    const started = Date.now();
    try {
      await next();
    } catch (err) {
      reqLog.error(err instanceof Error ? err : new Error(String(err)), {
        method: c.req.method,
        path: c.req.path,
        ms: Date.now() - started,
        ...(opts.fields?.(c) ?? {}),
      });
      throw err; // observe, never swallow
    }

    const status = c.res.status;
    const line: LogFields = {
      method: c.req.method,
      path: c.req.path,
      status,
      ms: Date.now() - started,
      ...(opts.fields?.(c) ?? {}),
    };

    if (status >= 500) reqLog.error("request", line);
    else if (status >= 400) reqLog.warn("request", line);
    else reqLog.info("request", line);
  };
}

export interface ErrorLoggerOptions {
  /** Context key the request-scoped child logger was stored under. Default `"log"`. */
  contextKey?: string;
  /** The response to return after logging. Default: a bare 500. */
  respond?: (err: Error, c: Context) => Response;
}

/**
 * Hono `onError` handler that logs the exception with its stack — and, when
 * {@link requestLogger} ran first, with that request's id, so the cause and the
 * request line correlate.
 *
 * This exists because `requestLogger` CANNOT see the exception: Hono catches a
 * throwing handler before any middleware sees it. Without this, a 500 is logged
 * with no reason attached.
 *
 *   app.use("*", requestLogger(log));
 *   app.onError(errorLogger(log));
 */
export function errorLogger(log: Logger, opts: ErrorLoggerOptions = {}): ErrorHandler {
  const key = opts.contextKey ?? "log";
  return (err, c) => {
    // Prefer the request-scoped child (carries requestId); fall back to the root.
    const bound = (c.get(key as never) as Logger | undefined) ?? log;
    bound.error(err instanceof Error ? err : new Error(String(err)), {
      method: c.req.method,
      path: c.req.path,
    });
    return opts.respond?.(err, c) ?? new Response("Internal Server Error", { status: 500 });
  };
}
