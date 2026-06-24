import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { registerTools } from "./register";
import type { AnyToolDef, ToolContext } from "./types";
import type { AuditFn } from "./audit";

export interface HttpMcpOptions<Ctx = unknown> {
  name: string;
  version: string;
  tools: AnyToolDef<Ctx>[];
  /**
   * Resolve principal + ctx from the raw HTTP request (e.g. the Bearer header).
   * Throw to reject the call with 401. Defaults to an empty, all-allowed
   * principal (suitable behind another auth layer or for local dev).
   */
  authenticate?: (req: Request) => ToolContext<Ctx> | Promise<ToolContext<Ctx>>;
  audit?: AuditFn;
}

/**
 * A Web-standard `(Request) => Response` Streamable-HTTP handler, STATELESS
 * per-request: a fresh `Server` + transport per call, no session Map, no TTL —
 * leak-free and multi-replica-safe (cardmem's prod model). Auth is resolved
 * once at the HTTP boundary. Drop it into Hono (`c.req.raw`), Next App Router
 * (the `Request`), or `Bun.serve`.
 */
export function createHttpMcpHandler<Ctx = unknown>(
  opts: HttpMcpOptions<Ctx>,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    let context: ToolContext<Ctx>;
    try {
      context = opts.authenticate
        ? await opts.authenticate(req)
        : ({ principal: {}, ctx: undefined } as ToolContext<Ctx>);
    } catch (err) {
      return jsonRpcError(401, err instanceof Error ? err.message : "unauthorized");
    }

    // Fresh server + transport per request — the stateless, leak-free path.
    const server = new Server(
      { name: opts.name, version: opts.version },
      { capabilities: { tools: {} } },
    );
    registerTools(server, opts.tools, { getContext: () => context, audit: opts.audit });

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    return transport.handleRequest(req);
  };
}

function jsonRpcError(status: number, message: string): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message }, id: null }),
    { status, headers: { "content-type": "application/json" } },
  );
}
