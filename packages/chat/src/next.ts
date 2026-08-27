/**
 * @broberg/chat/next — Stack A (Next.js App Router).
 *
 * A thin, deliberate wrapper: App Router route handlers already take a
 * web-standard `Request` and return a `Response`, so the whole implementation
 * lives in ./http and Next and Hono cannot drift apart.
 *
 * What this subpath adds is the Next-specific knowledge a consumer otherwise
 * gets wrong once: a streamed answer must not be statically optimised or
 * buffered, so the route is dynamic and runs on the node runtime.
 *
 *   // app/api/admin/chat/route.ts
 *   import { createChatRoute } from "@broberg/chat/next";
 *
 *   export const runtime = "nodejs";        // streaming + your existing session code
 *   export const dynamic = "force-dynamic"; // never cached, never prerendered
 *
 *   export const POST = createChatRoute({
 *     chat,                                                    // createChat(), model injected
 *     getCaller: async (req) => await readProfile(req),        // YOUR existing pattern
 *     getCtx:    async (req, caller) => ({ api: apiFor(caller) }),
 *   });
 */
import { createChatHandler, type ChatHandler, type ChatHandlerOptions } from "./http.js";

/**
 * A `POST` handler for an App Router route.
 *
 * Next passes `(request, context)`; the second argument is ignored on purpose —
 * this route takes no path params.
 */
export function createChatRoute<Ctx = unknown, Caller = unknown>(
  opts: ChatHandlerOptions<Ctx, Caller>,
): ChatHandler {
  return createChatHandler(opts);
}

export type { ChatHandler, ChatHandlerOptions };
