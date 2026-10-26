// F039.10 — a machine that cannot reach the store must say so, and must heal by
// itself once it can. 26/10: one Fly machine could not reach Turso, answered 500
// to everything for 25 minutes, and its /health stayed green the whole time.
import { afterEach, describe, expect, it, vi } from "vitest";

// Nothing listens here, so every query is refused — the same ECONNREFUSED as live.
const REFUSED = "http://127.0.0.1:1";

afterEach(() => {
  delete process.env.ENROLL_DB_URL;
  delete process.env.TURSO_DATABASE_URL;
  vi.resetModules();
});

describe("F039.10 — the enroll store", { timeout: 30_000 }, () => {
  it("a failed first connect is NOT remembered: the next call retries and gets a working store", async () => {
    process.env.ENROLL_DB_URL = REFUSED;
    const { getEnrollStore } = await import("./enroll");
    await expect(getEnrollStore()).rejects.toThrow();
    // the network heals
    process.env.ENROLL_DB_URL = ":memory:";
    const store = await getEnrollStore();
    expect(store).not.toBeNull();
    await expect(store!.ping()).resolves.toBeUndefined();
  });
});

// Importing server.ts takes seconds when several test files load it at once; the
// response-time bound (< 3 s) is asserted inside the test, not via the test timeout.
describe("F039.10 — /health tells Fly whether this machine can serve", { timeout: 30_000 }, () => {
  it("store unreachable → 503 with a one-word reason and no host in the body", async () => {
    process.env.ENROLL_DB_URL = REFUSED;
    const { app } = await import("./server");
    const t0 = Date.now();
    const res = await app.request("/health");
    // inside Fly's 5 s check timeout, connecting included
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, store: "unreachable" });
    expect(JSON.stringify(body)).not.toContain("127.0.0.1");
  });

  it("connected at boot, network lost since → 503 (the 26/10 machine: init had succeeded, every query failed)", async () => {
    process.env.ENROLL_DB_URL = ":memory:";
    const { app } = await import("./server");
    const { getEnrollStore } = await import("./enroll");
    const store = (await getEnrollStore())!;
    vi.spyOn(store, "ping").mockRejectedValue(Object.assign(new Error("ECONNREFUSED"), { code: "ECONNREFUSED" }));
    const res = await app.request("/health");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, store: "unreachable" });
  });

  it("store answers → 200 ok", async () => {
    process.env.ENROLL_DB_URL = ":memory:";
    const { app } = await import("./server");
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, store: "ok" });
  });

  it("no store configured (dev) is not 'down' → 200", async () => {
    const { app } = await import("./server");
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, store: "not_configured" });
  });
});
