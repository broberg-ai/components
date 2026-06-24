import { describe, it, expect } from "vitest";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { defineTool } from "../src/tools";
import { registerMcpServerTools } from "../src/register";
import type { AnyToolDef, ToolContext } from "../src/types";

const tools: AnyToolDef[] = [
  defineTool({
    name: "echo",
    description: "echo text",
    inputSchema: { text: z.string() },
    handler: ({ text }) => `you said: ${text}`,
  }),
  defineTool({
    name: "secret",
    description: "needs a scope",
    scopes: ["admin"],
    inputSchema: {},
    handler: () => "ok",
  }),
];

async function connect(getContext?: (extra: unknown) => ToolContext) {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerMcpServerTools(server, tools, { getContext });
  const client = new Client({ name: "c", version: "0.0.0" });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return client;
}

describe("registerMcpServerTools (high-level McpServer, end-to-end)", () => {
  it("lists the registered tools over a real client/server link", async () => {
    const client = await connect();
    const { tools: listed } = await client.listTools();
    expect(listed.map((t) => t.name).sort()).toEqual(["echo", "secret"]);
  });

  it("calls a tool and returns the wrapped text envelope", async () => {
    const client = await connect();
    const r = (await client.callTool({ name: "echo", arguments: { text: "hi" } })) as any;
    expect(r.content[0].text).toBe("you said: hi");
    expect(r.isError).toBeFalsy();
  });

  it("scope-gates through the shared dispatch (missing scope → isError)", async () => {
    const client = await connect(() => ({ principal: { scopes: [] }, ctx: undefined }));
    const r = (await client.callTool({ name: "secret", arguments: {} })) as any;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/scope/);
  });

  it("allows the scoped tool when the principal holds the scope", async () => {
    const client = await connect(() => ({ principal: { scopes: ["admin"] }, ctx: undefined }));
    const r = (await client.callTool({ name: "secret", arguments: {} })) as any;
    expect(r.isError).toBeFalsy();
    expect(r.content[0].text).toBe("ok");
  });
});
