import { describe, it, expect } from "vitest";
import { z } from "zod";
import { createWebSseMcpHandler } from "../src/web-sse";
import { defineTool } from "../src/tools";

const ping = defineTool({
  name: "ping",
  description: "ping",
  inputSchema: { msg: z.string() },
  handler: ({ msg }) => `pong:${msg}`,
});

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test", version: "0.0.0" },
  },
};

describe("createWebSseMcpHandler", () => {
  it("opens an SSE stream and announces the endpoint with a sessionId", async () => {
    const handler = createWebSseMcpHandler({ name: "t", version: "0.0.0", tools: [ping] });
    const res = await handler.handleSse(new Request("http://x/sse"));

    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const reader = res.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain("event: endpoint");
    expect(first).toMatch(/sessionId=[\w-]+/);

    await reader.cancel();
    handler.close();
  });

  it("routes a POST initialize through the session and replies on the SSE stream", async () => {
    const handler = createWebSseMcpHandler({ name: "t", version: "1.2.3", tools: [ping] });
    const res = await handler.handleSse(new Request("http://x/sse"));
    const reader = res.body!.getReader();
    const dec = new TextDecoder();

    const endpointEvent = dec.decode((await reader.read()).value);
    const sessionId = /sessionId=([\w-]+)/.exec(endpointEvent)![1];

    // The initialize RESPONSE comes back over the SSE stream, not the POST body.
    const postPromise = handler.handleMessage(
      new Request(`http://x/message?sessionId=${sessionId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(initialize),
      }),
    );

    const messageEvent = dec.decode((await reader.read()).value);
    expect(messageEvent).toContain("event: message");
    expect(messageEvent).toContain('"result"');
    expect(messageEvent).toContain('"serverInfo"');

    const postRes = await postPromise;
    expect(postRes.status).toBe(202);

    await reader.cancel();
    handler.close();
  });

  it("404s a POST with an unknown sessionId", async () => {
    const handler = createWebSseMcpHandler({ name: "t", version: "0.0.0", tools: [] });
    const res = await handler.handleMessage(
      new Request("http://x/message?sessionId=nope", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(res.status).toBe(404);
    handler.close();
  });

  it("400s a POST whose body is not valid JSON", async () => {
    const handler = createWebSseMcpHandler({ name: "t", version: "0.0.0", tools: [] });
    const res = await handler.handleSse(new Request("http://x/sse"));
    const reader = res.body!.getReader();
    const sid = /sessionId=([\w-]+)/.exec(new TextDecoder().decode((await reader.read()).value))![1];

    const bad = await handler.handleMessage(
      new Request(`http://x/message?sessionId=${sid}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json",
      }),
    );
    expect(bad.status).toBe(400);

    await reader.cancel();
    handler.close();
  });

  it("401s the SSE GET when authenticate throws", async () => {
    const handler = createWebSseMcpHandler({
      name: "t",
      version: "0.0.0",
      tools: [],
      authenticate: () => {
        throw new Error("nope");
      },
    });
    const res = await handler.handleSse(new Request("http://x/sse"));
    expect(res.status).toBe(401);
    handler.close();
  });
});
