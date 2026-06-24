import type { z } from "zod";

export type ToolKind = "read" | "write";

/**
 * The resolved caller identity that auth gates read. Every auth model in the
 * estate (static Bearer, hashed 3-tier, OAuth 2.1, stdio env-injected) resolves
 * to this one shape. Hosts may attach extra fields (e.g. siteId, tenant).
 */
export interface Principal {
  userId?: string;
  orgId?: string;
  /** A read-only principal cannot invoke a `kind: 'write'` tool (write-guard). */
  readOnly?: boolean;
  /** Capability / OAuth scopes for the per-tool scope-gate (AND semantics). */
  scopes?: string[];
  /** True when resolved from a session/cookie rather than an API key. */
  viaSession?: boolean;
  [extra: string]: unknown;
}

/** Per-call context handed to every tool handler. */
export interface ToolContext<Ctx = unknown> {
  principal: Principal;
  /** Host-injected dependencies (db, services) or env-injected context. */
  ctx: Ctx;
}

/** The MCP text result envelope — text-only covers the whole estate today. */
export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  [extra: string]: unknown;
}

/** What a handler may return: raw text (auto-wrapped) or a full envelope. */
export type HandlerReturn = string | ToolResult;

/** A raw Zod shape — a plain object of zod validators (matches `McpServer.tool()`). */
export type RawShape = z.ZodRawShape;

/**
 * A single tool definition. `inputSchema` is a RAW Zod shape (not a `ZodObject`)
 * so the same def drives both the high-level `McpServer.tool()` path (shape
 * passed straight in) and the low-level `Server` path (wrapped via `z.object`).
 */
export interface ToolDef<Shape extends RawShape = RawShape, Ctx = unknown> {
  name: string;
  description: string;
  /** default 'read' */
  kind?: ToolKind;
  /** optional per-tool required scopes (AND) */
  scopes?: string[];
  inputSchema: Shape;
  handler: (
    input: z.infer<z.ZodObject<Shape>>,
    context: ToolContext<Ctx>,
  ) => HandlerReturn | Promise<HandlerReturn>;
}

/**
 * The erased tool type the registry + dispatch operate over. A typed
 * `ToolDef<Shape, Ctx>` is structurally assignable to this (handler input
 * widens to `any`), so `defineTool` keeps call-site type-safety while
 * collections stay uniform.
 */
export interface AnyToolDef<Ctx = unknown> {
  name: string;
  description: string;
  kind?: ToolKind;
  scopes?: string[];
  inputSchema: RawShape;
  handler: (
    input: any,
    context: ToolContext<Ctx>,
  ) => HandlerReturn | Promise<HandlerReturn>;
}
