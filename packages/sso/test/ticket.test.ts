// F084.153 — BID tickets verified locally. Keys are EdDSA because that is what
// Broberg ID signs with (measured 2026-09-20; a fake issuer signing RS256 is
// how 0.2.1 shipped broken). Every principal is asserted with strict equality.
import { beforeAll, describe, expect, it } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey, type JWK } from "jose";
import { createTicketVerifier, JwksUnavailableError, SsoError } from "../src/index";

const ISS = "https://id.broberg.ai";
const AUD = "https://discovery.broberg.ai";
const JWKS = `${ISS}/jwks`;

let priv: CryptoKey;
let pub: JWK;
let otherPriv: CryptoKey;
beforeAll(async () => {
  const pair = await generateKeyPair("EdDSA", { extractable: true });
  priv = pair.privateKey;
  pub = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "EdDSA", use: "sig" };
  otherPriv = (await generateKeyPair("EdDSA", { extractable: true })).privateKey;
});

type Claims = Record<string, unknown>;
const now = () => Math.floor(Date.now() / 1000);
const base = (): Claims => ({
  sub: "svc-trail",
  client_id: "svc-trail",
  principal_type: "service",
  org: "broberg",
  scope: "discovery:read-fleet discovery:enroll",
  jti: "t-1",
});
async function ticket(claims: Claims = {}, o: { kid?: string; key?: CryptoKey; iss?: string; aud?: string; life?: number; typ?: string } = {}) {
  const iat = now();
  const jwt = new SignJWT({ ...base(), ...claims })
    .setProtectedHeader({ alg: "EdDSA", kid: o.kid ?? "k1", ...(o.typ ? { typ: o.typ } : {}) })
    .setIssuer(o.iss ?? ISS)
    .setAudience(o.aud ?? AUD)
    .setIssuedAt(iat)
    .setExpirationTime(iat + (o.life ?? 300));
  return jwt.sign(o.key ?? priv);
}

/** A fake key-set endpoint whose availability the test controls. */
function keyServer() {
  const state = { up: true, calls: 0 };
  const fetchImpl = (async (url: string) => {
    state.calls++;
    if (!state.up) throw new TypeError("fetch failed: ECONNREFUSED");
    if (url === JWKS) return Response.json({ keys: [pub] });
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { state, fetchImpl };
}
const verifier = (fetchImpl: typeof fetch, extra: Record<string, unknown> = {}) =>
  createTicketVerifier({ issuer: ISS, audience: AUD, jwksUri: JWKS, fetchImpl, minRefetchIntervalMs: 0, ...extra });

describe("AC0 — a valid ticket gives a typed principal", () => {
  it("service ticket → principal (strict)", async () => {
    const v = verifier(keyServer().fetchImpl);
    const t = await ticket();
    const p = await v.verify(t, { scope: "discovery:read-fleet" });
    expect(p).toEqual({
      principal: "svc-trail",
      type: "service",
      clientId: "svc-trail",
      org: "broberg",
      act: null,
      // F084.156 — a ticket without ver/cnf reads exactly as in 0.14.2 plus these two defaults.
      version: 0,
      cnf: null,
      scopes: ["discovery:read-fleet", "discovery:enroll"],
      exp: p.exp,
      jti: "t-1",
    });
    expect(p.exp).toBeGreaterThan(now());
  });

  it("agent acting for a human carries act; missing org reads null", async () => {
    const v = verifier(keyServer().fetchImpl);
    const t = await ticket({ sub: "agent-components", client_id: "agent-components", principal_type: "agent", org: undefined, act: { sub: "user-123" } }, { life: 900 });
    const p = await v.verify(t);
    expect([p.principal, p.type, p.org, p.act]).toEqual(["agent-components", "agent", null, { sub: "user-123" }]);
  });

  it("several required scopes", async () => {
    const v = verifier(keyServer().fetchImpl);
    await expect(v.verify(await ticket(), { scope: ["discovery:read-fleet", "discovery:enroll"] })).resolves.toBeTruthy();
  });
});

describe("AC1 — rejected, each with a typed error", () => {
  const rejects = async (t: string, msg: RegExp, scope?: string) => {
    const v = verifier(keyServer().fetchImpl);
    const err = await v.verify(t, scope ? { scope } : {}).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(SsoError);
    expect(String((err as Error).message)).toMatch(msg);
  };
  it("wrong issuer", async () => rejects(await ticket({}, { iss: "https://evil.example" }), /iss/));
  it("wrong audience (a ticket for another service)", async () => rejects(await ticket({}, { aud: "https://cardmem.broberg.ai" }), /aud/));
  it("expired", async () => {
    const iat = now() - 3600;
    const t = await new SignJWT(base()).setProtectedHeader({ alg: "EdDSA", kid: "k1" }).setIssuer(ISS).setAudience(AUD).setIssuedAt(iat).setExpirationTime(iat + 300).sign(priv);
    await rejects(t, /exp/);
  });
  it("missing required scope", async () => rejects(await ticket({ scope: "discovery:read-fleet" }), /lacks scope discovery:admin/, "discovery:admin"));
  it("unknown principal_type", async () => rejects(await ticket({ principal_type: "robot" }), /principal_type/));
  it("no principal_type at all (an ID token signed by BID)", async () => rejects(await ticket({ principal_type: undefined, nonce: "n" }), /principal_type|ID token/));
  it("a logout token", async () => rejects(await ticket({ events: { "http://schemas.openid.net/event/backchannel-logout": {} } }, { typ: "logout+jwt" }), /logout token/));
  it("a logout token WITHOUT its typ header, even with a principal_type", async () =>
    rejects(await ticket({ events: { "http://schemas.openid.net/event/backchannel-logout": {} } }), /logout token/));
  it("signed by a key BID does not publish", async () => rejects(await ticket({}, { key: otherPriv }), /rejected/));
  it("a lifetime longer than BID issues", async () => rejects(await ticket({}, { life: 24 * 3600 }), /lifetime/));
  it("alg none", async () => {
    const h = Buffer.from(JSON.stringify({ alg: "none", kid: "k1" })).toString("base64url");
    const b = Buffer.from(JSON.stringify({ ...base(), iss: ISS, aud: AUD, iat: now(), exp: now() + 300 })).toString("base64url");
    await rejects(`${h}.${b}.`, /not allowed/); // refused by OUR allowlist, before any key import
  });
  it("HS256 signed with the public key as the secret", async () => {
    const secret = new TextEncoder().encode(JSON.stringify(pub));
    const t = await new SignJWT(base()).setProtectedHeader({ alg: "HS256", kid: "k1" }).setIssuer(ISS).setAudience(AUD).setIssuedAt().setExpirationTime("5m").sign(secret);
    await rejects(t, /not allowed/); // OUR allowlist, not jose's key-import failure
  });
});

describe("AC2 — BID briefly unreachable", () => {
  it("a cached key still verifies with BID down, with no network call", async () => {
    const ks = keyServer();
    const v = verifier(ks.fetchImpl);
    await v.verify(await ticket()); // warms the cache
    ks.state.up = false;
    const calls = ks.state.calls;
    const p = await v.verify(await ticket({ jti: "t-2" }));
    expect(p.jti).toBe("t-2");
    expect(ks.state.calls).toBe(calls);
  });

  it("an unknown kid with BID down is TRANSIENT (JwksUnavailableError → 503), not a rejection", async () => {
    const ks = keyServer();
    const v = verifier(ks.fetchImpl);
    ks.state.up = false;
    const err = await v.verify(await ticket()).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(JwksUnavailableError);
    expect(err).not.toBeInstanceOf(SsoError);
  });

  it("discovery mode: the issuer unreachable is transient too, and a later call retries", async () => {
    const ks = keyServer();
    const disco = (async (url: string) => {
      if (url === `${ISS}/.well-known/openid-configuration`) {
        if (!ks.state.up) throw new TypeError("fetch failed");
        return Response.json({ issuer: ISS, jwks_uri: JWKS });
      }
      return ks.fetchImpl(url);
    }) as unknown as typeof fetch;
    const v = createTicketVerifier({ issuer: ISS, audience: AUD, fetchImpl: disco, minRefetchIntervalMs: 0 });
    ks.state.up = false;
    await expect(v.verify(await ticket())).rejects.toBeInstanceOf(JwksUnavailableError);
    ks.state.up = true;
    await expect(v.verify(await ticket())).resolves.toMatchObject({ principal: "svc-trail" });
  });

  it("discovery mode refuses an issuer mismatch", async () => {
    const disco = (async () => Response.json({ issuer: "https://other", jwks_uri: JWKS })) as unknown as typeof fetch;
    const v = createTicketVerifier({ issuer: ISS, audience: AUD, fetchImpl: disco });
    await expect(v.verify(await ticket())).rejects.toThrow(/must match exactly/);
  });
});
