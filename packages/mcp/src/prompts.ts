import type { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";
import type { RawShape } from "./types";

/**
 * A prompt definition — the skills→prompts pattern (cardmem's, the only estate
 * consumer): named arguments validated by the SDK, then `load` builds the text.
 * Return a plain string for the common single-user-message case, or a full
 * `GetPromptResult` for multi-message / non-text prompts.
 */
export interface PromptDef<Shape extends RawShape = RawShape> {
  name: string;
  description?: string;
  /** Optional named arguments (raw Zod shape); the SDK validates them before `load`. */
  arguments?: Shape;
  load: (
    args: z.infer<z.ZodObject<Shape>>,
  ) => string | GetPromptResult | Promise<string | GetPromptResult>;
}

/** The erased prompt type the registry operates over (handler input widened). */
export interface AnyPromptDef {
  name: string;
  description?: string;
  arguments?: RawShape;
  load: (args: any) => string | GetPromptResult | Promise<string | GetPromptResult>;
}

/** Identity helper that preserves the argument type at the call site. */
export function definePrompt<Shape extends RawShape>(def: PromptDef<Shape>): PromptDef<Shape> {
  return def;
}

/**
 * Register prompts on a high-level `McpServer` (e.g. the one from
 * {@link import("./stdio").createStdioMcpServer}). A `string` from `load` is
 * wrapped into a single user text message; a `GetPromptResult` passes through.
 */
export function registerPrompts(server: McpServer, prompts: AnyPromptDef[]): void {
  for (const p of prompts) {
    const run = async (args: unknown): Promise<GetPromptResult> => {
      const out = await p.load(args as never);
      return typeof out === "string"
        ? { messages: [{ role: "user", content: { type: "text", text: out } }] }
        : out;
    };
    if (p.arguments) {
      server.prompt(p.name, p.description ?? p.name, p.arguments, ((args: unknown) => run(args)) as never);
    } else {
      server.prompt(p.name, p.description ?? p.name, (() => run({})) as never);
    }
  }
}
