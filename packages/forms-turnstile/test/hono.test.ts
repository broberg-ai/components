import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { _resetRateLimiter } from "../src/server";
import { honoTurnstileMiddleware } from "../src/hono";

afterEach(() => {
  _resetRateLimiter();
  vi.unstubAllGlobals();
});

function appWith(opts: Parameters<typeof honoTurnstileMiddleware>[0]) {
  const app = new Hono<{ Variables: { spamCheckedBody: Record<string, unknown> } }>();
  app.post("/api/contact", honoTurnstileMiddleware(opts), (c) => c.json({ ok: true, body: c.get("spamCheckedBody") }));
  return app;
}

describe("honoTurnstileMiddleware", () => {
  it("passes through + stashes the parsed body when turnstile verifies", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ success: true }) }));
    const app = appWith({ secret: "secret", formName: "contact" });
    const res = await app.request("/api/contact", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "tok", name: "Christian" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).body).toEqual({ token: "tok", name: "Christian" });
  });

  it("400s when turnstile verification fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ success: false }) }));
    const app = appWith({ secret: "secret", formName: "contact" });
    const res = await app.request("/api/contact", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "bad" }),
    });
    expect(res.status).toBe(400);
  });

  it("400s on honeypot without ever calling fetch (short-circuit)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const app = appWith({ secret: "secret", formName: "contact" });
    const res = await app.request("/api/contact", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "tok", _hp_email: "bot@bot.com" }),
    });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips the honeypot layer when honeypot:false", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ success: true }) }));
    const app = appWith({ secret: "secret", formName: "contact", honeypot: false });
    const res = await app.request("/api/contact", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "tok", _hp_email: "not-actually-checked" }),
    });
    expect(res.status).toBe(200);
  });

  it("enforces maxPerHour when provided, reading the IP from ipHeader", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ success: true }) }));
    const app = appWith({ secret: "secret", formName: "contact", maxPerHour: 1, ipHeader: "CF-Connecting-IP" });
    const req = () =>
      app.request("/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json", "CF-Connecting-IP": "1.2.3.4" },
        body: JSON.stringify({ token: "tok" }),
      });
    expect((await req()).status).toBe(200); // 1st — within limit
    expect((await req()).status).toBe(400); // 2nd — rate-limited
  });

  it("supports a custom onBlocked response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ success: false }) }));
    const app = appWith({
      secret: "secret",
      formName: "contact",
      onBlocked: (c, reason) => c.json({ error: `blocked:${reason}` }, 418),
    });
    const res = await app.request("/api/contact", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "bad" }),
    });
    expect(res.status).toBe(418);
    expect((await res.json()).error).toBe("blocked:turnstile");
  });
});
