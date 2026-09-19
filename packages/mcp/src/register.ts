import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dispatchTool, mayCall, toToolListEntry, ToolNotFoundError } from "./tools";
import type { AnyToolDef, ToolContext, ToolResult } from "./types";
import type { AuditFn } from "./audit";

export interface RegisterOptions<Ctx = unknown> {
  /**
   * Resolve the per-call principal + ctx from the transport's request `extra`.
   * For HTTP this reads the validated auth; for stdio (local trust) it returns
   * a constant env-injected context.
   *
   * SINCE 0.6.0 IT IS ALSO CALLED FOR `tools/list`, not only for `tools/call`,
   * because the listing is now filtered by the principal (F007.13). Two
   * consequences worth knowing before you upgrade:
   *
   *  - It must not THROW on a list request. It is deliberately not wrapped in a
   *    try/catch that falls back to the unfiltered list: falling back would
   *    serve the whole catalogue to whoever caused the error, which is the leak
   *    this change closes. Every transport in this package passes a constant
   *    closure that ignores `extra`, so only a caller wiring `registerTools`
   *    directly can be exposed.
   *  - The default is an EMPTY principal, which is not the same as all-allowed:
   *    it holds no scopes, so a scope-gated tool is absent from its listing —
   *    exactly as the gate has always refused it. A host with scoped tools
   *    should pass a real `getContext` rather than rely on the default.
   */
  getContext?: (extra: unknown) => ToolContext<Ctx> | Promise<ToolContext<Ctx>>;
  audit?: AuditFn;
}

function contextResolver<Ctx>(opts: RegisterOptions<Ctx>) {
  return (
    opts.getContext ?? (() => ({ principal: {}, ctx: undefined } as ToolContext<Ctx>))
  );
}

/**
 * Low-level backend (cardmem / cms): wire ListTools + CallTool onto a raw
 * `Server`. The caller constructs the `Server` with the `tools` capability.
 * A missing tool maps to an MCP `MethodNotFound`; every other failure is an
 * `isError` result via the shared {@link dispatchTool}.
 */
export function registerTools<Ctx = unknown>(
  server: Server,
  tools: AnyToolDef<Ctx>[],
  opts: RegisterOptions<Ctx> = {},
): void {
  const getContext = contextResolver(opts);

  /**
   * The LIST answers "what may YOU call", not "what exists" (F007.13).
   *
   * It used to answer the second question, and the cost was not a wasted call:
   * a model handed a tool it will be refused promises the user something it
   * cannot deliver, so the failure lands on the person, not the machine.
   *
   * Filtered through {@link mayCall} — the SAME predicate `dispatchTool` uses
   * — so the catalogue and the gate cannot disagree. The gate stays exactly as
   * it was: the list is a courtesy, the gate is the control, and a client may
   * still name a tool it never saw.
   */
  server.setRequestHandler(ListToolsRequestSchema, async (_req, extra) => {
    const { principal } = await getContext(extra);
    return { tools: tools.filter((t) => mayCall(t, principal)).map(toToolListEntry) };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    const context = await getContext(extra);
    try {
      return (await dispatchTool(
        tools,
        req.params.name,
        req.params.arguments,
        context,
        { audit: opts.audit },
      )) as ToolResult;
    } catch (err) {
      if (err instanceof ToolNotFoundError) {
        throw new McpError(ErrorCode.MethodNotFound, err.message);
      }
      throw err;
    }
  });
}

/**
 * High-level backend (trail / musicquiz): register each tool onto an
 * `McpServer` via `.tool()`. The SDK converts the raw Zod shape to JSON Schema
 * internally (no `zod-to-json-schema` here). The same {@link dispatchTool}
 * applies the write-guard, scope-gate, uniform envelope, and audit — so both
 * backends behave identically from one definition.
 *
 * ONE MEASURED ASYMMETRY (F007.13): `tools/list` is NOT filtered per principal
 * here, and cannot be without changing backends. The SDK builds the listing
 * from what `server.tool()` registered once at startup, so there is no request
 * `extra` — and therefore no principal — at the moment the list is decided.
 * The low-level {@link registerTools} backend, which every HTTP and SSE
 * transport uses, does filter.
 *
 * It costs nothing today because this backend is stdio's, where the principal
 * is constant, env-injected and local-trust — and a principal that may call
 * everything sees the same list either way. It would start costing the day a
 * caller registers a RESTRICTED principal on this path; that is a different
 * card, not a silent gap.
 */
export function registerMcpServerTools<Ctx = unknown>(
  server: McpServer,
  tools: AnyToolDef<Ctx>[],
  opts: RegisterOptions<Ctx> = {},
): void {
  const getContext = contextResolver(opts);

  for (const tool of tools) {
    // The SDK converts the shape itself on this path, with the same silent
    // empty-schema failure mode. Convert once up front purely so the guard in
    // toToolListEntry throws at REGISTRATION time rather than shipping a
    // schema-less tool to the client.
    if (!tool.inputJsonSchema) toToolListEntry(tool);

    server.tool(
      tool.name,
      tool.description,
      tool.inputSchema,
      async (args: unknown, extra: unknown) => {
        const context = await getContext(extra);
        return dispatchTool(tools, tool.name, args, context, { audit: opts.audit });
      },
    );
  }
}
