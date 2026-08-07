import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineTool, toToolListEntry, EmptyInputSchemaError } from "../../src/tools";

/**
 * Runs ONLY under vitest.zod4.config.ts, where `zod` is aliased to zod 4.
 * Guards F007.12 — reported by beacon (#18984): with zod 4 installed,
 * `zodToJsonSchema` returned `{"$schema":"…"}` and nothing else, WITHOUT
 * throwing, so tools reached the MCP client declaring no inputs at all.
 */
describe("tools under zod 4", () => {
  it("is actually running against zod 4", () => {
    // If this fails the alias broke and every assertion below is meaningless.
    expect(typeof (z as unknown as { toJSONSchema?: unknown }).toJSONSchema).toBe("function");
  });

  it("converts a zod 4 shape to a populated JSON Schema", () => {
    const tool = defineTool({
      name: "search",
      description: "search things",
      inputSchema: { query: z.string().min(1), on: z.boolean().optional() },
      handler: async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
    });

    const entry = toToolListEntry(tool);

    expect(entry.inputSchema.type).toBe("object");
    const props = entry.inputSchema.properties as Record<string, unknown>;
    expect(Object.keys(props).sort()).toEqual(["on", "query"]);
    expect(entry.inputSchema.required).toEqual(["query"]);
    // the min(1) constraint survives the conversion
    expect((props.query as Record<string, unknown>).minLength).toBe(1);
  });

  it("still allows a genuinely argument-less tool", () => {
    const tool = defineTool({
      name: "ping",
      description: "no args",
      inputSchema: {},
      handler: async () => ({ content: [{ type: "text" as const, text: "pong" }] }),
    });

    expect(() => toToolListEntry(tool)).not.toThrow();
  });

  it("honours inputJsonSchema verbatim, skipping conversion", () => {
    const supplied = { type: "object", properties: { a: { type: "string" } }, required: ["a"] };
    const entry = toToolListEntry({
      name: "raw",
      description: "pre-built schema",
      inputSchema: { a: z.string() },
      inputJsonSchema: supplied,
      handler: async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
    });

    expect(entry.inputSchema).toEqual(supplied);
  });

  it("EmptyInputSchemaError is exported and carries the tool name", () => {
    const err = new EmptyInputSchemaError("broken");
    expect(err).toBeInstanceOf(Error);
    expect(err.toolName).toBe("broken");
    expect(err.name).toBe("EmptyInputSchemaError");
  });
});
