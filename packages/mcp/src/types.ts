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

/** A text content block. */
export interface TextContent {
  type: "text";
  text: string;
}
/** A base64 image block (`data` is raw base64, no `data:` prefix) — an MCP client renders it inline. */
export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}
/** A base64 audio block. */
export interface AudioContent {
  type: "audio";
  data: string;
  mimeType: string;
}
/** A link to a resource the client may fetch itself. `name` is required (MCP spec). */
export interface ResourceLink {
  type: "resource_link";
  uri: string;
  name: string;
  mimeType?: string;
  description?: string;
}
/** An embedded resource — inline `text` OR a base64 `blob` (exactly one, per MCP spec). */
export interface EmbeddedResource {
  type: "resource";
  resource:
    | { uri: string; mimeType?: string; text: string }
    | { uri: string; mimeType?: string; blob: string };
}
/** Any MCP tool-result content block. Text covers most tools; image/audio/resource
 *  let a tool return media an MCP client (Claude/ChatGPT) shows inline. */
export type ContentBlock =
  | TextContent
  | ImageContent
  | AudioContent
  | ResourceLink
  | EmbeddedResource;

/** The MCP tool-result envelope. `content` is a list of typed blocks. */
export interface ToolResult {
  content: ContentBlock[];
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
