import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { SlidingWindowRateLimiter, type RateLimitStore } from "../src/index";
import { honoRateLimit } from "../src/hono";
import { nextRateLimit } from "../src/next";

/**
 * F010.9 — filed by beacon (#19017).
 *
 * `check()` captures `now` BEFORE awaiting the store, so `resetAt` comes from a
 * pre-await timestamp while the header is computed from a later `Date.now()`.
 * With the in-memory store the gap is microseconds and this never shows (400/400
 * sampled 429s reported 1). With a SHARED remote store (Turso/Redis — an
 * explicitly supported configuration) the raw value goes negative, and
 * `Math.max(0, …)` turned that into `Retry-After: 0` — "you are rate limited,
 * retry immediately".
 *
 * The store here is a deterministic STUB rather than a sleep-based race: it
 * reports the oldest hit as exactly one window old, so `resetAt` lands on/behind
 * `now` every run. A timing-dependent version of this test was flaky.
 */
function exhaustedStore(windowMs: number): RateLimitStore {
  return {
    async hit(_key, now) {
      // count > max ⇒ not allowed; oldest a full window back ⇒ resetAt <= now.
      return { count: 99, oldest: now - windowMs };
    },
  };
}

const WINDOW = 60_000;

describe("Retry-After is never 0 on a 429", () => {
  it("the raw computation DOES go <= 0 (the defect beacon spotted)", async () => {
    const limiter = new SlidingWindowRateLimiter({
      windowMs: WINDOW,
      max: 1,
      store: exhaustedStore(WINDOW),
    });
    const r = await limiter.check("k");

    expect(r.allowed).toBe(false); // a real 429
    expect(Math.ceil((r.resetAt - Date.now()) / 1000)).toBeLessThanOrEqual(0);
    // This is exactly what the old Math.max(0, …) shipped:
    expect(Math.max(0, Math.ceil((r.resetAt - Date.now()) / 1000))).toBe(0);
  });

  it("hono emits Retry-After >= 1 anyway", async () => {
    const app = new Hono();
    app.use(
      "/r/*",
      honoRateLimit(
        new SlidingWindowRateLimiter({ windowMs: WINDOW, max: 1, store: exhaustedStore(WINDOW) }),
        () => "k",
      ),
    );
    app.get("/r/x", (c) => c.json({ ok: true }));

    const res = await app.request("/r/x");
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
  });

  it("next emits Retry-After >= 1 anyway", async () => {
    const gate = nextRateLimit(
      new SlidingWindowRateLimiter({ windowMs: WINDOW, max: 1, store: exhaustedStore(WINDOW) }),
      () => "k",
    );

    const blocked = await gate(new Request("https://x/api"));
    expect(blocked?.status).toBe(429);
    expect(Number(blocked?.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
  });

  it("does NOT flatten a real multi-second wait to 1", async () => {
    // The floor must not swallow genuine waits — a 60s window still reports ~60.
    const limiter = new SlidingWindowRateLimiter({ windowMs: WINDOW, max: 1 });
    const app = new Hono();
    app.use("/r/*", honoRateLimit(limiter, () => "slow"));
    app.get("/r/x", (c) => c.json({ ok: true }));

    await app.request("/r/x");
    const res = await app.request("/r/x");
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(50);
  });
});
