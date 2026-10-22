// F007.17 — the server's own icon and homepage reach the client in `initialize`.
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { defineTool } from "../src/tools";
import { createHttpMcpHandler } from "../src/http";
import { createStdioMcpServer } from "../src/stdio";
import type { AnyToolDef } from "../src/types";

const tools: AnyToolDef[] = [defineTool({ name: "echo", description: "echo", inputSchema: { msg: z.string() }, handler: ({ msg }) => msg })];
const icons = [{ src: "https://jam.example/apple-touch-icon.png", mimeType: "image/png", sizes: ["180x180"] }];
const websiteUrl = "https://jam.example";

async function httpServerInfo(extra: object) {
  const handler = createHttpMcpHandler({ name: "jam", version: "1.2.3", tools, ...extra });
  const res = await handler(
    new Request("http://x/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "c", version: "0" } } }),
    }),
  );
  const msg = (await res.text()).split("\n").filter((l) => l.startsWith("data:")).map((l) => JSON.parse(l.slice(5).trim())).find((m) => m.id === 1);
  return msg?.result?.serverInfo;
}

async function stdioServerInfo(extra: object) {
  const { server } = createStdioMcpServer({ name: "jam", version: "1.2.3", tools, ...extra });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "c", version: "0" });
  await client.connect(b);
  const info = client.getServerVersion();
  await client.close();
  return info;
}

describe("serverInfo icons + websiteUrl", () => {
  it("HTTP + stdio: initialize carries the icons exactly as given", async () => {
    expect(await httpServerInfo({ icons })).toEqual({ name: "jam", version: "1.2.3", icons });
    expect(await stdioServerInfo({ icons })).toEqual({ name: "jam", version: "1.2.3", icons });
  });

  it("HTTP + stdio: initialize carries the websiteUrl exactly as given", async () => {
    expect(await httpServerInfo({ websiteUrl })).toEqual({ name: "jam", version: "1.2.3", websiteUrl });
    expect(await stdioServerInfo({ websiteUrl })).toEqual({ name: "jam", version: "1.2.3", websiteUrl });
  });

  it("both together", async () => {
    expect(await httpServerInfo({ icons, websiteUrl })).toEqual({ name: "jam", version: "1.2.3", icons, websiteUrl });
  });

  it("without them serverInfo is exactly { name, version } (unchanged from 0.9.1)", async () => {
    expect(await httpServerInfo({})).toEqual({ name: "jam", version: "1.2.3" });
    expect(await stdioServerInfo({})).toEqual({ name: "jam", version: "1.2.3" });
  });
});
