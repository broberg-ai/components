import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

/**
 * F007.12 — the empty-schema guard.
 *
 * The converter is stubbed to return the exact empty envelope beacon observed
 * (`{"$schema":"…"}`) so the guard is tested against the real failure shape,
 * on any zod version. This is the case that used to sail through silently:
 * a tool reaching the MCP client declaring no inputs at all.
 */
vi.mock("zod-to-json-schema", () => ({
  zodToJsonSchema: () => ({ $schema: "http://json-schema.org/draft-07/schema#" }),
}));

const { toToolListEntry, EmptyInputSchemaError } = await import("../src/tools");

// The guard only reaches the stubbed converter on the zod 3 branch; zod 4 has
// its own working z.toJSONSchema. This suite runs under the default (zod 3) config.
const onZod3 = typeof (z as unknown as { toJSONSchema?: unknown }).toJSONSchema !== "function";

describe.runIf(onZod3)("empty-schema guard", () => {
  const base = {
    name: "search",
    description: "search things",
    handler: async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
  };

  it("throws when a non-empty shape converts to a schema with no properties", () => {
    expect(() => toToolListEntry({ ...base, inputSchema: { query: z.string() } })).toThrow(
      EmptyInputSchemaError,
    );
  });

  it("names the offending tool in the error", () => {
    try {
      toToolListEntry({ ...base, inputSchema: { query: z.string() } });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as InstanceType<typeof EmptyInputSchemaError>).toolName).toBe("search");
    }
  });

  it("does NOT throw for a genuinely argument-less tool", () => {
    expect(() => toToolListEntry({ ...base, name: "ping", inputSchema: {} })).not.toThrow();
  });

  it("does NOT throw when inputJsonSchema bypasses conversion", () => {
    const supplied = { type: "object", properties: { a: { type: "string" } } };
    const entry = toToolListEntry({
      ...base,
      inputSchema: { a: z.string() },
      inputJsonSchema: supplied,
    });
    expect(entry.inputSchema).toEqual(supplied);
  });
});
