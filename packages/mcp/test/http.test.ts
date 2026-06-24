import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineTool } from "../src/tools";
import { createHttpMcpHandler } from "../src/http";
import type { AnyToolDef } from "../src/types";

const tools: AnyToolDef[] = [
  defineTool({
    name: "echo",
    description: "echo text",
    inputSchema: { text: z.string() },
    handler: ({ text }) => text,
  }),
];

describe("createHttpMcpHandler", () => {
  it("rejects with 401 when authenticate throws", async () => {
    const handler = createHttpMcpHandler({
      name: "t",
      version: "0.0.0",
      tools,
      authenticate: () => {
        throw new Error("bad token");
      },
    });
    const res = await handler(
      new Request("http://x/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.message).toBe("bad token");
  });

  it("handles an initialize roundtrip statelessly (Server + transport wired)", async () => {
    const handler = createHttpMcpHandler({ name: "t", version: "0.0.0", tools });
    const res = await handler(
      new Request("http://x/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "c", version: "0" },
          },
        }),
      }),
    );
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(200);
  });
});
