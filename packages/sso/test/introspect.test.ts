import { describe, expect, test } from "vitest";
import { loadSsoConfig, SsoConfigError } from "../src/config.js";
import { createSsoClient, SsoIntrospectionUnavailableError, SsoTokenInactiveError } from "../src/client.js";

// F084.158 — introspectToken (trail #2976). A receiver (Trail's admin server,
// Jam's backend) checks a clipper's BID access token at BID with its OWN client
// credentials. Two failures must never be confused: an unusable token (401) and
// BID not answering (503).
const ISSUER = "https://id.example";
const ENV = {
  BID_ISSUER: ISSUER,
  SSO_CLIENT_ID: "trail-admin",
  SSO_CLIENT_SECRET: "s3cr3t",
  SSO_REDIRECT_URI: "https://app.example/auth/callback",
  SSO_COOKIE_SECRET: "x".repeat(40),
};
const TOKEN = "bid-access-token-ABC123";
const NOW = 1_800_000_000_000;
const EXP = NOW / 1000 + 600;

type Reply = { status?: number; body?: unknown; throws?: Error; raw?: string };
function fakeBid(replies: Reply[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/.well-known/openid-configuration")) {
      return new Response(JSON.stringify({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/a`, token_endpoint: `${ISSUER}/t`, jwks_uri: `${ISSUER}/j`, introspection_endpoint: `${ISSUER}/oauth2/introspect` }), { status: 200 });
    }
    calls.push({ url, init: init ?? {} });
    const r = replies.shift() ?? { status: 500 };
    if (r.throws) throw r.throws;
    return new Response(r.raw ?? JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}
const client = (replies: Reply[], env = ENV) => {
  const bid = fakeBid(replies);
  return { sso: createSsoClient(loadSsoConfig(env), { fetchImpl: bid.fetchImpl, timeoutMs: 200 }), bid };
};
const ACTIVE = { active: true, sub: "user-1", client_id: "trail-clipper", scope: "openid offline_access", exp: EXP };
const opts = { requireClientId: "trail-clipper", now: () => NOW };

describe("F084.158 — introspectToken", () => {
  test("posts RFC 7662 with this app's own credentials and returns the active token", async () => {
    const { sso, bid } = client([{ body: ACTIVE }]);
    expect(await sso.introspectToken(TOKEN, opts)).toEqual({ active: true, sub: "user-1", clientId: "trail-clipper", scope: "openid offline_access", exp: EXP });
    expect(bid.calls).toHaveLength(1);
    const { url, init } = bid.calls[0]!;
    expect(url).toBe(`${ISSUER}/oauth2/introspect`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe(`Basic ${btoa("trail-admin:s3cr3t")}`);
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({ token: TOKEN, token_type_hint: "access_token" });
  });

  test("inactive → SsoTokenInactiveError(inactive)", async () => {
    const { sso } = client([{ body: { active: false } }]);
    await expect(sso.introspectToken(TOKEN, opts)).rejects.toMatchObject({ name: "SsoTokenInactiveError", reason: "inactive" });
  });

  test("issued to another client → SsoTokenInactiveError(wrong_client)", async () => {
    const { sso } = client([{ body: { ...ACTIVE, client_id: "jam-clipper" } }]);
    await expect(sso.introspectToken(TOKEN, opts)).rejects.toMatchObject({ name: "SsoTokenInactiveError", reason: "wrong_client" });
  });

  test("an exp in the past → SsoTokenInactiveError(expired), even if BID said active", async () => {
    const { sso } = client([{ body: { ...ACTIVE, exp: NOW / 1000 - 1 } }]);
    await expect(sso.introspectToken(TOKEN, opts)).rejects.toMatchObject({ name: "SsoTokenInactiveError", reason: "expired" });
  });

  test.each([
    ["a 503", { status: 503 }],
    ["a network failure", { throws: new TypeError("fetch failed") }],
    ["a body that is not JSON", { raw: "<html>bad gateway</html>" }],
    ["our own credentials refused (401)", { status: 401 }],
  ])("BID not answering usefully (%s) → SsoIntrospectionUnavailableError, never 'inactive'", async (_label, reply) => {
    const { sso } = client([reply as Reply]);
    const err = await sso.introspectToken(TOKEN, opts).catch((e) => e);
    expect(err).toBeInstanceOf(SsoIntrospectionUnavailableError);
    expect(err).not.toBeInstanceOf(SsoTokenInactiveError);
  });

  test("a hanging BID times out as unavailable", async () => {
    const hang = (async (input: unknown) => {
      if (String(input).endsWith("openid-configuration")) return new Response(JSON.stringify({ issuer: ISSUER, introspection_endpoint: `${ISSUER}/oauth2/introspect` }));
      return new Promise<Response>(() => {});
    }) as typeof fetch;
    const sso = createSsoClient(loadSsoConfig(ENV), { fetchImpl: hang, timeoutMs: 50 });
    await expect(sso.introspectToken(TOKEN, opts)).rejects.toBeInstanceOf(SsoIntrospectionUnavailableError);
  });

  test("F084.160 — a public client (no secret) is a SETUP error, not «BID is down»: no retry path, zero calls to BID", async () => {
    const { SSO_CLIENT_SECRET: _drop, ...pub } = ENV;
    // Count EVERY request, discovery included — fakeBid's own list skips discovery.
    let requests = 0;
    const bid = fakeBid([{ body: ACTIVE }]);
    const counting = ((input: unknown, init?: RequestInit) => (requests++, bid.fetchImpl(input as string, init))) as typeof fetch;
    const sso = createSsoClient(loadSsoConfig(pub as typeof ENV), { fetchImpl: counting, timeoutMs: 200 });
    const err = await sso.introspectToken(TOKEN, opts).catch((e) => e);
    expect(err).toBeInstanceOf(SsoConfigError);
    expect(err).not.toBeInstanceOf(SsoIntrospectionUnavailableError);
    expect(err).not.toBeInstanceOf(SsoTokenInactiveError);
    expect(requests).toBe(0);
  });

  test("the token never appears in an error message", async () => {
    for (const reply of [{ body: { active: false } }, { status: 503 }, { body: { ...ACTIVE, client_id: "x" } }] as Reply[]) {
      const { sso } = client([reply]);
      const err = (await sso.introspectToken(TOKEN, opts).catch((e) => e)) as Error;
      expect(err.message).not.toContain(TOKEN);
    }
  });
});

describe("F084.158 — the optional cache", () => {
  test("an active answer is reused within cacheMs, then BID is asked again", async () => {
    let t = NOW;
    const { sso, bid } = client([{ body: ACTIVE }, { body: ACTIVE }]);
    const o = { requireClientId: "trail-clipper", cacheMs: 30_000, now: () => t };
    await sso.introspectToken(TOKEN, o);
    t += 29_000;
    await sso.introspectToken(TOKEN, o);
    expect(bid.calls).toHaveLength(1);
    t += 2_000;
    await sso.introspectToken(TOKEN, o);
    expect(bid.calls).toHaveLength(2);
  });

  test("never cached past the token's exp", async () => {
    let t = NOW;
    const { sso, bid } = client([{ body: { ...ACTIVE, exp: NOW / 1000 + 5 } }, { body: { active: false } }]);
    const o = { requireClientId: "trail-clipper", cacheMs: 60_000, now: () => t };
    await sso.introspectToken(TOKEN, o);
    t += 6_000;
    await expect(sso.introspectToken(TOKEN, o)).rejects.toBeInstanceOf(SsoTokenInactiveError);
    expect(bid.calls).toHaveLength(2);
  });

  test("an inactive answer is never cached", async () => {
    const { sso, bid } = client([{ body: { active: false } }, { body: ACTIVE }]);
    const o = { requireClientId: "trail-clipper", cacheMs: 60_000, now: () => NOW };
    await expect(sso.introspectToken(TOKEN, o)).rejects.toBeInstanceOf(SsoTokenInactiveError);
    expect((await sso.introspectToken(TOKEN, o)).sub).toBe("user-1");
    expect(bid.calls).toHaveLength(2);
  });
});
