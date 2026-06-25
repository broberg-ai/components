import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { JSONRPCMessageSchema } from "@modelcontextprotocol/sdk/types.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { registerTools } from "./register";
import { SessionRegistry } from "./session-registry";
import type { AnyToolDef, ToolContext } from "./types";
import type { AuditFn } from "./audit";

const ENCODER = new TextEncoder();

/**
 * A Web-Streams SSE server transport — the Stack-A counterpart to the SDK's
 * Node-only `SSEServerTransport` (which assumes Node `req`/`res` and breaks in
 * Next App Router / Bun / Deno). It speaks the identical wire protocol
 * (`event: endpoint` on connect, `event: message` for each reply) over a
 * `ReadableStream`, so any SDK client works unchanged. cms hand-rolled exactly
 * this as `NextSSETransport`; here it's the reusable primitive.
 */
class WebSseServerTransport implements Transport {
  readonly sessionId: string;
  /** The SSE body stream handed to the GET `Response`. */
  readonly stream: ReadableStream<Uint8Array>;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  private controller!: ReadableStreamDefaultController<Uint8Array>;
  private closed = false;

  constructor(private readonly endpoint: string) {
    this.sessionId = randomUUID();
    this.stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
      },
      cancel: () => void this.close(),
    });
  }

  /** Called by `server.connect(transport)` — emit the `endpoint` event. */
  async start(): Promise<void> {
    const url = new URL(this.endpoint, "http://localhost");
    url.searchParams.set("sessionId", this.sessionId);
    const relative = url.pathname + url.search + url.hash;
    this.enqueue(`event: endpoint\ndata: ${relative}\n\n`);
  }

  async send(message: JSONRPCMessage): Promise<void> {
    this.enqueue(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      this.controller.close();
    } catch {
      /* already closed / cancelled by the client */
    }
    this.onclose?.();
  }

  /** Parse + route an inbound POST body to the connected server. */
  async handleMessage(raw: unknown): Promise<void> {
    let parsed: JSONRPCMessage;
    try {
      parsed = JSONRPCMessageSchema.parse(raw);
    } catch (err) {
      this.onerror?.(err as Error);
      throw err;
    }
    this.onmessage?.(parsed);
  }

  private enqueue(text: string): void {
    if (this.closed) return;
    this.controller.enqueue(ENCODER.encode(text));
  }
}

export interface WebSseMcpOptions<Ctx = unknown> {
  name: string;
  version: string;
  tools: AnyToolDef<Ctx>[];
  /** The POST path announced in the SSE `endpoint` event (default "/message"). */
  messagesPath?: string;
  /** Resolve principal + ctx from the SSE GET request. Throw to reject with 401. */
  authenticate?: (req: Request) => ToolContext<Ctx> | Promise<ToolContext<Ctx>>;
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

export interface WebSseMcpHandler {
  /** GET — open the SSE stream, register a fresh server, store the session. Returns the streaming `Response`. */
  handleSse(req: Request): Promise<Response>;
  /** POST — route `{messagesPath}?sessionId=` to its session transport. Returns 202 / 404 / 400. */
  handleMessage(req: Request): Promise<Response>;
  /** The live, TTL-swept session registry. */
  registry: SessionRegistry<WebSseServerTransport>;
  /** Stop the sweep + close all sessions. */
  close(): void;
}

/**
 * The Web-standard (`Request => Response`) two-route SSE handler for Stack A
 * (Next App Router) and any fetch-style runtime (Bun, Deno, Hono). Session-
 * stateful with a TTL-swept registry (closing cms's leak gap). New servers
 * should prefer the stateless {@link import("./http").createHttpMcpHandler};
 * this exists for clients that only speak SSE.
 */
export function createWebSseMcpHandler<Ctx = unknown>(
  opts: WebSseMcpOptions<Ctx>,
): WebSseMcpHandler {
  const messagesPath = opts.messagesPath ?? "/message";
  const registry = new SessionRegistry<WebSseServerTransport>({
    ttlMs: opts.ttlMs,
    onEvict: (_id, transport) => void transport.close(),
  });

  return {
    registry,
    close: () => registry.close(),

    async handleSse(req) {
      let context: ToolContext<Ctx>;
      try {
        context = opts.authenticate
          ? await opts.authenticate(req)
          : ({ principal: {}, ctx: undefined } as ToolContext<Ctx>);
      } catch (err) {
        return json(401, { error: err instanceof Error ? err.message : "unauthorized" });
      }

      const transport = new WebSseServerTransport(messagesPath);
      const server = new Server(
        { name: opts.name, version: opts.version },
        { capabilities: { tools: {} }, instructions: opts.instructions },
      );
      registerTools(server, opts.tools, { getContext: () => context, audit: opts.audit });

      registry.set(transport.sessionId, transport);
      transport.onclose = () => registry.delete(transport.sessionId);

      // connect() calls transport.start(), which enqueues the endpoint event
      // into the stream we hand back below.
      await server.connect(transport);

      return new Response(transport.stream, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
        },
      });
    },

    async handleMessage(req) {
      const sessionId = new URL(req.url).searchParams.get("sessionId") ?? "";
      const transport = registry.get(sessionId);
      if (!transport) return json(404, { error: "unknown sessionId" });

      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return json(400, { error: "invalid JSON body" });
      }
      try {
        await transport.handleMessage(body);
      } catch {
        return json(400, { error: "invalid JSON-RPC message" });
      }
      return new Response("Accepted", { status: 202 });
    },
  };
}

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
