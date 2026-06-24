import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerMcpServerTools } from "./register";
import { guardSubagents } from "./guard";
import type { AnyToolDef, ToolContext } from "./types";
import type { AuditFn } from "./audit";

export interface StdioMcpOptions<Ctx = unknown> {
  name: string;
  version: string;
  tools: AnyToolDef<Ctx>[];
  /** Resolve the (constant, env-injected) context for stdio local trust. */
  getContext?: (extra: unknown) => ToolContext<Ctx> | Promise<ToolContext<Ctx>>;
  audit?: AuditFn;
  /**
   * Opt-in (default false): before registering, exit(0) if this process was
   * spawned as a Claude subagent / forked session / orphan — buddy needs this,
   * trail leaves it off.
   */
  guardSubagents?: boolean;
  /**
   * Run on SIGTERM/SIGINT before exit — e.g. close the DB so a WAL checkpoints
   * cleanly (trail's graceful-shutdown need).
   */
  onShutdown?: () => void | Promise<void>;
}

export interface StdioMcpServer {
  /** The underlying SDK server, for advanced wiring (prompts, resources). */
  server: McpServer;
  /** Connect stdio + install the shutdown hooks. Resolves once connected. */
  start(): Promise<void>;
}

/**
 * Build a stdio MCP server: high-level `McpServer` + `StdioServerTransport`,
 * the {@link AnyToolDef} array registered via the shared dispatch, an opt-in
 * subagent guard, and a WAL-safe graceful shutdown. trail's pilot path.
 */
export function createStdioMcpServer<Ctx = unknown>(
  opts: StdioMcpOptions<Ctx>,
): StdioMcpServer {
  if (opts.guardSubagents) guardSubagents();

  const server = new McpServer({ name: opts.name, version: opts.version });
  registerMcpServerTools(server, opts.tools, {
    getContext: opts.getContext,
    audit: opts.audit,
  });

  let shuttingDown = false;
  const shutdown = async (code: number) => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await opts.onShutdown?.();
    } catch {
      /* best-effort */
    }
    process.exit(code);
  };

  return {
    server,
    async start() {
      process.on("SIGTERM", () => void shutdown(0));
      process.on("SIGINT", () => void shutdown(0));
      await server.connect(new StdioServerTransport());
    },
  };
}
