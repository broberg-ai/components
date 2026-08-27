/**
 * @broberg/chat/hono — Stack B (Hono, Bun/edge).
 *
 * Structurally typed against Hono rather than importing it, so this subpath
 * adds no dependency and no version pin. Everything below `c.req.raw` is the
 * SAME code Next runs — one implementation, so a behaviour that holds in one
 * stack and not the other is a red test rather than a production discovery.
 *
 *   import { Hono } from "hono";
 *   import { chatHandler } from "@broberg/chat/hono";
 *
 *   const app = new Hono();
 *   app.post("/api/chat", chatHandler({
 *     chat,
 *     getCaller: (req) => sessionFrom(req),
 *     getCtx:    (req, caller) => ({ api: apiFor(caller) }),
 *   }));
 */
import { createChatHandler, type ChatHandlerOptions } from "./http.js";

/** The shape this adapter needs from a Hono context — nothing more. */
export interface HonoLikeContext {
  req: { raw: Request };
}

export function chatHandler<Ctx = unknown, Caller = unknown>(
  opts: ChatHandlerOptions<Ctx, Caller>,
): (c: HonoLikeContext) => Promise<Response> {
  const handle = createChatHandler(opts);
  return (c: HonoLikeContext) => handle(c.req.raw);
}

export type { ChatHandlerOptions };
