import type { Hono, Context } from "hono";

/**
 * Stack B (Hono) mount helper. Better Auth exposes `auth.handler(request)` — a
 * standard Web Request→Response handler — so mounting is a one-liner. This entry
 * imports no next/*.
 *
 * The helpers accept the STRUCTURAL slice of a Better Auth instance they
 * actually touch (`.handler` / `.api.getSession`), NOT the nominal `Auth`. That
 * is what lets a plugin-narrowed `createTypedAuth(...)` mount with no cast:
 * Better Auth's `Auth<O>` is invariant in `O`, so a param typed as the wide
 * `Auth` would reject a plugin-narrowed instance (F008.8).
 */

/** A Web-standard request handler — the one method `mountAuth` calls. */
type WithHandler = { handler: (request: Request) => Response | Promise<Response> };

/** The one accessor `getSession` calls. */
type WithGetSession = { api: { getSession: (options: { headers: Headers }) => unknown } };

/** Mount Better Auth on a Hono app — handles every GET/POST under `${basePath}/*`
 *  (default `/api/auth`). Usage: `mountAuth(app, auth)`. Accepts both `createAuth`
 *  and the plugin-narrowed `createTypedAuth` results without a cast. */
export function mountAuth(app: Hono, auth: WithHandler, basePath = "/api/auth"): void {
  app.on(["POST", "GET"], `${basePath}/*`, (c: Context) => auth.handler(c.req.raw));
}

/** Resolve the current Better Auth session from a Hono context (or null).
 *  Generic over the auth instance so a plugin-narrowed `createTypedAuth` result
 *  keeps its precise session return type (no `any`). */
export function getSession<A extends WithGetSession>(
  c: Context,
  auth: A,
): ReturnType<A["api"]["getSession"]> {
  return auth.api.getSession({ headers: c.req.raw.headers }) as ReturnType<
    A["api"]["getSession"]
  >;
}
