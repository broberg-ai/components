/**
 * F095.2 — the profile client (getProfile/updateProfile/uploadAvatar/removeAvatar)
 * and accountRoutes, against a FAKE Broberg ID. Same limit as sso.test.ts: a fake
 * agrees with whoever wrote it, so this proves the wiring and the error mapping,
 * not that BID answers exactly so. The live shape of the 401 ({"error":"invalid_token"})
 * was measured against id.broberg.ai on 2026-10-05; the 403 insufficient_scope
 * shape was not (it needs a real token without profile:write).
 */
import { describe, expect, test } from "vitest";
import { Hono } from "hono";
import { loadSsoConfig } from "../src/config.js";
import {
  createSsoClient,
  MAX_AVATAR_BYTES,
  SsoAppApiError,
  SsoAvatarRejectedError,
  SsoError,
  SsoInsufficientScopeError,
  type SsoClient,
} from "../src/client.js";
import { accountRoutes, ssoRoutes } from "../src/hono.js";
import { signSession, verifySession } from "../src/session.js";
import { memoryTokenStore } from "../src/tokens.js";

const ISSUER = "https://id.broberg.ai";
const ENV = {
  BID_ISSUER: ISSUER,
  SSO_CLIENT_ID: "test-app",
  SSO_REDIRECT_URI: "https://app.example/auth/callback",
  SSO_COOKIE_SECRET: "s".repeat(64),
} as NodeJS.ProcessEnv;
const AT = "access-token-SECRET-1234";
const RT = "refresh-token-SECRET-5678";

type Call = { url: string; method: string; auth: string | null; type: string | null; body: Uint8Array | null };

/** A fake BID app API that keeps the profile in memory, so a write can be READ BACK. */
function fakeBid() {
  const calls: Call[] = [];
  const state = { name: "Christian Broberg" as string | null, picture: "https://id.broberg.ai/a/1.png" as string | null };
  let answer: (() => Response) | null = null;
  const profile = () => ({
    sub: "user-1",
    name: state.name,
    picture: state.picture,
    email: "cb@webhouse.dk",
    account_url: "https://id.broberg.ai/account",
  });
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/.well-known/openid-configuration")) {
      return Response.json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/oauth2/authorize`,
        token_endpoint: `${ISSUER}/oauth2/token`,
        jwks_uri: `${ISSUER}/jwks`,
      });
    }
    if (url.endsWith("/oauth2/token")) return Response.json({ error: "invalid_grant" }, { status: 400 });
    const h = new Headers(init?.headers);
    const body = init?.body === undefined ? null : new Uint8Array(await new Response(init.body as BodyInit).arrayBuffer());
    calls.push({ url, method: init?.method ?? "GET", auth: h.get("authorization"), type: h.get("content-type"), body });
    if (answer) return answer();
    const path = new URL(url).pathname;
    if (path === "/api/app/profile" && init?.method === "POST") state.name = JSON.parse(new TextDecoder().decode(body!)).name;
    if (path === "/api/app/profile/avatar") state.picture = "https://id.broberg.ai/a/2.png";
    if (path === "/api/app/profile/avatar/remove") state.picture = null;
    return Response.json(profile());
  }) as unknown as typeof fetch;
  return {
    calls,
    profile,
    fetchImpl,
    /** Make every app-API call answer this instead. */
    answerWith(r: () => Response) { answer = r; },
    appCalls: () => calls.filter((c) => c.url.includes("/api/app/")),
  };
}

const text = (b: Uint8Array | null) => (b === null ? null : new TextDecoder().decode(b));

/* ── AC1 + AC2 + AC4: the client ─────────────────────────────────────────── */

describe("F095.2 — the profile client calls BID's /api/app/profile* as the user", () => {
  const make = () => {
    const bid = fakeBid();
    return { bid, client: createSsoClient(loadSsoConfig(ENV), { fetchImpl: bid.fetchImpl }) };
  };

  test("getProfile: GET /api/app/profile with the Bearer, no body, returns the five fields", async () => {
    const { bid, client } = make();
    expect(await client.getProfile(AT)).toEqual(bid.profile());
    expect(bid.calls).toEqual([
      { url: "https://id.broberg.ai/api/app/profile", method: "GET", auth: `Bearer ${AT}`, type: null, body: null },
    ]);
  });

  test("updateProfile: POST {name} as JSON, and returns the NEW name", async () => {
    const { bid, client } = make();
    const r = await client.updateProfile(AT, "Ny Navn 1759");
    expect(r.name).toBe("Ny Navn 1759");
    expect(bid.calls.map((c) => ({ ...c, body: text(c.body) }))).toEqual([
      { url: "https://id.broberg.ai/api/app/profile", method: "POST", auth: `Bearer ${AT}`, type: "application/json", body: '{"name":"Ny Navn 1759"}' },
    ]);
  });

  test("uploadAvatar: POST the raw bytes with the normalised Content-Type", async () => {
    const { bid, client } = make();
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const r = await client.uploadAvatar(AT, bytes, "image/PNG; foo=bar");
    expect(r.picture).toBe("https://id.broberg.ai/a/2.png");
    expect(bid.calls).toEqual([
      { url: "https://id.broberg.ai/api/app/profile/avatar", method: "POST", auth: `Bearer ${AT}`, type: "image/png", body: bytes },
    ]);
  });

  test("uploadAvatar at EXACTLY the limit is sent (the boundary is inclusive)", async () => {
    const { bid, client } = make();
    await client.uploadAvatar(AT, new Uint8Array(MAX_AVATAR_BYTES), "image/webp");
    expect(bid.calls.length).toBe(1);
    expect(bid.calls[0]!.body!.byteLength).toBe(MAX_AVATAR_BYTES);
  });

  test("removeAvatar: POST /api/app/profile/avatar/remove, no body, picture becomes null", async () => {
    const { bid, client } = make();
    const r = await client.removeAvatar(AT);
    expect(r.picture).toBe(null);
    expect(bid.calls).toEqual([
      { url: "https://id.broberg.ai/api/app/profile/avatar/remove", method: "POST", auth: `Bearer ${AT}`, type: null, body: null },
    ]);
  });

  test("AC2: one byte over 2 MB is refused BEFORE sending — named error, zero requests", async () => {
    const { bid, client } = make();
    const err = await client.uploadAvatar(AT, new Uint8Array(MAX_AVATAR_BYTES + 1), "image/png").catch((e) => e);
    expect(err).toBeInstanceOf(SsoAvatarRejectedError);
    expect([err.name, err.reason]).toEqual(["SsoAvatarRejectedError", "too_large"]);
    expect(bid.calls.length).toBe(0);
  });

  for (const type of ["image/gif", "image/svg+xml", "application/octet-stream", ""]) {
    test(`AC2: "${type}" is refused BEFORE sending — named error, zero requests`, async () => {
      const { bid, client } = make();
      const err = await client.uploadAvatar(AT, new Uint8Array(10), type).catch((e) => e);
      expect(err).toBeInstanceOf(SsoAvatarRejectedError);
      expect(err.reason).toBe("unsupported_type");
      expect(bid.calls.length).toBe(0);
    });
  }

  test("AC4: 403 insufficient_scope → SsoInsufficientScopeError with scope profile:write, no token in the message", async () => {
    const { bid, client } = make();
    bid.answerWith(() => Response.json({ error: "insufficient_scope" }, { status: 403 }));
    const err = await client.updateProfile(AT, "x").catch((e) => e);
    expect(err).toBeInstanceOf(SsoInsufficientScopeError);
    expect(err).toBeInstanceOf(SsoAppApiError);
    expect(err).toBeInstanceOf(SsoError);
    expect([err.name, err.scope, err.status, err.code]).toEqual(["SsoInsufficientScopeError", "profile:write", 403, "insufficient_scope"]);
    expect(err.message.includes(AT)).toBe(false);
  });

  test("AC4: BID's own scope field wins when it sends one", async () => {
    const { bid, client } = make();
    bid.answerWith(() => Response.json({ error: "insufficient_scope", scope: "profile" }, { status: 403 }));
    const err = await client.getProfile(AT).catch((e) => e);
    expect(err.scope).toBe("profile");
  });

  test("a 403 with ANOTHER code is a plain SsoAppApiError, not a scope problem", async () => {
    const { bid, client } = make();
    bid.answerWith(() => Response.json({ error: "forbidden" }, { status: 403 }));
    const err = await client.removeAvatar(AT).catch((e) => e);
    expect(err).toBeInstanceOf(SsoAppApiError);
    expect(err).not.toBeInstanceOf(SsoInsufficientScopeError);
    expect([err.status, err.code]).toEqual([403, "forbidden"]);
  });

  const failures: Array<[string, () => Response, number | null, string | undefined]> = [
    ["401 invalid_token (measured live shape)", () => Response.json({ error: "invalid_token" }, { status: 401 }), 401, "invalid_token"],
    ["a 500 with an HTML body that echoes the token", () => new Response(`<h1>boom ${AT}</h1>`, { status: 500 }), 500, undefined],
    ["a 200 that is not JSON", () => new Response("<html>", { status: 200 }), 200, undefined],
    ["a 200 without sub", () => Response.json({ name: "x", account_url: "u" }), 200, undefined],
  ];
  for (const [name, respond, status, code] of failures) {
    test(`${name} → SsoAppApiError(status ${status}, code ${code}), never a token in the message`, async () => {
      const { bid, client } = make();
      bid.answerWith(respond);
      const err = await client.getProfile(AT).catch((e) => e);
      expect(err).toBeInstanceOf(SsoAppApiError);
      expect([err.status, err.code]).toEqual([status, code]);
      expect(err.message.includes(AT)).toBe(false);
    });
  }

  test("a network failure → SsoAppApiError with status null, and the fetch error's message is not quoted", async () => {
    const fetchImpl = (async () => {
      throw new TypeError(`fetch failed for Bearer ${AT}`);
    }) as unknown as typeof fetch;
    const client = createSsoClient(loadSsoConfig(ENV), { fetchImpl });
    const err = await client.getProfile(AT).catch((e) => e);
    expect([err.name, err.status]).toEqual(["SsoAppApiError", null]);
    expect(err.message.includes(AT)).toBe(false);
  });

  test("a hanging BID → SsoAppApiError after timeoutMs", async () => {
    const fetchImpl = ((_: unknown, init?: RequestInit) =>
      new Promise((_r, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as unknown as typeof fetch;
    const client = createSsoClient(loadSsoConfig(ENV), { fetchImpl, timeoutMs: 50 });
    const err = await client.getProfile(AT).catch((e) => e);
    expect([err.name, err.status]).toEqual(["SsoAppApiError", null]);
    expect(err.message).toContain("did not answer within 50 ms");
  });
});

/* ── AC3 + AC4: accountRoutes ────────────────────────────────────────────── */

describe("F095.2 — accountRoutes: the app's /api/account, JSON in and out", () => {
  async function setup(opts: { tokens?: "fresh" | "expired-no-refresh" | "expired-refresh-refused" | "none"; sid?: boolean; tokenStore?: boolean; sessionProfile?: { name?: string; picture?: string } } = {}) {
    const bid = fakeBid();
    const config = loadSsoConfig(ENV);
    const client = createSsoClient(config, { fetchImpl: bid.fetchImpl, minRefetchIntervalMs: 0 });
    const store = memoryTokenStore({ quiet: true });
    const sso = ssoRoutes({ config, client, ...(opts.tokenStore === false ? {} : { tokenStore: store }) });
    const app = new Hono();
    app.route("/auth", sso.app);
    app.route("/api/account", accountRoutes(sso));
    const now = Math.floor(Date.now() / 1000);
    const sid = "sid-0123456789abcdefghij";
    const kind = opts.tokens ?? "fresh";
    if (kind !== "none") {
      await store.set(sid, {
        sub: "user-1",
        accessToken: AT,
        ...(kind === "expired-refresh-refused" ? { refreshToken: RT } : {}),
        expiresAt: kind === "fresh" ? now + 3600 : now - 1,
      });
    }
    const cookie = `${config.cookieName}=${await signSession(
      { sub: "user-1", iat: now, exp: now + 600, ...(opts.sid === false ? {} : { sid }), ...(opts.sessionProfile ?? {}) },
      config.cookieSecret,
    )}`;
    const req = (path: string, init: RequestInit & { noCookie?: boolean } = {}) => {
      const headers = new Headers(init.headers);
      if (!init.noCookie) headers.set("cookie", cookie);
      return app.request(`https://app.example/api/account${path}`, { ...init, headers });
    };
    return { bid, store, sid, req, config, iat: now, exp: now + 600 };
  }

  /** Every refusal: status, exact JSON body, no redirect, no token anywhere in it. */
  async function refusal(r: Response) {
    const body = await r.text();
    expect(r.headers.get("location")).toBe(null);
    expect(body.includes(AT)).toBe(false);
    expect(body.includes(RT)).toBe(false);
    return [r.status, JSON.parse(body)];
  }

  test("GET /profile → 200 with BID's profile, called with the session's stored token; no-store", async () => {
    const t = await setup();
    const r = await t.req("/profile");
    expect([r.status, await r.json()]).toEqual([200, t.bid.profile()]);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(t.bid.appCalls().map((c) => [c.method, c.url, c.auth])).toEqual([["GET", "https://id.broberg.ai/api/app/profile", `Bearer ${AT}`]]);
  });

  test("POST /profile {name} → BID gets exactly that name, and a FRESH GET reads it back", async () => {
    const t = await setup();
    const name = `Navn ${Date.now()}`;
    const r = await t.req("/profile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
    expect(r.status).toBe(200);
    expect((await r.json()).name).toBe(name);
    expect(text(t.bid.appCalls()[0]!.body)).toBe(JSON.stringify({ name }));
    expect((await (await t.req("/profile")).json()).name).toBe(name);
    // negative control: an empty name is sent as empty (BID decides), and reads back empty
    await t.req("/profile", { method: "POST", headers: { "content-type": "application/json" }, body: '{"name":""}' });
    expect((await (await t.req("/profile")).json()).name).toBe("");
  });

  test("POST /profile without a string name → 400, nothing sent to BID", async () => {
    const t = await setup();
    for (const body of ['{"name":42}', "{}", "not json"]) {
      expect(await refusal(await t.req("/profile", { method: "POST", headers: { "content-type": "application/json" }, body }))).toEqual([
        400,
        { error: "invalid_request", error_description: '"name" must be a string' },
      ]);
    }
    expect(t.bid.appCalls().length).toBe(0);
  });

  test("a write from another site (even a sibling subdomain) → 403 cross_site, nothing sent; same-origin passes", async () => {
    const t = await setup();
    for (const site of ["cross-site", "same-site"]) {
      expect(await refusal(await t.req("/profile/avatar/remove", { method: "POST", headers: { "sec-fetch-site": site } }))).toEqual([
        403,
        { error: "cross_site" },
      ]);
    }
    expect(t.bid.appCalls().length).toBe(0);
    // negative control: the app's own page is let through
    const ok = await t.req("/profile/avatar/remove", { method: "POST", headers: { "sec-fetch-site": "same-origin" } });
    expect([ok.status, t.bid.appCalls().length]).toEqual([200, 1]);
  });

  /** The session cookie a response set, decoded — or null when it set none. */
  async function sessionSet(r: Response, config: ReturnType<typeof loadSsoConfig>) {
    const raw = r.headers.getSetCookie().find((h) => h.startsWith(`${config.cookieName}=`));
    if (!raw) return null;
    const value = raw.split(";")[0]!.slice(config.cookieName.length + 1);
    const maxAge = Number(/Max-Age=(\d+)/.exec(raw)?.[1]);
    return { session: await verifySession(value, config.cookieSecret), maxAge };
  }

  test("F095.5: a saved name re-signs the session cookie — new name, same sub/sid/iat/exp, lifetime NOT extended", async () => {
    const t = await setup();
    const name = `Navn ${Date.now()}`;
    const r = await t.req("/profile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
    expect(r.status).toBe(200);
    const set = await sessionSet(r, t.config);
    expect(set?.session?.name).toBe(name);
    expect(set?.session?.picture).toBe("https://id.broberg.ai/a/1.png");
    expect([set?.session?.sub, set?.session?.sid, set?.session?.iat, set?.session?.exp]).toEqual(["user-1", t.sid, t.iat, t.exp]);
    expect(set!.maxAge).toBeLessThanOrEqual(600);
    expect(set!.maxAge).toBeGreaterThan(590);
  });

  test("F095.5: removing the picture drops it from the session cookie; uploading sets the new one", async () => {
    const t = await setup();
    const up = await sessionSet(await t.req("/profile/avatar", { method: "POST", headers: { "content-type": "image/png" }, body: new Uint8Array([1, 2, 3]) }), t.config);
    expect(up?.session?.picture).toBe("https://id.broberg.ai/a/2.png");
    const rm = await sessionSet(await t.req("/profile/avatar/remove", { method: "POST" }), t.config);
    expect(rm?.session !== null && rm?.session !== undefined && !("picture" in rm.session)).toBe(true);
  });

  test("F095.5: nothing changed → no Set-Cookie; a refused write → no Set-Cookie", async () => {
    const t = await setup({ sessionProfile: { name: "Christian Broberg", picture: "https://id.broberg.ai/a/1.png" } });
    expect(await sessionSet(await t.req("/profile"), t.config)).toBe(null);
    t.bid.answerWith(() => Response.json({ error: "invalid_name" }, { status: 400 }));
    expect(await sessionSet(await t.req("/profile", { method: "POST", headers: { "content-type": "application/json" }, body: '{"name":"x"}' }), t.config)).toBe(null);
  });

  test("POST /profile/avatar forwards the raw bytes and the Content-Type", async () => {
    const t = await setup();
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7]);
    const r = await t.req("/profile/avatar", { method: "POST", headers: { "content-type": "image/jpeg" }, body: bytes });
    expect([r.status, (await r.json()).picture]).toEqual([200, "https://id.broberg.ai/a/2.png"]);
    const [c] = t.bid.appCalls();
    expect([c!.method, c!.url, c!.auth, c!.type]).toEqual(["POST", "https://id.broberg.ai/api/app/profile/avatar", `Bearer ${AT}`, "image/jpeg"]);
    expect(c!.body).toEqual(bytes);
  });

  test("POST /profile/avatar with Content-Length over 2 MB → 413 before the body is read, nothing sent", async () => {
    const t = await setup();
    // highWaterMark 0: the stream is pulled only when someone actually reads it.
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(ctrl) {
          pulled++;
          ctrl.enqueue(new Uint8Array(10));
          ctrl.close();
        },
      },
      { highWaterMark: 0 },
    );
    const r = await t.req("/profile/avatar", {
      method: "POST",
      headers: { "content-type": "image/png", "content-length": String(MAX_AVATAR_BYTES + 1) },
      body,
      duplex: "half",
    } as RequestInit);
    expect(await refusal(r)).toEqual([413, { error: "too_large", max_bytes: MAX_AVATAR_BYTES }]);
    expect(pulled).toBe(0);
    expect(t.bid.appCalls().length).toBe(0);
  });

  test("POST /profile/avatar with NO Content-Length and an oversized body → 413, cut off, nothing sent", async () => {
    const t = await setup();
    const chunk = new Uint8Array(512 * 1024);
    // 20 × 512 KiB = 10 MiB offered; the limit is crossed at the 5th chunk.
    let sent = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(ctrl) {
          if (sent >= 20) return ctrl.close();
          sent++;
          ctrl.enqueue(chunk);
        },
      },
      { highWaterMark: 0 },
    );
    const r = await t.req("/profile/avatar", { method: "POST", headers: { "content-type": "image/png" }, body, duplex: "half" } as RequestInit);
    expect(await refusal(r)).toEqual([413, { error: "too_large", max_bytes: MAX_AVATAR_BYTES }]);
    expect(sent).toBeLessThanOrEqual(6);
    expect(t.bid.appCalls().length).toBe(0);
  });

  test("POST /profile/avatar with a wrong type → 415, nothing sent", async () => {
    const t = await setup();
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>(
      { pull(ctrl) { pulled++; ctrl.enqueue(new Uint8Array(4)); ctrl.close(); } },
      { highWaterMark: 0 },
    );
    const r = await t.req("/profile/avatar", { method: "POST", headers: { "content-type": "image/gif" }, body, duplex: "half" } as RequestInit);
    expect(await refusal(r)).toEqual([415, { error: "unsupported_type", accepted: ["image/png", "image/jpeg", "image/webp"] }]);
    // refused on the header alone — the body was never read
    expect(pulled).toBe(0);
    expect(t.bid.appCalls().length).toBe(0);
  });

  test("POST /profile/avatar/remove → BID's remove, picture null", async () => {
    const t = await setup();
    const r = await t.req("/profile/avatar/remove", { method: "POST" });
    expect([r.status, (await r.json()).picture]).toEqual([200, null]);
    expect(t.bid.appCalls().map((c) => [c.method, c.url, c.body])).toEqual([["POST", "https://id.broberg.ai/api/app/profile/avatar/remove", null]]);
  });

  test("no session → 401 JSON {error:unauthenticated}, NOT a redirect, on every route; nothing sent", async () => {
    const t = await setup();
    for (const [path, method] of [["/profile", "GET"], ["/profile", "POST"], ["/profile/avatar", "POST"], ["/profile/avatar/remove", "POST"]] as const) {
      const r = await t.req(path, { method, noCookie: true, headers: { "content-type": "image/png" }, ...(method === "POST" ? { body: "{}" } : {}) });
      expect(await refusal(r)).toEqual([401, { error: "unauthenticated" }]);
    }
    expect(t.bid.appCalls().length).toBe(0);
  });

  // The coordinator's measured fact: BID issues NO refresh token, so after an hour this is EVERY user.
  test("token expired and no refresh token (BID's real behaviour) → 401 {error:reauth}, never a 500", async () => {
    const t = await setup({ tokens: "expired-no-refresh" });
    expect(await refusal(await t.req("/profile"))).toEqual([401, { error: "reauth" }]);
    expect(t.bid.appCalls().length).toBe(0);
  });

  const reauth: Array<[string, Parameters<typeof setup>[0]]> = [
    ["the refresh is refused", { tokens: "expired-refresh-refused" }],
    ["no tokens are stored for the session", { tokens: "none" }],
    ["the session predates tokenStore (no sid)", { sid: false }],
  ];
  for (const [name, opts] of reauth) {
    test(`${name} → 401 {error:reauth}`, async () => {
      const t = await setup(opts);
      expect(await refusal(await t.req("/profile"))).toEqual([401, { error: "reauth" }]);
    });
  }

  test("BID itself answers 401 (token revoked in BID) → 401 {error:reauth}", async () => {
    const t = await setup();
    t.bid.answerWith(() => Response.json({ error: "invalid_token" }, { status: 401 }));
    expect(await refusal(await t.req("/profile"))).toEqual([401, { error: "reauth" }]);
  });

  test("AC4: BID 403 insufficient_scope → 403 {error:insufficient_scope, scope:profile:write}", async () => {
    const t = await setup();
    t.bid.answerWith(() => Response.json({ error: "insufficient_scope" }, { status: 403 }));
    const r = await t.req("/profile", { method: "POST", headers: { "content-type": "application/json" }, body: '{"name":"x"}' });
    expect(await refusal(r)).toEqual([403, { error: "insufficient_scope", scope: "profile:write" }]);
  });

  test("errors are matched by NAME — a client from the other bundle (not instanceof) still maps to 403", async () => {
    const foreign = Object.assign(new Error("x"), { name: "SsoInsufficientScopeError", scope: "profile:write" });
    const client = { getProfile: async () => { throw foreign; } } as unknown as SsoClient;
    const app = new Hono();
    app.route("/api/account", accountRoutes({ client, getAccessToken: async () => AT }));
    expect(await refusal(await app.request("https://app.example/api/account/profile"))).toEqual([
      403,
      { error: "insufficient_scope", scope: "profile:write" },
    ]);
  });

  test("BID refuses a value (400 invalid_name) → 400 with BID's code", async () => {
    const t = await setup();
    t.bid.answerWith(() => Response.json({ error: "invalid_name" }, { status: 400 }));
    const r = await t.req("/profile", { method: "POST", headers: { "content-type": "application/json" }, body: '{"name":"x"}' });
    expect(await refusal(r)).toEqual([400, { error: "invalid_name" }]);
  });

  test("BID 500 → 502 {error:bid_unavailable}, the token-echoing body is not passed on", async () => {
    const t = await setup();
    t.bid.answerWith(() => new Response(`boom ${AT}`, { status: 500 }));
    expect(await refusal(await t.req("/profile"))).toEqual([502, { error: "bid_unavailable" }]);
  });

  test("ssoRoutes without tokenStore → 500 {error:sso_misconfigured}, not a reauth loop", async () => {
    const t = await setup({ tokenStore: false });
    expect(await refusal(await t.req("/profile"))).toEqual([500, { error: "sso_misconfigured" }]);
  });
});
