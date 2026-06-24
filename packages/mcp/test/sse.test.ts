import { describe, it, expect, vi } from "vitest";
import { createSseMcpHandler } from "../src/sse";

describe("createSseMcpHandler", () => {
  it("404s a POST with an unknown sessionId", async () => {
    const handler = createSseMcpHandler({ name: "t", version: "0.0.0", tools: [] });
    const end = vi.fn();
    const writeHead = vi.fn().mockReturnValue({ end });
    const res = { writeHead, end } as any;
    const req = { url: "/message?sessionId=nope", method: "POST" } as any;

    await handler.handleMessage(req, res);

    expect(writeHead).toHaveBeenCalledWith(404, expect.objectContaining({ "content-type": "application/json" }));
    handler.close();
  });

  it("exposes a TTL-swept registry and a close()", () => {
    const handler = createSseMcpHandler({ name: "t", version: "0.0.0", tools: [], ttlMs: 100 });
    expect(handler.registry.size).toBe(0);
    expect(typeof handler.close).toBe("function");
    handler.close();
  });
});
