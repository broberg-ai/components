// F084.156 — ticket claims read for the future (broberg-id-F087.15): the format
// version, the WHOLE delegation chain, and the DPoP key thumbprint. Each case
// here was a silent shortening in 0.14.2: a chain cut to its first link, a
// malformed act read as "no delegation", cnf dropped.
import { beforeAll, describe, expect, it } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey, type JWK } from "jose";
import { createTicketVerifier } from "../src/index";

const ISS = "https://id.broberg.ai";
const AUD = "https://discovery.broberg.ai";
const JWKS = `${ISS}/jwks`;
let priv: CryptoKey;
let pub: JWK;
beforeAll(async () => {
  const pair = await generateKeyPair("EdDSA", { extractable: true });
  priv = pair.privateKey;
  pub = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "EdDSA", use: "sig" };
});
async function ticket(claims: Record<string, unknown> = {}) {
  const iat = Math.floor(Date.now() / 1000);
  return new SignJWT({ sub: "agent-b", client_id: "agent-b", principal_type: "agent", scope: "discovery:read", jti: "t-9", ...claims })
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
    jwksUri: JWKS,
    minRefetchIntervalMs: 0,
    fetchImpl: (async () => Response.json({ keys: [pub] })) as unknown as typeof fetch,
  });
const nest = (subs: string[]): Record<string, unknown> | undefined =>
  subs.length ? { sub: subs[0], ...(subs.length > 1 ? { act: nest(subs.slice(1)) } : {}) } : undefined;

describe("F084.156 — ver", () => {
  it("no ver → 0, ver:1 → 1", async () => {
    expect([(await v().verify(await ticket())).version, (await v().verify(await ticket({ ver: 1 }))).version]).toEqual([0, 1]);
  });

  it("a ver this sso does not know is REJECTED by name — never read with ver:1 rules", async () => {
    await expect(v().verify(await ticket({ ver: 2 }))).rejects.toThrow(/ticket format version 2 is newer than this @broberg\/sso understands/);
  });

  it("a ver that is not a non-negative integer is rejected", async () => {
    for (const ver of ["1", 1.5, -1]) await expect(v().verify(await ticket({ ver }))).rejects.toThrow(/ver/);
  });
});

describe("F084.156 — act is the whole chain", () => {
  it("two links: agent-b acts for agent-a, who acts for a human — both are kept", async () => {
    const p = await v().verify(await ticket({ act: nest(["agent-a", "user-1"]) }));
    expect(p.act).toEqual({ sub: "agent-a", act: { sub: "user-1" } });
  });

  it("act.sub is unchanged for existing code; one link has no act", async () => {
    const p = await v().verify(await ticket({ act: { sub: "user-1" } }));
    expect([p.act?.sub, p.act]).toEqual(["user-1", { sub: "user-1" }]);
  });

  it("five links pass; a sixth is rejected", async () => {
    const five = ["a1", "a2", "a3", "a4", "u"];
    expect((await v().verify(await ticket({ act: nest(five) }))).act?.act?.act?.act?.act?.sub).toBe("u");
    await expect(v().verify(await ticket({ act: nest([...five, "u2"]) }))).rejects.toThrow(/delegation chain is deeper than 5/);
  });

  it("a link without a string sub is REJECTED — never read as 'no delegation'", async () => {
    await expect(v().verify(await ticket({ act: { client_id: "x" } }))).rejects.toThrow(/act.*sub/);
    await expect(v().verify(await ticket({ act: { sub: "agent-a", act: { sub: 42 } } }))).rejects.toThrow(/act.*sub/);
    await expect(v().verify(await ticket({ act: "user-1" }))).rejects.toThrow(/act/);
  });
});

describe("F084.156 — cnf", () => {
  it("a DPoP-bound ticket is NOT rejected and carries cnf.jkt; without cnf it is null", async () => {
    const bound = await v().verify(await ticket({ cnf: { jkt: "0ZcOCORZNYy-DWpqq30jZyJGHTN0d2HglBV3uiguA4I" } }));
    const plain = await v().verify(await ticket());
    expect([bound.cnf, plain.cnf]).toEqual([{ jkt: "0ZcOCORZNYy-DWpqq30jZyJGHTN0d2HglBV3uiguA4I" }, null]);
  });

  it("a cnf without a string jkt reads as null (only jkt binding is understood)", async () => {
    expect((await v().verify(await ticket({ cnf: { x5t: "abc" } }))).cnf).toBeNull();
  });
});
