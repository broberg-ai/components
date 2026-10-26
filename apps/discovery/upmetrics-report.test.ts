// F038.47 — a server error reaches Upmetrics, once, with method + path only.
// Uses the same refused store as store-health.test.ts so a real route throws.
import { afterEach, describe, expect, it, vi } from "vitest";

const REFUSED = "http://127.0.0.1:1";

afterEach(() => {
  delete process.env.ENROLL_DB_URL;
  vi.resetModules();
});

async function bootWithReporter(reporter: ((err: unknown, ctx: unknown) => void) | null) {
  process.env.ENROLL_DB_URL = REFUSED;
  const mod = await import("./server");
  mod.__setErrorReporter(reporter as never);
  return mod.app;
}

describe("F038.47 — errors reach Upmetrics", { timeout: 30_000 }, () => {
  it("a route that throws produces exactly ONE report with the error, and the 500 is unchanged", async () => {
    const calls: { err: unknown; ctx: unknown }[] = [];
    const app = await bootWithReporter((err, ctx) => calls.push({ err, ctx }));
    const res = await app.request("/api/enroll", {
      method: "POST",
      headers: { "content-type": "application/json", "x-discovery-session": "probe", "x-enroll-key": "k".repeat(40) },
      body: JSON.stringify({ session: "probe", pkg: "@broberg/mail", version: "0.1.0", role: "uses" }),
    });
    expect(res.status).toBe(500);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.err).toBeInstanceOf(Error);
    // only method + path — never the enroll key in the headers, never the body
    expect(calls[0]!.ctx).toEqual({ method: "POST", path: "/api/enroll" });
    expect(JSON.stringify(calls[0]!.ctx)).not.toContain("kkkk");
  });

  it("SHIP DARK: with no reporter the same route still answers 500 and nothing is attempted", async () => {
    const app = await bootWithReporter(null);
    const res = await app.request("/api/enroll", {
      method: "POST",
      headers: { "content-type": "application/json", "x-discovery-session": "probe", "x-enroll-key": "k".repeat(40) },
      body: JSON.stringify({ session: "probe", pkg: "@broberg/mail", version: "0.1.0", role: "uses" }),
    });
    expect(res.status).toBe(500);
  });

  it("a reporter that throws does not turn the 500 into something else", async () => {
    const app = await bootWithReporter(() => { throw new Error("upmetrics down"); });
    const res = await app.request("/api/enroll", {
      method: "POST",
      headers: { "content-type": "application/json", "x-discovery-session": "probe", "x-enroll-key": "k".repeat(40) },
      body: JSON.stringify({ session: "probe", pkg: "@broberg/mail", version: "0.1.0", role: "uses" }),
    });
    expect(res.status).toBe(500);
  });
});
