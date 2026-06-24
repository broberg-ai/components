// Framework wiring helpers. Dependency-free (loose structural types) — they
// import no express/hono/next, so they live in the core entry. They exist only
// to codify the ONE bit of wiring that's easy to get wrong: the SSE GET/POST
// route split. The Streamable-HTTP handler needs no adapter — it already IS a
// valid Web route handler:
//   • Next App Router:  export const POST = createHttpMcpHandler(opts)
//   • Hono / Bun:       app.all("/mcp", (c) => handler(c.req.raw))

import type { WebSseMcpHandler } from "./web-sse";
import type { SseMcpHandler } from "./sse";

/**
 * Split a Web-Streams SSE handler into the two route handlers a fetch-style
 * framework mounts — GET opens the stream, POST delivers a message. For a
 * Next.js App Router `route.ts`:
 *
 *   const mcp = createWebSseMcpHandler({ ... });
 *   export const { GET, POST } = toSseRoutes(mcp);
 *
 * Works in any fetch runtime (Bun, Deno, Hono `c.req.raw`).
 */
export function toSseRoutes(handler: WebSseMcpHandler): {
  GET: (req: Request) => Promise<Response>;
  POST: (req: Request) => Promise<Response>;
} {
  return {
    GET: (req) => handler.handleSse(req),
    POST: (req) => handler.handleMessage(req),
  };
}

interface NodeRouteApp {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- framework req/res, not imported here
  get(path: string, handler: (req: any, res: any) => unknown): unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- framework req/res, not imported here
  post(path: string, handler: (req: any, res: any) => unknown): unknown;
}

/**
 * Mount a Node SSE handler ({@link import("./sse").createSseMcpHandler}) onto an
 * Express-style app — GET `{ssePath}` opens the stream, POST `{messagesPath}`
 * delivers a message (the musicquiz / Express shape):
 *
 *   mountNodeSse(app, createSseMcpHandler({ ... }), { ssePath: "/sse", messagesPath: "/message" });
 */
export function mountNodeSse(
  app: NodeRouteApp,
  handler: SseMcpHandler,
  opts: { ssePath?: string; messagesPath?: string } = {},
): void {
  app.get(opts.ssePath ?? "/sse", (req, res) => handler.handleSse(req, res));
  app.post(opts.messagesPath ?? "/message", (req, res) => handler.handleMessage(req, res));
}
