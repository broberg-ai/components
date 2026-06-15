import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { SlidingWindowRateLimiter } from "../src/index";
import { honoApiKeyMiddleware, honoRateLimit } from "../src/hono";
import { withApiKeyAuth, nextRateLimit } from "../src/next";

type Rec = { id: string; tenant: string };
const KEYS: Record<string, Rec> = { "trail_good": { id: "k1", tenant: "club-a" } };
const lookup = (presented: string): Rec | null => KEYS[presented] ?? null;

describe("hono adapter — apiKey middleware", () => {
  const app = new Hono<{ Variables: { apiKey: Rec } }>();
  app.use("/api/*", honoApiKeyMiddleware({ lookup }));
  app.get("/api/me", (c) => c.json({ rec: c.get("apiKey") }));

  it("401 when no key", async () => {
    expect((await app.request("/api/me")).status).toBe(401);
  });
  it("401 on an unknown key", async () => {
    expect((await app.request("/api/me", { headers: { Authorization: "Bearer nope" } })).status).toBe(401);
  });
  it("passes a valid Bearer key and stashes the record", async () => {
    const res = await app.request("/api/me", { headers: { Authorization: "Bearer trail_good" } });
    expect(res.status).toBe(200);
    expect((await res.json()).rec.id).toBe("k1");
  });
  it("accepts x-api-key as the fallback header", async () => {
    const res = await app.request("/api/me", { headers: { "x-api-key": "trail_good" } });
    expect(res.status).toBe(200);
  });
});

describe("hono adapter — authorize hook → 403", () => {
  const app = new Hono();
  app.use("/admin/*", honoApiKeyMiddleware<Rec>({ lookup, authorize: (rec) => rec.tenant === "club-z" }));
  app.get("/admin/x", (c) => c.json({ ok: true }));

  it("403 when authorize rejects", async () => {
    const res = await app.request("/admin/x", { headers: { Authorization: "Bearer trail_good" } });
    expect(res.status).toBe(403);
  });
});

describe("hono adapter — rate limit", () => {
  it("429 + Retry-After once over the limit", async () => {
    const limiter = new SlidingWindowRateLimiter({ windowMs: 60_000, max: 2 });
    const app = new Hono();
    app.use("/r/*", honoRateLimit(limiter, () => "fixed-key"));
    app.get("/r/x", (c) => c.json({ ok: true }));

    expect((await app.request("/r/x")).status).toBe(200);
    expect((await app.request("/r/x")).status).toBe(200);
    const over = await app.request("/r/x");
    expect(over.status).toBe(429);
    expect(over.headers.get("Retry-After")).toBeTruthy();
    limiter.destroy();
  });
});

describe("next adapter — withApiKeyAuth", () => {
  const route = withApiKeyAuth<Rec>((_req, rec) => Response.json({ id: rec.id }), { lookup });

  it("401 without a key", async () => {
    expect((await route(new Request("https://x/api"))).status).toBe(401);
  });
  it("401 on an invalid key", async () => {
    expect((await route(new Request("https://x/api", { headers: { authorization: "Bearer nope" } }))).status).toBe(401);
  });
  it("runs the handler with the record on a valid key", async () => {
    const res = await route(new Request("https://x/api", { headers: { authorization: "Bearer trail_good" } }));
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe("k1");
  });
  it("403 when authorize rejects", async () => {
    const guarded = withApiKeyAuth<Rec>((_r, rec) => Response.json({ id: rec.id }), { lookup, authorize: () => false });
    const res = await guarded(new Request("https://x/api", { headers: { "x-api-key": "trail_good" } }));
    expect(res.status).toBe(403);
  });
});

describe("next adapter — nextRateLimit", () => {
  it("returns null under the limit, a 429 Response over it", async () => {
    const limiter = new SlidingWindowRateLimiter({ windowMs: 60_000, max: 1 });
    const guard = nextRateLimit(limiter, () => "k");
    expect(await guard(new Request("https://x"))).toBeNull();
    const blocked = await guard(new Request("https://x"));
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(429);
    limiter.destroy();
  });
});
