// @broberg/mcp — reusable MCP-server toolkit (core).
// Transports (stdio/Streamable-HTTP/SSE) + advanced auth (3-tier/OAuth) land as
// composable additions in later stories (F007.2/.4/.7/.8/.9/.10); this is the
// SDK-free heart: the typed tool registry + dispatch, static auth, audit, guard.

export type {
  Principal,
  ToolContext,
  ToolResult,
  HandlerReturn,
  RawShape,
  ToolKind,
  ToolDef,
  AnyToolDef,
} from "./types";

export { defineTool, dispatchTool, toToolListEntry, ToolNotFoundError } from "./tools";
export type { DispatchOptions } from "./tools";

export { validateBearerKey, hasScope, parseBearer } from "./auth";
export type { ApiKeyConfig, AuthResult } from "./auth";

export { resolve3TierAuth } from "./three-tier-auth";
export type { ThreeTierAuthConfig } from "./three-tier-auth";

export { createJsonlAudit } from "./audit";
export type { AuditEntry, AuditFn } from "./audit";

export { shouldExitForSubagent, guardSubagents } from "./guard";

// Transports + registration backends (SDK-coupled).
export { registerTools, registerMcpServerTools } from "./register";
export type { RegisterOptions } from "./register";
export { createStdioMcpServer } from "./stdio";
export type { StdioMcpOptions, StdioMcpServer } from "./stdio";
export { createHttpMcpHandler } from "./http";
export type { HttpMcpOptions } from "./http";
export { SessionRegistry } from "./session-registry";
export type { SessionRegistryOptions } from "./session-registry";
export { createSseMcpHandler } from "./sse";
export type { SseMcpOptions, SseMcpHandler } from "./sse";
export { definePrompt, registerPrompts } from "./prompts";
export type { PromptDef, AnyPromptDef } from "./prompts";
export { scaffoldMcpJson, starterServerSource } from "./scaffold";
export type { ScaffoldOptions, McpTransport } from "./scaffold";
export { createWebSseMcpHandler } from "./web-sse";
export type { WebSseMcpOptions, WebSseMcpHandler } from "./web-sse";
export { toSseRoutes, mountNodeSse } from "./adapters";
