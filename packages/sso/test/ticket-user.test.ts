// F084.159 — USER tickets (BID F087.37): an app swapped its user's BID login for a
// ticket to one receiver. sub = the user, client_id/azp = the app. The app must be
// named, and it is never read from sub.
import { beforeAll, describe, expect, it } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey, type JWK } from "jose";
import { createTicketVerifier } from "../src/index";

const ISS = "https://id.broberg.ai";
const AUD = "https://app.trailmem.com";
let priv: CryptoKey;
let pub: JWK;
beforeAll(async () => {
  const pair = await generateKeyPair("EdDSA", { extractable: true });
  priv = pair.privateKey;
  pub = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "EdDSA", use: "sig" };
});
let iat = 0;
async function ticket(claims: Record<string, unknown>) {
  iat = Math.floor(Date.now() / 1000);
  return new SignJWT({ scope: "trail:clip", jti: "u-1", ver: 1, ...claims })
    .setProtectedHeader({ alg: "EdDSA", kid: "k1" })
    .setIssuer(ISS)
    .setAudience(AUD)
    .setIssuedAt(iat)
    .setExpirationTime(iat + 300)
    .sign(priv);
}
const v = () =>
  createTicketVerifier({
    issuer: ISS,
    audience: AUD,
    jwksUri: `${ISS}/jwks`,
    minRefetchIntervalMs: 0,
    fetchImpl: (async () => Response.json({ keys: [pub] })) as unknown as typeof fetch,
  });
const USER = { sub: "user-42", principal_type: "user" };

describe("F084.159 — user tickets", () => {
  it("verifies to the user AND the app that swapped — the whole principal, strictly", async () => {
    const p = await v().verify(await ticket({ ...USER, client_id: "trail-clipper", azp: "trail-clipper" }), { scope: "trail:clip" });
    expect(p).toStrictEqual({
      principal: "user-42",
      type: "user",
      clientId: "trail-clipper",
      org: null,
      act: null,
      version: 1,
      cnf: null,
      scopes: ["trail:clip"],
      exp: iat + 300,
      jti: "u-1",
    });
  });

  it("no client_id but azp → the app is azp", async () => {
    expect((await v().verify(await ticket({ ...USER, azp: "trail-clipper" }))).clientId).toBe("trail-clipper");
  });

  it("neither client_id nor azp → refused, NEVER clientId = the user's sub", async () => {
    await expect(v().verify(await ticket({ ...USER, sub: "trail-clipper" }))).rejects.toThrow(/a user ticket names no app/);
  });

  it("machine tickets keep falling back to sub (unchanged)", async () => {
    expect((await v().verify(await ticket({ sub: "svc-trail", principal_type: "service" }))).clientId).toBe("svc-trail");
  });
});
