import type { Hono, Context } from "hono";
import type { Auth } from "./index.js";

/**
 * Stack B (Hono) mount helper. Better Auth exposes `auth.handler(request)` — a
 * standard Web Request→Response handler — so mounting is a one-liner. This entry
 * imports no next/*.
 */

/** Mount Better Auth on a Hono app — handles every GET/POST under `${basePath}/*`
 *  (default `/api/auth`). Usage: `mountAuth(app, auth)`. */
export function mountAuth(app: Hono, auth: Auth, basePath = "/api/auth"): void {
  app.on(["POST", "GET"], `${basePath}/*`, (c: Context) => auth.handler(c.req.raw));
}

/** Resolve the current Better Auth session from a Hono context (or null). */
export function getSession(c: Context, auth: Auth): ReturnType<Auth["api"]["getSession"]> {
  return auth.api.getSession({ headers: c.req.raw.headers }) as ReturnType<
    Auth["api"]["getSession"]
  >;
}
