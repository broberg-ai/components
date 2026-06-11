import { describe, it, expect, afterEach } from "vitest";
import { Hono } from "hono";
import {
  createLensMintHandler,
  type LensMintOptions,
  type LensSessionContext,
} from "../src/index";
import { createLensRoute } from "../src/next";
import { lensSessionHandler } from "../src/hono";

const SECRET = "test-mint-secret-abc123";

function baseOpts(over: Partial<LensMintOptions> = {}): LensMintOptions {
  return {
    secret: SECRET,
    principal: "lens@myapp.local",
    createSession: () => ({ name: "myapp.session_token", value: "signed-token-xyz" }),
    ...over,
  };
}

function req(
  authorization: string | null,
  over: Partial<{ host: string; secure: boolean }> = {},
) {
  return { authorization, host: "myapp.com", secure: true, ...over };
}

describe("createLensMintHandler — construction guards", () => {
  it("throws when principal is cb@webhouse.dk (case-insensitive)", () => {
    expect(() => createLensMintHandler(baseOpts({ principal: "CB@Webhouse.dk" }))).toThrow(
      /cb@webhouse\.dk/i,
    );
  });
  it("throws when principal is blank", () => {
    expect(() => createLensMintHandler(baseOpts({ principal: "   " }))).toThrow(/principal/i);
  });
  it("constructs with a valid dedicated principal", () => {
    expect(() => createLensMintHandler(baseOpts())).not.toThrow();
  });
});

describe("createLensMintHandler — bearer + ship-dark", () => {
  const ENV = process.env.LENS_MINT_SECRET;
  afterEach(() => {
    if (ENV === undefined) delete process.env.LENS_MINT_SECRET;
    else process.env.LENS_MINT_SECRET = ENV;
  });

  it("503 when neither opts.secret nor env is set (ship-dark)", async () => {
    delete process.env.LENS_MINT_SECRET;
    const h = createLensMintHandler(baseOpts({ secret: undefined }));
    expect((await h(req(`Bearer ${SECRET}`))).status).toBe(503);
  });

  it("reads the secret from env when opts.secret is unset", async () => {
    process.env.LENS_MINT_SECRET = "env-secret-999";
    const h = createLensMintHandler(baseOpts({ secret: undefined }));
    expect((await h(req("Bearer env-secret-999"))).status).toBe(200);
    expect((await h(req("Bearer wrong"))).status).toBe(401);
  });

  it("401 on missing bearer", async () => {
    expect((await createLensMintHandler(baseOpts())(req(null))).status).toBe(401);
  });
  it("401 on wrong bearer", async () => {
    expect((await createLensMintHandler(baseOpts())(req("Bearer not-the-secret"))).status).toBe(401);
  });
  it("401 on a wrong-length bearer without throwing (constant-time compare)", async () => {
    expect((await createLensMintHandler(baseOpts())(req("Bearer x"))).status).toBe(401);
  });
  it("200 on correct bearer", async () => {
    expect((await createLensMintHandler(baseOpts())(req(`Bearer ${SECRET}`))).status).toBe(200);
  });
  it("accepts 'bearer' case-insensitively and trims surrounding space", async () => {
    expect((await createLensMintHandler(baseOpts())(req(`bearer   ${SECRET}  `))).status).toBe(200);
  });
});

describe("createLensMintHandler — storageState shape + defaults", () => {
  it("returns the fixed storageState shape with filled defaults", async () => {
    const res = await createLensMintHandler(baseOpts())(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const body = res.body as Extract<typeof res.body, { cookies: unknown }>;
    expect(body.origins).toEqual([]);
    expect(body.cookies).toHaveLength(1);
    expect(body.cookies[0]).toMatchObject({
      name: "myapp.session_token",
      value: "signed-token-xyz",
      domain: "myapp.com",
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    });
    expect(typeof body.cookies[0]!.expires).toBe("number");
  });

  it("expires is unix SECONDS (~ now + 10 min), not ms", async () => {
    const res = await createLensMintHandler(baseOpts())(req(`Bearer ${SECRET}`));
    const c = (res.body as Extract<typeof res.body, { cookies: unknown }>).cookies[0]!;
    const expectedSec = Math.floor((Date.now() + 600_000) / 1000);
    expect(Math.abs(c.expires - expectedSec)).toBeLessThan(5);
    // sanity: seconds are ~1000× smaller than the ms epoch
    expect(c.expires).toBeLessThan(Date.now());
  });

  it("cookie `secure` defaults from the request", async () => {
    const res = await createLensMintHandler(baseOpts())(req(`Bearer ${SECRET}`, { secure: false }));
    expect((res.body as Extract<typeof res.body, { cookies: unknown }>).cookies[0]!.secure).toBe(false);
  });

  it("cookie domain falls back to the request host", async () => {
    const res = await createLensMintHandler(baseOpts())(req(`Bearer ${SECRET}`, { host: "x.fly.dev" }));
    expect((res.body as Extract<typeof res.body, { cookies: unknown }>).cookies[0]!.domain).toBe("x.fly.dev");
  });

  it("cookieDomain option overrides the host", async () => {
    const res = await createLensMintHandler(baseOpts({ cookieDomain: ".myapp.com" }))(req(`Bearer ${SECRET}`));
    expect((res.body as Extract<typeof res.body, { cookies: unknown }>).cookies[0]!.domain).toBe(".myapp.com");
  });

  it("createSession cookie fields override the defaults", async () => {
    const h = createLensMintHandler(
      baseOpts({
        createSession: () => ({
          name: "n",
          value: "v",
          domain: ".override.com",
          secure: false,
          path: "/app",
          sameSite: "Strict",
          expires: 123,
          httpOnly: false,
        }),
      }),
    );
    const body = (await h(req(`Bearer ${SECRET}`))).body as Extract<
      Awaited<ReturnType<typeof h>>["body"],
      { cookies: unknown }
    >;
    expect(body.cookies[0]).toEqual({
      name: "n",
      value: "v",
      domain: ".override.com",
      path: "/app",
      httpOnly: false,
      secure: false,
      sameSite: "Strict",
      expires: 123,
    });
  });

  it("supports an array of cookies", async () => {
    const h = createLensMintHandler(
      baseOpts({ createSession: () => [{ name: "a", value: "1" }, { name: "b", value: "2" }] }),
    );
    const body = (await h(req(`Bearer ${SECRET}`))).body as Extract<
      Awaited<ReturnType<typeof h>>["body"],
      { cookies: unknown }
    >;
    expect(body.cookies).toHaveLength(2);
  });

  it("awaits an async createSession", async () => {
    const h = createLensMintHandler(baseOpts({ createSession: async () => ({ name: "n", value: "async-v" }) }));
    const body = (await h(req(`Bearer ${SECRET}`))).body as Extract<
      Awaited<ReturnType<typeof h>>["body"],
      { cookies: unknown }
    >;
    expect(body.cookies[0]!.value).toBe("async-v");
  });
});

describe("createLensMintHandler — ctx + TTL clamp", () => {
  it("passes a full ctx to createSession", async () => {
    let seen: LensSessionContext | null = null;
    const h = createLensMintHandler(
      baseOpts({
        createSession: (ctx) => {
          seen = ctx;
          return { name: "n", value: "v" };
        },
      }),
    );
    await h(req(`Bearer ${SECRET}`, { host: "h.dev", secure: false }));
    expect(seen!.principal).toBe("lens@myapp.local");
    expect(seen!.host).toBe("h.dev");
    expect(seen!.secure).toBe(false);
    expect(seen!.ttlMs).toBe(600_000);
    expect(seen!.expiresAt).toBeGreaterThan(Date.now());
  });

  it("clamps a too-long ttl down to 10 min", async () => {
    let seen: LensSessionContext | null = null;
    const h = createLensMintHandler(
      baseOpts({ ttlMs: 9_999_999, createSession: (ctx) => ((seen = ctx), { name: "n", value: "v" }) }),
    );
    await h(req(`Bearer ${SECRET}`));
    expect(seen!.ttlMs).toBe(600_000);
  });

  it("clamps a too-short ttl up to 60s", async () => {
    let seen: LensSessionContext | null = null;
    const h = createLensMintHandler(
      baseOpts({ ttlMs: 1, createSession: (ctx) => ((seen = ctx), { name: "n", value: "v" }) }),
    );
    await h(req(`Bearer ${SECRET}`));
    expect(seen!.ttlMs).toBe(60_000);
  });
});

describe("createLensMintHandler — rate limit", () => {
  it("429 after maxPerMinute authenticated mints", async () => {
    const h = createLensMintHandler(baseOpts({ maxPerMinute: 2 }));
    expect((await h(req(`Bearer ${SECRET}`))).status).toBe(200);
    expect((await h(req(`Bearer ${SECRET}`))).status).toBe(200);
    expect((await h(req(`Bearer ${SECRET}`))).status).toBe(429);
  });
  it("maxPerMinute: 0 disables the limiter", async () => {
    const h = createLensMintHandler(baseOpts({ maxPerMinute: 0 }));
    for (let i = 0; i < 50; i++) expect((await h(req(`Bearer ${SECRET}`))).status).toBe(200);
  });
  it("unauthorized requests do not consume the budget", async () => {
    const h = createLensMintHandler(baseOpts({ maxPerMinute: 1 }));
    await h(req("Bearer wrong"));
    await h(req("Bearer wrong"));
    expect((await h(req(`Bearer ${SECRET}`))).status).toBe(200);
  });
});

describe("createLensMintHandler — minter failure", () => {
  it("returns a clean 500 (not an uncaught throw) when createSession rejects", async () => {
    const h = createLensMintHandler(
      baseOpts({
        createSession: () => {
          throw new Error("db down — signing failed");
        },
      }),
    );
    const res = await h(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "lens-session mint failed" });
  });
  it("does not leak the underlying error to the caller", async () => {
    const h = createLensMintHandler(
      baseOpts({ createSession: async () => Promise.reject(new Error("SECRET-LEAK-xyz")) }),
    );
    const res = await h(req(`Bearer ${SECRET}`));
    expect(JSON.stringify(res.body)).not.toContain("SECRET-LEAK-xyz");
  });
});

describe("@broberg/lens/next adapter", () => {
  const { POST } = createLensRoute(baseOpts());
  it("200 storageState on the right bearer", async () => {
    const r = new Request("https://myapp.com/api/lens-session", {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}` },
    });
    const res = await POST(r);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cookies: Array<Record<string, unknown>> };
    expect(body.cookies[0]!.name).toBe("myapp.session_token");
    expect(body.cookies[0]!.domain).toBe("myapp.com");
  });
  it("401 on a wrong bearer", async () => {
    const r = new Request("https://myapp.com/api/lens-session", {
      method: "POST",
      headers: { authorization: "Bearer nope" },
    });
    expect((await POST(r)).status).toBe(401);
  });
  it("derives the cookie domain from x-forwarded-host", async () => {
    const r = new Request("https://internal/api/lens-session", {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}`, "x-forwarded-host": "prod.myapp.com" },
    });
    const body = (await (await POST(r)).json()) as { cookies: Array<Record<string, unknown>> };
    expect(body.cookies[0]!.domain).toBe("prod.myapp.com");
  });
});

describe("@broberg/lens/hono adapter", () => {
  function app(opts: LensMintOptions = baseOpts()) {
    const a = new Hono();
    a.post("/api/lens-session", lensSessionHandler(opts));
    return a;
  }
  it("200 storageState on the right bearer", async () => {
    const res = await app().request("https://myapp.com/api/lens-session", {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cookies: Array<Record<string, unknown>> };
    expect(body.cookies[0]!.value).toBe("signed-token-xyz");
  });
  it("401 on a wrong bearer", async () => {
    const res = await app().request("https://myapp.com/api/lens-session", {
      method: "POST",
      headers: { authorization: "Bearer nope" },
    });
    expect(res.status).toBe(401);
  });
  it("503 when the secret is unset", async () => {
    const prev = process.env.LENS_MINT_SECRET;
    delete process.env.LENS_MINT_SECRET;
    const res = await app(baseOpts({ secret: undefined })).request(
      "https://myapp.com/api/lens-session",
      { method: "POST", headers: { authorization: "Bearer whatever" } },
    );
    expect(res.status).toBe(503);
    if (prev !== undefined) process.env.LENS_MINT_SECRET = prev;
  });
});
