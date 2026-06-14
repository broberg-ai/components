import { describe, expect, it, vi } from "vitest";
import { SetiClient } from "../src/client";

function sseResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("SetiClient", () => {
  it("listSessions hits {base}/sessions with the bearer header", async () => {
    const f = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://host.test/api/seti/sessions");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer t1");
      return new Response(JSON.stringify({ edges: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    const c = new SetiClient({ baseUrl: "https://host.test/api/seti/", token: "t1", fetch: f });
    expect(await c.listSessions()).toEqual({ edges: [] });
  });

  it("sendText posts {edge, session, text} and maps the result", async () => {
    const f = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe("/api/seti/input");
      expect(JSON.parse(String(init?.body))).toEqual({ edge: "e1", session: "cc", text: "hej" });
      return new Response(JSON.stringify({ ok: true, edgeConnected: true }), { status: 200 });
    }) as unknown as typeof fetch;
    const c = new SetiClient({ baseUrl: "/api/seti", fetch: f });
    const res = await c.sendText("e1", "cc", "hej");
    expect(res).toEqual({ ok: true, edgeConnected: true, error: undefined });
  });

  it("sendText includes origin in the body when given, omits it otherwise", async () => {
    const bodies: unknown[] = [];
    const f = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ ok: true, edgeConnected: true }), { status: 200 });
    }) as unknown as typeof fetch;
    const c = new SetiClient({ baseUrl: "/api/seti", fetch: f });
    await c.sendText("e1", "cc", "hej", { origin: "lsd-rule" });
    await c.sendText("e1", "cc", "no-origin");
    expect(bodies[0]).toEqual({ edge: "e1", session: "cc", text: "hej", origin: "lsd-rule" });
    expect(bodies[1]).toEqual({ edge: "e1", session: "cc", text: "no-origin" });
  });

  it("aborts /input on the configured timeout (false-not-sent guard is configurable)", async () => {
    // fetch that never resolves on its own — only the AbortSignal ends it.
    const f = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          (init?.signal as AbortSignal | undefined)?.addEventListener("abort", () =>
            reject(new DOMException("The operation timed out.", "TimeoutError")),
          );
        }),
    ) as unknown as typeof fetch;
    const c = new SetiClient({ baseUrl: "/api/seti", fetch: f, inputTimeoutMs: 10 });
    const res = await c.sendText("e1", "cc", "slow edge");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/timed out/i);
  });

  it("a per-call timeoutMs overrides the client default", async () => {
    const f = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          (init?.signal as AbortSignal | undefined)?.addEventListener("abort", () =>
            reject(new DOMException("The operation timed out.", "TimeoutError")),
          );
        }),
    ) as unknown as typeof fetch;
    // Generous client default, but this call pins a tiny budget → aborts fast.
    const c = new SetiClient({ baseUrl: "/api/seti", fetch: f, inputTimeoutMs: 30_000 });
    const res = await c.sendText("e1", "cc", "slow", { timeoutMs: 10 });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/timed out/i);
  });

  it("sendKey posts {edge, session, key}", async () => {
    const f = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ edge: "e1", session: "cc", key: "Escape" });
      return new Response(JSON.stringify({ ok: true, edgeConnected: true }), { status: 200 });
    }) as unknown as typeof fetch;
    const c = new SetiClient({ baseUrl: "/api/seti", fetch: f });
    expect((await c.sendKey("e1", "cc", "Escape")).ok).toBe(true);
  });

  it("sendText reports failure without throwing when fetch rejects", async () => {
    const f = vi.fn(async () => {
      throw new Error("net down");
    }) as unknown as typeof fetch;
    const c = new SetiClient({ baseUrl: "/api/seti", fetch: f });
    const res = await c.sendText("e1", "cc", "hej");
    expect(res.ok).toBe(false);
    expect(res.error).toBe("net down");
  });

  it("openStream parses hello/frame/ping events and closes cleanly", async () => {
    const events: string[] = [];
    const frames: string[] = [];
    let closeStream: (() => void) | null = null;
    const f = vi.fn(async () =>
      sseResponse([
        'event: hello\ndata: {"edge":"e1","session":"cc","edgeConnected":true}\n\n',
        'event: frame\ndata: {"content":"line A\\nline B"}\n\n',
        'event: ping\ndata: {"edgeConnected":true}\n\n',
      ]),
    ) as unknown as typeof fetch;
    const c = new SetiClient({ baseUrl: "/api/seti", fetch: f });
    await new Promise<void>((resolve) => {
      const handle = c.openStream("e1", "cc", {
        onHello: (h) => events.push(`hello:${h.edgeConnected}`),
        onPing: () => {
          events.push("ping");
          handle.close();
          resolve();
        },
        onFrame: (content) => frames.push(content),
      });
      closeStream = handle.close;
    });
    closeStream;
    expect(events).toEqual(["hello:true", "ping"]);
    expect(frames).toEqual(["line A\nline B"]);
  });
});
