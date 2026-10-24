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
vi.mock("zod", async (importOriginal) => {
  const real = await importOriginal<typeof import("zod")>();
  return { ...real, z: { ...real.z, toJSONSchema: () => ({ $schema: "https://json-schema.org/draft/2020-12/schema" }) } };
});

const { toToolListEntry, EmptyInputSchemaError } = await import("../src/tools");

// F082.8 — zod 4 only now: the converter is z.toJSONSchema, stubbed above to the empty envelope.
describe("empty-schema guard", () => {
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
