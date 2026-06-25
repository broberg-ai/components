import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { defineTool, dispatchTool, toToolListEntry, ToolNotFoundError } from "../src/tools";
import type { AnyToolDef, Principal, ToolContext } from "../src/types";

const echo = defineTool({
  name: "echo",
  description: "echo text",
  kind: "read",
  inputSchema: { text: z.string() },
  handler: (input) => input.text,
});

const save = defineTool({
  name: "save",
  description: "save a doc",
  kind: "write",
  scopes: ["docs:write"],
  inputSchema: { id: z.string() },
  handler: () => "saved",
});

const tools: AnyToolDef[] = [echo, save];

function ctx(p: Partial<Principal> = {}): ToolContext {
  return { principal: { ...p }, ctx: undefined };
}

describe("dispatchTool", () => {
  it("runs a tool and wraps a string into the text envelope", async () => {
    const r = await dispatchTool(tools, "echo", { text: "hi" }, ctx());
    expect(r).toEqual({ content: [{ type: "text", text: "hi" }] });
  });

  it("throws ToolNotFoundError for an unknown tool", async () => {
    await expect(dispatchTool(tools, "nope", {}, ctx())).rejects.toBeInstanceOf(ToolNotFoundError);
  });

  it("write-guards a read-only principal", async () => {
    const r = await dispatchTool(tools, "save", { id: "x" }, ctx({ readOnly: true, scopes: ["docs:write"] }));
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toMatch(/read-only/);
  });

  it("scope-gates when a required scope is missing", async () => {
    const r = await dispatchTool(tools, "save", { id: "x" }, ctx({ scopes: [] }));
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toMatch(/scope/);
  });

  it("allows a write tool with write access + the required scope", async () => {
    const r = await dispatchTool(tools, "save", { id: "x" }, ctx({ scopes: ["docs:write"] }));
    expect(r).toEqual({ content: [{ type: "text", text: "saved" }] });
  });

  it("returns an isError envelope on invalid args (no throw)", async () => {
    const r = await dispatchTool(tools, "echo", { text: 123 }, ctx());
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toMatch(/Invalid arguments/);
  });

  it("catches a handler throw into an isError envelope", async () => {
    const boom: AnyToolDef[] = [
      defineTool({ name: "boom", description: "", inputSchema: {}, handler: () => { throw new Error("kaboom"); } }),
    ];
    const r = await dispatchTool(boom, "boom", {}, ctx());
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toBe("kaboom");
  });

  it("fires the audit hook with the cms-shaped entry", async () => {
    const audit = vi.fn();
    await dispatchTool(tools, "echo", { text: "hi" }, ctx({ userId: "u1" }), { audit });
    expect(audit).toHaveBeenCalledOnce();
    expect(audit.mock.calls[0][0]).toMatchObject({ tool: "echo", actor: "u1", result: "success" });
    expect(audit.mock.calls[0][0].timestamp).toBeTypeOf("string");
  });
});

describe("toToolListEntry", () => {
  it("converts a raw Zod shape to a JSON Schema object", () => {
    const e = toToolListEntry(echo);
    expect(e.name).toBe("echo");
    expect((e.inputSchema as any).type).toBe("object");
    expect((e.inputSchema as any).properties.text).toBeDefined();
  });
});
