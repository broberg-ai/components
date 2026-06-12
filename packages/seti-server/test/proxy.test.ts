import { describe, expect, it, vi } from "vitest";
import { createSetiProxy } from "../src/index";

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init),
  ) as unknown as typeof fetch;
}

describe("createSetiProxy", () => {
  it("proxies /sessions with the bearer token and passes the body through", async () => {
    const f = mockFetch((url, init) => {
      expect(url).toBe("https://cloud.test/api/seti/v1/sessions");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok-1");
      return new Response(JSON.stringify({ edges: [{ edgeId: "e1" }] }), { status: 200 });
    });
    const app = createSetiProxy({ cloudUrl: "https://cloud.test/", token: "tok-1", fetch: f });
    const res = await app.request("/sessions");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ edges: [{ edgeId: "e1" }] });
  });

  it("propagates upstream 401 on /sessions", async () => {
    const f = mockFetch(() => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }));
    const app = createSetiProxy({ cloudUrl: "https://cloud.test", token: "bad", fetch: f });
    const res = await app.request("/sessions");
    expect(res.status).toBe(401);
  });

  it("requires edge + session on /stream", async () => {
    const app = createSetiProxy({ cloudUrl: "https://cloud.test", token: "t", fetch: mockFetch(() => new Response("")) });
    const res = await app.request("/stream?edge=e1");
    expect(res.status).toBe(400);
  });

  it("passes the SSE body through on /stream", async () => {
    const f = mockFetch((url) => {
      expect(url).toBe("https://cloud.test/api/seti/v1/stream?edge=e1&session=cc");
      return new Response("event: hello\ndata: {}\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });
    const app = createSetiProxy({ cloudUrl: "https://cloud.test", token: "t", fetch: f });
    const res = await app.request("/stream?edge=e1&session=cc");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(await res.text()).toContain("event: hello");
  });

  it("forwards /input JSON verbatim and returns the upstream reply", async () => {
    const f = mockFetch((url, init) => {
      expect(url).toBe("https://cloud.test/api/seti/v1/input");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ edge: "e1", session: "cc", text: "hi" });
      return new Response(JSON.stringify({ ok: true, edgeConnected: true }), { status: 200 });
    });
    const app = createSetiProxy({ cloudUrl: "https://cloud.test", token: "t", fetch: f });
    const res = await app.request("/input", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ edge: "e1", session: "cc", text: "hi" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, edgeConnected: true });
  });

  it("returns 502 when the cloud is unreachable", async () => {
    const f = vi.fn(async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    const app = createSetiProxy({ cloudUrl: "https://cloud.test", token: "t", fetch: f });
    const res = await app.request("/sessions");
    expect(res.status).toBe(502);
  });
});
