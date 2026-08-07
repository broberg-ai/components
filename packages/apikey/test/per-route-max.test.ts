import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { SlidingWindowRateLimiter } from "../src/index";
import { honoApiKeyMiddleware, honoRateLimit } from "../src/hono";
import { withApiKeyAuth, nextRateLimit } from "../src/next";

/**
 * F010.8 — filed by beacon (#18998).
 *
 * The core has accepted a per-check `max` since v0.1.1, but neither adapter
 * passed it, so beacon reached around our adapter to our own core to give admin
 * and write routes different caps.
 */

type Rec = { id: string; role: string; hash: string };
const KEYS: Record<string, Rec> = {
  good: { id: "k1", role: "admin", hash: "sha256:deadbeef" },
};
const lookup = (p: string): Rec | null => KEYS[p] ?? null;

describe("RateLimitResult.limit", () => {
  it("reports the constructor default when no override is given", async () => {
    const l = new SlidingWindowRateLimiter({ windowMs: 60_000, max: 5 });
    expect((await l.check("a")).limit).toBe(5);
  });

  it("reports the PER-CHECK override, not the default", async () => {
    const l = new SlidingWindowRateLimiter({ windowMs: 60_000, max: 5 });
    const r = await l.check("b", { max: 600 });
    expect(r.limit).toBe(600);
    expect(r.remaining).toBe(599);
  });
});

describe("one limiter, different caps per route", () => {
  const limiter = new SlidingWindowRateLimiter({ windowMs: 60_000, max: 1 });
  const app = new Hono();
  app.use("/admin/*", honoRateLimit(limiter, (c) => ({ key: "admin:" + c.req.path, max: 3 })));
  app.use("/write/*", honoRateLimit(limiter, (c) => ({ key: "write:" + c.req.path, max: 1 })));
  app.get("/admin/x", (c) => c.json({ ok: true }));
  app.get("/write/x", (c) => c.json({ ok: true }));

  it("admin gets its higher cap from the SAME limiter", async () => {
    for (let i = 0; i < 3; i++) {
      const res = await app.request("/admin/x");
      expect(res.status).toBe(200);
      expect(res.headers.get("X-RateLimit-Limit")).toBe("3");
    }
    const over = await app.request("/admin/x");
    expect(over.status).toBe(429);
    expect(over.headers.get("X-RateLimit-Limit")).toBe("3");
  });

  it("write keeps its lower cap on the same limiter instance", async () => {
    expect((await app.request("/write/x")).status).toBe(200);
    const over = await app.request("/write/x");
    expect(over.status).toBe(429);
    expect(over.headers.get("X-RateLimit-Limit")).toBe("1");
  });
});

describe("X-RateLimit-Limit is set on the allowed path too", () => {
  it("so remaining is interpretable before you hit the wall", async () => {
    const limiter = new SlidingWindowRateLimiter({ windowMs: 60_000, max: 10 });
    const app = new Hono();
    app.use("/a/*", honoRateLimit(limiter, () => "fixed"));
    app.get("/a/x", (c) => c.json({ ok: true }));

    const res = await app.request("/a/x");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("10");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("9");
  });
});

describe("project() narrows what reaches the handler", () => {
  it("hono: the hash never lands on the context", async () => {
    const app = new Hono<{ Variables: { apiKey: unknown } }>();
    app.use(
      "/api/*",
      honoApiKeyMiddleware<Rec>({ lookup, project: (r) => ({ id: r.id, role: r.role }) }),
    );
    app.get("/api/me", (c) => c.json({ caller: c.get("apiKey") }));

    const res = await app.request("/api/me", { headers: { Authorization: "Bearer good" } });
    const { caller } = await res.json();
    expect(caller).toEqual({ id: "k1", role: "admin" });
    expect(caller.hash).toBeUndefined();
  });

  it("next: the hash never reaches the route handler", async () => {
    const handler = withApiKeyAuth<Rec>(
      async (_req, caller) => Response.json({ caller }),
      { lookup, project: (r) => ({ id: r.id, role: r.role }) },
    );
    const res = await handler(new Request("https://x/api", { headers: { authorization: "Bearer good" } }));
    const { caller } = await res.json();
    expect(caller).toEqual({ id: "k1", role: "admin" });
    expect(caller.hash).toBeUndefined();
  });

  it("without project, the full record still comes through (v0.2.0 behaviour)", async () => {
    const app = new Hono<{ Variables: { apiKey: Rec } }>();
    app.use("/api/*", honoApiKeyMiddleware<Rec>({ lookup }));
    app.get("/api/me", (c) => c.json({ caller: c.get("apiKey") }));

    const res = await app.request("/api/me", { headers: { Authorization: "Bearer good" } });
    const { caller } = await res.json();
    expect(caller.hash).toBe("sha256:deadbeef");
  });
});

describe("next adapter parity", () => {
  it("accepts the object keyFn and reports the effective limit on its 429", async () => {
    const limiter = new SlidingWindowRateLimiter({ windowMs: 60_000, max: 1 });
    const gate = nextRateLimit(limiter, () => ({ key: "n", max: 2 }));
    const req = new Request("https://x/api");

    expect(await gate(req)).toBeNull();
    expect(await gate(req)).toBeNull();
    const blocked = await gate(req);
    expect(blocked?.status).toBe(429);
    expect(blocked?.headers.get("X-RateLimit-Limit")).toBe("2");
  });

  it("a plain string keyFn still works (v0.2.0 regression)", async () => {
    const limiter = new SlidingWindowRateLimiter({ windowMs: 60_000, max: 1 });
    const gate = nextRateLimit(limiter, () => "plain");
    const req = new Request("https://x/api");
    expect(await gate(req)).toBeNull();
    expect((await gate(req))?.status).toBe(429);
  });
});
