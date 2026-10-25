// Hono middleware over the framework-free core — the shape lens-daemon and
// auth-relay already mount: app.use("*", localRequestGuard({ port })).
import type { MiddlewareHandler } from "hono";
import { checkLocalRequest, describeRefusal, type LocalGuardOptions, type LocalGuardRefusal } from "./index";

export interface HonoLocalGuardOptions extends LocalGuardOptions {
  /** Name used in the refusal message, e.g. "lens daemon" or "ARS". */
  name?: string;
  /** Shape the JSON body. Default `{ ok: false, error }` (lens-daemon's). */
  body?: (r: LocalGuardRefusal, message: string) => unknown;
}

export function localRequestGuard(opts: HonoLocalGuardOptions): MiddlewareHandler {
  return async (c, next) => {
    const r = checkLocalRequest(c.req.raw, opts);
    if (r) {
      const message = describeRefusal(r, opts.name);
      return c.json((opts.body ? opts.body(r, message) : { ok: false, error: message }) as object, r.status);
    }
    await next();
  };
}
