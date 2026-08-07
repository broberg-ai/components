import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { SlidingWindowRateLimiter } from "../src/index";
import { honoApiKeyMiddleware, honoRateLimit } from "../src/hono";

/**
 * F010.7 — pluggable error responses.
 *
 * beacon could not adopt the shipped middleware because it hardcodes
 * `{ error: "missing_api_key" }` (a STRING) while their whole API answers
 * `{ error: { code, message } }` and their clients switch on `error.code`.
 * Adopting it would have made 401/403 — the two responses a client most needs
 * to handle — the only differently-shaped responses on the surface.
 */

type Rec = { id: string; tenant: string };
const KEYS: Record<string, Rec> = { good: { id: "k1", tenant: "club-a" } };
const lookup = (presented: string): Rec | null => KEYS[presented] ?? null;

/** beacon's envelope shape. */
const envelope = (c: any, code: string, status: 401 | 403 | 429, extra?: object) =>
  c.json({ error: { code, message: `denied: ${code}`, ...extra } }, status);

describe("onUnauthorized / onForbidden", () => {
  const seen: string[] = [];
  const app = new Hono();
  app.use(
    "/api/*",
    honoApiKeyMiddleware<Rec>({
      lookup,
      authorize: (rec) => rec.tenant === "club-z",
      onUnauthorized: (c, reason) => {
        seen.push(reason);
        return envelope(c, `unauthorized_${reason}`, 401);
      },
      onForbidden: (c, record) => envelope(c, "forbidden", 403, { at: record.id }),
    }),
  );
  app.get("/api/me", (c) => c.json({ ok: true }));

  it("renders the consumer's 401 body and reports reason=missing", async () => {
    const res = await app.request("/api/me");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: "unauthorized_missing", message: "denied: unauthorized_missing" },
    });
  });

  it("distinguishes reason=invalid from reason=missing", async () => {
    const res = await app.request("/api/me", { headers: { Authorization: "Bearer nope" } });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthorized_invalid");
    expect(seen).toEqual(["missing", "invalid"]);
  });

  it("renders the consumer's 403 body and passes the resolved record", async () => {
    const res = await app.request("/api/me", { headers: { Authorization: "Bearer good" } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: "forbidden", message: "denied: forbidden", at: "k1" },
    });
  });
});

describe("honoRateLimit onLimited", () => {
  const app = new Hono();
  const limiter = new SlidingWindowRateLimiter({ windowMs: 60_000, max: 1 });
  app.use(
    "/r/*",
    honoRateLimit(limiter, () => "fixed", {
      onLimited: (c, r) => envelope(c, "rate_limited", 429, { remaining: r.remaining }),
    }),
  );
  app.get("/r/x", (c) => c.json({ ok: true }));

  it("renders the consumer's 429 body but keeps the headers", async () => {
    expect((await app.request("/r/x")).status).toBe(200);

    const res = await app.request("/r/x");
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      error: { code: "rate_limited", message: "denied: rate_limited", remaining: 0 },
    });
    // The hook shapes the body, not the headers.
    expect(res.headers.get("Retry-After")).not.toBeNull();
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
  });
});

describe("defaults are byte-identical without hooks (v0.1.1 regression)", () => {
  const app = new Hono();
  app.use("/api/*", honoApiKeyMiddleware<Rec>({ lookup, authorize: (r) => r.tenant === "club-z" }));
  app.get("/api/me", (c) => c.json({ ok: true }));

  const limited = new Hono();
  const limiter = new SlidingWindowRateLimiter({ windowMs: 60_000, max: 1 });
  limited.use("/r/*", honoRateLimit(limiter, () => "fixed"));
  limited.get("/r/x", (c) => c.json({ ok: true }));

  it("401 missing → { error: 'missing_api_key' }", async () => {
    const res = await app.request("/api/me");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "missing_api_key" });
  });

  it("401 invalid → { error: 'invalid_api_key' }", async () => {
    const res = await app.request("/api/me", { headers: { Authorization: "Bearer nope" } });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_api_key" });
  });

  it("403 → { error: 'forbidden' }", async () => {
    const res = await app.request("/api/me", { headers: { Authorization: "Bearer good" } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });

  it("429 → { error: 'rate_limited' }", async () => {
    await limited.request("/r/x");
    const res = await limited.request("/r/x");
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });
  });
});
