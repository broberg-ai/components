import type { IncomingMessage, ServerResponse } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { registerTools } from "./register";
import { SessionRegistry } from "./session-registry";
import type { AnyToolDef, ToolContext } from "./types";
import type { AuditFn } from "./audit";

export interface SseMcpOptions<Ctx = unknown> {
  name: string;
  version: string;
  tools: AnyToolDef<Ctx>[];
  /** The POST path announced in the SSE `endpoint` event (default "/message"). */
  messagesPath?: string;
  /** Resolve principal + ctx from the SSE GET request. Throw to reject with 401. */
  authenticate?: (req: IncomingMessage) => ToolContext<Ctx> | Promise<ToolContext<Ctx>>;
  audit?: AuditFn;
  /**
   * Server-level instructions surfaced in the MCP `initialize` result — a short
   * "what this server is + how to use it" intro the client/model sees on connect
   * (alongside serverInfo + the per-tool descriptions). Optional.
   */
  instructions?: string;
  /** Idle eviction window for a session (default 30 min). */
  ttlMs?: number;
}

export interface SseMcpHandler {
  /** GET handler — open the SSE stream, register a fresh server, store the session. */
  handleSse(req: IncomingMessage, res: ServerResponse): Promise<void>;
  /** POST handler — route `{messagesPath}?sessionId=` to its session transport. */
  handleMessage(req: IncomingMessage, res: ServerResponse): Promise<void>;
  /** The live, TTL-swept session registry. */
  registry: SessionRegistry<SSEServerTransport>;
  /** Stop the sweep + close all sessions. */
  close(): void;
}

/**
 * The classic two-route SSE transport (Node `http`), session-stateful with a
 * TTL-swept registry so idle sessions are reclaimed (closing cms's leak gap).
 * SSE is legacy/back-compat — new servers should prefer the stateless
 * Streamable-HTTP handler ({@link import("./http").createHttpMcpHandler}); this
 * exists for clients that only speak SSE.
 */
export function createSseMcpHandler<Ctx = unknown>(opts: SseMcpOptions<Ctx>): SseMcpHandler {
  const messagesPath = opts.messagesPath ?? "/message";
  const registry = new SessionRegistry<SSEServerTransport>({
    ttlMs: opts.ttlMs,
    onEvict: (_id, transport) => void transport.close(),
  });

  return {
    registry,
    close: () => registry.close(),

    async handleSse(req, res) {
      let context: ToolContext<Ctx>;
      try {
        context = opts.authenticate
          ? await opts.authenticate(req)
          : ({ principal: {}, ctx: undefined } as ToolContext<Ctx>);
      } catch (err) {
        res
          .writeHead(401, { "content-type": "application/json" })
          .end(JSON.stringify({ error: err instanceof Error ? err.message : "unauthorized" }));
        return;
      }

      const transport = new SSEServerTransport(messagesPath, res);
      const server = new Server(
        { name: opts.name, version: opts.version },
        { capabilities: { tools: {} }, instructions: opts.instructions },
      );
      registerTools(server, opts.tools, { getContext: () => context, audit: opts.audit });

      registry.set(transport.sessionId, transport);
      transport.onclose = () => registry.delete(transport.sessionId);

      // server.connect() calls transport.start(), which emits the endpoint event.
      await server.connect(transport);
    },

    async handleMessage(req, res) {
      const sessionId = new URL(req.url ?? "", "http://localhost").searchParams.get("sessionId") ?? "";
      const transport = registry.get(sessionId);
      if (!transport) {
        res
          .writeHead(404, { "content-type": "application/json" })
          .end(JSON.stringify({ error: "unknown sessionId" }));
        return;
      }
      await transport.handlePostMessage(req, res);
    },
  };
}
