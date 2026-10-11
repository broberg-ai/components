import { describe, expect, it } from "vitest";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { defineTool } from "../src/tools";
import { registerMcpServerTools, registerTools } from "../src/register";
import type { AnyToolDef } from "../src/types";

/**
 * F007.15 — tools/list says whether a tool only reads (field #2880). Scout
 * attaches only tools with annotations.readOnlyHint === true, so without this
 * every app on the package looked like it had none. Measured through a real
 * client/server link on BOTH registration paths.
 */
const tools: AnyToolDef[] = [
  defineTool({ name: "plain_read", description: "default kind", inputSchema: {}, handler: () => "r" }),
  defineTool({ name: "explicit_read", description: "kind read + extra hints", kind: "read", annotations: { title: "Læs", idempotentHint: true }, inputSchema: {}, handler: () => "r" }),
  defineTool({ name: "a_write", description: "kind write", kind: "write", annotations: { destructiveHint: true }, inputSchema: {}, handler: () => "w" }),
  // A write tool trying to pass itself off as read-only must not succeed.
  defineTool({ name: "sneaky_write", description: "lies", kind: "write", annotations: { readOnlyHint: true } as never, inputSchema: {}, handler: () => "w" }),
];

const expected = {
  plain_read: { readOnlyHint: true },
  explicit_read: { title: "Læs", idempotentHint: true, readOnlyHint: true },
  a_write: { destructiveHint: true, readOnlyHint: false },
  sneaky_write: { readOnlyHint: false },
};

async function listVia(register: "low" | "high") {
  const client = new Client({ name: "c", version: "0" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  if (register === "low") {
    const server = new Server({ name: "s", version: "0" }, { capabilities: { tools: {} } });
    registerTools(server, tools, { getContext: () => ({ principal: { readOnly: false, scopes: [] }, ctx: undefined }) });
    await Promise.all([server.connect(st), client.connect(ct)]);
  } else {
    const server = new McpServer({ name: "s", version: "0" });
    registerMcpServerTools(server, tools, { getContext: () => ({ principal: { readOnly: false, scopes: [] }, ctx: undefined }) });
    await Promise.all([server.connect(st), client.connect(ct)]);
  }
  const { tools: listed } = await client.listTools();
  return Object.fromEntries(listed.map((t) => [t.name, t.annotations]));
}

describe("F007.15 — tools/list carries readOnlyHint derived from kind", () => {
  it("low-level Server path", async () => {
    expect(await listVia("low")).toEqual(expected);
  });
  it("high-level McpServer path", async () => {
    expect(await listVia("high")).toEqual(expected);
  });
});
