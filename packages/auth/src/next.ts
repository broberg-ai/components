import { toNextJsHandler } from "better-auth/next-js";

/**
 * Stack A (Next.js App Router) route-handler factory. Wraps Better Auth's own
 * `toNextJsHandler`. This entry imports no hono.
 *
 * The param is exactly what `toNextJsHandler` accepts (a `{ handler }` slice or
 * a bare handler), NOT the nominal `Auth` — so a plugin-narrowed
 * `createTypedAuth(...)` is accepted without a cast (F008.8; `Auth<O>` is
 * invariant in `O`).
 *
 * Usage in `app/api/auth/[...all]/route.ts`:
 *   export const { GET, POST } = toNextHandler(auth)
 */
export function toNextHandler(
  auth: Parameters<typeof toNextJsHandler>[0],
): ReturnType<typeof toNextJsHandler> {
  return toNextJsHandler(auth);
}
