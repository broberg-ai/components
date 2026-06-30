import { toNextJsHandler } from "better-auth/next-js";
import type { Auth } from "./index.js";

/**
 * Stack A (Next.js App Router) route-handler factory. Wraps Better Auth's own
 * `toNextJsHandler`. This entry imports no hono.
 *
 * Usage in `app/api/auth/[...all]/route.ts`:
 *   export const { GET, POST } = toNextHandler(auth)
 */
export function toNextHandler(auth: Auth): ReturnType<typeof toNextJsHandler> {
  return toNextJsHandler(auth);
}
