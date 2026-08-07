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

/**
 * Thrown when a non-empty input shape converts to a JSON Schema with no
 * properties. Without this, such a tool reaches the MCP client declaring NO
 * inputs: the model then guesses arguments and nothing validates them, while
 * the server starts, the tool lists and the call "succeeds". A guard that
 * cannot fire looks exactly like a guard that passes — so we fail loudly
 * instead. (Reported by beacon: `zod-to-json-schema@3` returns an empty
 * envelope, without throwing, for a Zod 4 object.)
 */
export class EmptyInputSchemaError extends Error {
  constructor(public readonly toolName: string) {
    super(
      `Tool "${toolName}": input shape is non-empty but converted to a JSON Schema ` +
        `with no properties. This usually means the installed zod major version is ` +
        `not supported by the converter. Pass \`inputJsonSchema\` on the tool def to ` +
        `bypass conversion, or align the zod version.`,
    );
    this.name = "EmptyInputSchemaError";
  }
}

/**
 * Convert a raw Zod shape to JSON Schema, supporting both zod majors.
 *
 * Zod 4 emits draft-2020-12 itself via `z.toJSONSchema()` — exactly what MCP
 * wants. Zod 3 has no such method, so we keep `zod-to-json-schema` for it.
 * `zod-to-json-schema@3` cannot read Zod 4's internal form and returns an empty
 * envelope *without throwing*, which is the silent failure the guard below
 * exists to make impossible.
 */
function toInputJsonSchema(shape: RawShape, toolName: string): Record<string, unknown> {
  const obj = z.object(shape);
  const zAny = z as unknown as { toJSONSchema?: (s: unknown) => Record<string, unknown> };

  const schema =
    typeof zAny.toJSONSchema === "function"
      ? zAny.toJSONSchema(obj)
      : (zodToJsonSchema(obj, { $refStrategy: "none" }) as Record<string, unknown>);

  // An empty shape legitimately yields no properties (a tool taking no args).
  // A NON-empty shape that yields none is always a conversion failure.
  const props = schema?.properties as Record<string, unknown> | undefined;
  if (Object.keys(shape).length > 0 && (!props || Object.keys(props).length === 0)) {
    throw new EmptyInputSchemaError(toolName);
  }
  return schema;
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
    inputSchema: tool.inputJsonSchema ?? toInputJsonSchema(tool.inputSchema, tool.name),
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
