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

  it("forwards a GET lsd passthrough with query + bearer and returns the upstream body", async () => {
    const f = mockFetch((url, init) => {
      expect(url).toBe("https://cloud.test/api/seti/v1/lsd/view?edge=e1&session=cc");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer t");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const app = createSetiProxy({ cloudUrl: "https://cloud.test", token: "t", fetch: f });
    const res = await app.request("/lsd/view?edge=e1&session=cc");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("passes upstream status codes through untouched on lsd routes (404 = edge offline)", async () => {
    const f = mockFetch(() => new Response(JSON.stringify({ error: "edge_offline" }), { status: 404 }));
    const app = createSetiProxy({ cloudUrl: "https://cloud.test", token: "t", fetch: f });
    expect((await app.request("/lsd/info?edge=e1")).status).toBe(404);
  });

  it("forwards a POST lsd/rules body verbatim", async () => {
    const f = mockFetch((url, init) => {
      expect(url).toBe("https://cloud.test/api/seti/v1/lsd/rules");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ pattern: "x", severity: "warn" });
      return new Response(JSON.stringify({ id: 7 }), { status: 201 });
    });
    const app = createSetiProxy({ cloudUrl: "https://cloud.test", token: "t", fetch: f });
    const res = await app.request("/lsd/rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pattern: "x", severity: "warn" }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 7 });
  });

  it("forwards DELETE lsd/rules/:id with the id in the upstream path (null-body 204)", async () => {
    const f = mockFetch((url, init) => {
      expect(url).toBe("https://cloud.test/api/seti/v1/lsd/rules/42");
      expect(init?.method).toBe("DELETE");
      return new Response(null, { status: 204 });
    });
    const app = createSetiProxy({ cloudUrl: "https://cloud.test", token: "t", fetch: f });
    expect((await app.request("/lsd/rules/42", { method: "DELETE" })).status).toBe(204);
  });

  it("forwards PATCH lsd/turn body verbatim", async () => {
    const f = mockFetch((url, init) => {
      expect(url).toBe("https://cloud.test/api/seti/v1/lsd/turn");
      expect(init?.method).toBe("PATCH");
      expect(JSON.parse(String(init?.body))).toEqual({ index: 3, pinned: true });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const app = createSetiProxy({ cloudUrl: "https://cloud.test", token: "t", fetch: f });
    expect((await app.request("/lsd/turn", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ index: 3, pinned: true }),
    })).status).toBe(200);
  });

  it("forwards GET lsd/notifications with the sinceMs query", async () => {
    const f = mockFetch((url, init) => {
      expect(url).toBe("https://cloud.test/api/seti/v1/lsd/notifications?sinceMs=1700");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer t");
      return new Response(JSON.stringify({ notifications: [] }), { status: 200 });
    });
    const app = createSetiProxy({ cloudUrl: "https://cloud.test", token: "t", fetch: f });
    const res = await app.request("/lsd/notifications?sinceMs=1700");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ notifications: [] });
  });

  it("forwards GET lsd/decisions (the fleet-decisions badge feed)", async () => {
    const f = mockFetch((url, init) => {
      expect(url).toBe("https://cloud.test/api/seti/v1/lsd/decisions");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer t");
      return new Response(JSON.stringify({ count: 2, decisions: [] }), { status: 200 });
    });
    const app = createSetiProxy({ cloudUrl: "https://cloud.test", token: "t", fetch: f });
    const res = await app.request("/lsd/decisions");
    expect(res.status).toBe(200);
    expect((await res.json()).count).toBe(2);
  });

  it("forwards GET /resolve with the session query + bearer (session→edge resolver)", async () => {
    const f = mockFetch((url, init) => {
      expect(url).toBe("https://cloud.test/api/seti/v1/resolve?session=broberg-ai-site");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer t");
      return new Response(
        JSON.stringify({ ok: true, edge: "fly-arn-1", ccSessionId: "abc", cwd: "/data", candidates: 1 }),
        { status: 200 },
      );
    });
    const app = createSetiProxy({ cloudUrl: "https://cloud.test", token: "t", fetch: f });
    const res = await app.request("/resolve?session=broberg-ai-site");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.edge).toBe("fly-arn-1");
    expect(body.candidates).toBe(1);
  });

  it("forwards POST lsd/rules/:id/action with the id in the path + body verbatim", async () => {
    const f = mockFetch((url, init) => {
      expect(url).toBe("https://cloud.test/api/seti/v1/lsd/rules/9/action");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ edge: "e1", session: "cc", action: "nudge" });
      return new Response(JSON.stringify({ ok: true, detail: "re-nudged" }), { status: 200 });
    });
    const app = createSetiProxy({ cloudUrl: "https://cloud.test", token: "t", fetch: f });
    const res = await app.request("/lsd/rules/9/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ edge: "e1", session: "cc", action: "nudge" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, detail: "re-nudged" });
  });

  it("forwards POST lsd/decision/answer body verbatim + passes upstream status (400 = bad choice)", async () => {
    const f = mockFetch((url, init) => {
      expect(url).toBe("https://cloud.test/api/seti/v1/lsd/decision/answer");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        edge: "e1",
        session: "cc",
        decisionId: "d7",
        choiceIndices: [0, 2],
        comment: "go",
      });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const app = createSetiProxy({ cloudUrl: "https://cloud.test", token: "t", fetch: f });
    const res = await app.request("/lsd/decision/answer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ edge: "e1", session: "cc", decisionId: "d7", choiceIndices: [0, 2], comment: "go" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("pipes the lsd/stream SSE through with the query forwarded + abort signal", async () => {
    const f = mockFetch((url, init) => {
      expect(url).toBe("https://cloud.test/api/seti/v1/lsd/stream?view=v1");
      expect(init?.signal).toBeDefined();
      return new Response("event: reset\ndata: {}\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });
    const app = createSetiProxy({ cloudUrl: "https://cloud.test", token: "t", fetch: f });
    const res = await app.request("/lsd/stream?view=v1");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(await res.text()).toContain("event: reset");
  });
});
