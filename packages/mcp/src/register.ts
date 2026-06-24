import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dispatchTool, toToolListEntry, ToolNotFoundError } from "./tools";
import type { AnyToolDef, ToolContext, ToolResult } from "./types";
import type { AuditFn } from "./audit";

export interface RegisterOptions<Ctx = unknown> {
  /**
   * Resolve the per-call principal + ctx from the transport's request `extra`.
   * For HTTP this reads the validated auth; for stdio (local trust) it returns
   * a constant env-injected context. Defaults to an empty, all-allowed principal.
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

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(toToolListEntry),
  }));

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
 */
export function registerMcpServerTools<Ctx = unknown>(
  server: McpServer,
  tools: AnyToolDef<Ctx>[],
  opts: RegisterOptions<Ctx> = {},
): void {
  const getContext = contextResolver(opts);

  for (const tool of tools) {
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
