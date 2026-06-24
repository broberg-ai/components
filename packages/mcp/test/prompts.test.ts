import { describe, it, expect } from "vitest";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { definePrompt, registerPrompts } from "../src/prompts";
import type { AnyPromptDef } from "../src/prompts";

const prompts: AnyPromptDef[] = [
  definePrompt({
    name: "greet",
    description: "Greet someone",
    arguments: { who: z.string() },
    load: ({ who }) => `Hello, ${who}!`,
  }),
  definePrompt({
    name: "manifesto",
    description: "A fixed prompt with no arguments",
    load: () => "Build it good enough to build a new server on.",
  }),
];

async function connect() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerPrompts(server, prompts);
  const client = new Client({ name: "c", version: "0.0.0" });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return client;
}

describe("registerPrompts (high-level McpServer, end-to-end)", () => {
  it("lists both prompts over a real client/server link", async () => {
    const client = await connect();
    const { prompts: listed } = await client.listPrompts();
    expect(listed.map((p) => p.name).sort()).toEqual(["greet", "manifesto"]);
  });

  it("renders an argumented prompt's text from load()", async () => {
    const client = await connect();
    const r = await client.getPrompt({ name: "greet", arguments: { who: "Christian" } });
    expect(r.messages[0].role).toBe("user");
    expect((r.messages[0].content as { text: string }).text).toBe("Hello, Christian!");
  });

  it("renders a zero-argument prompt", async () => {
    const client = await connect();
    const r = await client.getPrompt({ name: "manifesto" });
    expect((r.messages[0].content as { text: string }).text).toMatch(/new server/);
  });
});
