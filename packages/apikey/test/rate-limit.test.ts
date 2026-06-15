import { describe, expect, it, vi } from "vitest";
import { SlidingWindowRateLimiter, MemoryRateLimitStore, type RateLimitStore } from "../src/index";

describe("SlidingWindowRateLimiter (in-memory default)", () => {
  it("allows up to `max` then denies, with injected now", async () => {
    const rl = new SlidingWindowRateLimiter({ windowMs: 1000, max: 3 });
    const t0 = 1_000_000;
    expect((await rl.check("ip", t0)).allowed).toBe(true); // 1
    expect((await rl.check("ip", t0 + 10)).allowed).toBe(true); // 2
    const third = await rl.check("ip", t0 + 20); // 3
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);
    expect((await rl.check("ip", t0 + 30)).allowed).toBe(false); // 4 → over
    rl.destroy();
  });

  it("frees up once the window slides past old hits", async () => {
    const rl = new SlidingWindowRateLimiter({ windowMs: 1000, max: 1 });
    const t0 = 5_000_000;
    expect((await rl.check("k", t0)).allowed).toBe(true);
    expect((await rl.check("k", t0 + 500)).allowed).toBe(false); // still in window
    expect((await rl.check("k", t0 + 1500)).allowed).toBe(true); // old hit aged out
    rl.destroy();
  });

  it("keys are independent", async () => {
    const rl = new SlidingWindowRateLimiter({ windowMs: 1000, max: 1 });
    const t = 9_000_000;
    expect((await rl.check("a", t)).allowed).toBe(true);
    expect((await rl.check("b", t)).allowed).toBe(true);
    expect((await rl.check("a", t)).allowed).toBe(false);
    rl.destroy();
  });

  it("reports resetAt = oldest in-window hit + windowMs", async () => {
    const rl = new SlidingWindowRateLimiter({ windowMs: 1000, max: 5 });
    const t0 = 2_000_000;
    const r = await rl.check("k", t0);
    expect(r.resetAt).toBe(t0 + 1000);
    rl.destroy();
  });

  it("rejects invalid config", () => {
    expect(() => new SlidingWindowRateLimiter({ windowMs: 0, max: 1 })).toThrow();
    expect(() => new SlidingWindowRateLimiter({ windowMs: 1, max: 0 })).toThrow();
  });
});

describe("pluggable store", () => {
  it("uses an injected (async) store end-to-end — trail's shared-store path", async () => {
    const calls: Array<[string, number, number]> = [];
    const fakeShared: RateLimitStore = {
      hit: vi.fn(async (key, now, windowMs) => {
        calls.push([key, now, windowMs]);
        // pretend a remote store already has 9 hits in-window
        return { count: 10, oldest: now - 100 };
      }),
    };
    const rl = new SlidingWindowRateLimiter({ windowMs: 60_000, max: 5, store: fakeShared });
    const r = await rl.check("tenant-key", 42);
    expect(fakeShared.hit).toHaveBeenCalledOnce();
    expect(calls[0]).toEqual(["tenant-key", 42, 60_000]);
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
    rl.destroy(); // must NOT touch the injected store
  });
});

describe("MemoryRateLimitStore", () => {
  it("prunes idle keys (does not leak) and destroy() is clean", async () => {
    const store = new MemoryRateLimitStore();
    await store.hit("x", Date.now(), 1000);
    expect(() => store.destroy()).not.toThrow();
  });
});
