import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type {
  AnyToolDef,
  HandlerReturn,
  Principal,
  RawShape,
  ToolContext,
  ToolDef,
  ToolResult,
} from "./types";
import type { AuditFn } from "./audit";

/**
 * Identity helper that preserves the tool's input type at the call site
 * (so `handler(input)` is typed from `inputSchema`), while collections of
 * tools are held as {@link AnyToolDef}.
 */
export function defineTool<Shape extends RawShape, Ctx = unknown>(
  def: ToolDef<Shape, Ctx>,
): ToolDef<Shape, Ctx> {
  return def;
}

/**
 * Build a tool result that returns an image INLINE — `data` is raw base64 (no
 * `data:` prefix). An MCP client (Claude/ChatGPT) renders it directly instead of
 * showing a link. e.g. `return imageResult(webpBase64, "image/webp")`.
 */
export function imageResult(data: string, mimeType: string): ToolResult {
  return { content: [{ type: "image", data, mimeType }] };
}

/** Low-level ListTools entry — the raw shape converted to JSON Schema. */
export function toToolListEntry(tool: AnyToolDef<any>): {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
} {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: zodToJsonSchema(z.object(tool.inputSchema), {
      $refStrategy: "none",
    }) as Record<string, unknown>,
  };
}

export class ToolNotFoundError extends Error {
  constructor(public readonly toolName: string) {
    super(`Unknown tool: ${toolName}`);
    this.name = "ToolNotFoundError";
  }
}

export interface DispatchOptions {
  audit?: AuditFn;
}

/**
 * The shared, PURE tool dispatch — find → write-guard → scope-gate → validate →
 * handle → envelope → audit. No SDK dependency, so it is unit-testable on its
 * own and is reused verbatim by both the low-level `Server` backend and the
 * high-level `McpServer` backend.
 *
 * Returns a uniform `{ content, isError? }` envelope. Throws only
 * {@link ToolNotFoundError} (the transports map that to an MCP error); every
 * other failure (auth, validation, handler throw) becomes an `isError` result.
 */
export async function dispatchTool<Ctx = unknown>(
  tools: AnyToolDef<Ctx>[],
  name: string,
  args: unknown,
  context: ToolContext<Ctx>,
  opts: DispatchOptions = {},
): Promise<ToolResult> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new ToolNotFoundError(name);

  const { principal } = context;
  const actor = actorOf(principal);
  const kind = tool.kind ?? "read";

  // write-guard: a read-only principal cannot call a write tool
  if (kind === "write" && principal.readOnly) {
    await safeAudit(opts.audit, { tool: name, actor, result: "error", error: "read-only" });
    return errorResult(`Tool '${name}' requires write access, but this token is read-only.`);
  }

  // scope-gate: AND across the tool's required scopes
  if (tool.scopes && tool.scopes.length > 0) {
    const held = principal.scopes ?? [];
    const missing = tool.scopes.filter((s) => !held.includes(s));
    if (missing.length > 0) {
      await safeAudit(opts.audit, { tool: name, actor, result: "error", error: `missing-scope:${missing.join(",")}` });
      return errorResult(`Tool '${name}' requires scope(s): ${missing.join(", ")}.`);
    }
  }

  // validate args against the raw shape — a Zod miss is an isError, not a throw
  const parsed = z.object(tool.inputSchema).safeParse(args ?? {});
  if (!parsed.success) {
    await safeAudit(opts.audit, { tool: name, actor, result: "error", error: "invalid-args" });
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return errorResult(`Invalid arguments for '${name}': ${detail}`);
  }

  // handle + envelope + audit
  try {
    const ret = await tool.handler(parsed.data, context);
    const res = normalizeResult(ret);
    await safeAudit(opts.audit, { tool: name, actor, result: res.isError ? "error" : "success" });
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await safeAudit(opts.audit, { tool: name, actor, result: "error", error: message });
    return errorResult(message);
  }
}

function normalizeResult(ret: HandlerReturn): ToolResult {
  return typeof ret === "string" ? { content: [{ type: "text", text: ret }] } : ret;
}

function errorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function actorOf(p: Principal): string {
  return p.userId ?? (p.orgId ? `org:${p.orgId}` : "anonymous");
}

async function safeAudit(
  audit: AuditFn | undefined,
  entry: { tool: string; actor: string; result: "success" | "error"; error?: string; documentRef?: string },
): Promise<void> {
  if (!audit) return;
  try {
    await audit({ timestamp: new Date().toISOString(), ...entry });
  } catch {
    /* audit is fire-and-forget — never break a tool call */
  }
}
