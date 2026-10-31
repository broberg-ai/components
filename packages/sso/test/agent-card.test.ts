// components-F084.182 — foreign agent cards and agent tickets, checked against
// BID. Keys are generated locally and served by a stub key set; the live check
// against id.broberg.ai is AC4 and runs on the published package.
import { beforeAll, describe, expect, it } from "vitest";
import { FlattenedSign, SignJWT, exportJWK, generateKeyPair, type CryptoKey, type JWK } from "jose";
import { agentCardJwksUri, canonicalize, createA2AVerifier, verifyAgentCard, SsoError } from "../src/index";

const ISS = "https://id.broberg.ai";
const JKU = `${ISS}/.well-known/agent-card-jwks.json`;
const AGENT = "agent-0b9c7f0e-1111-4c4c-9f9f-2a2a2a2a2a2a";

let priv: CryptoKey;
let pub: JWK;
beforeAll(async () => {
  const pair = await generateKeyPair("EdDSA", { extractable: true });
  priv = pair.privateKey;
  pub = { ...(await exportJWK(pair.publicKey)), kid: "card-k1", alg: "EdDSA", use: "sig" };
});

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const unsignedCard = () => ({
  protocolVersion: "1.0.0",
  name: "Components agent",
  description: "Maintains the fleet's shared packages — «æøå» and 😀 included on purpose",
  url: "https://components.example/a2a",
  version: "1.0.0",
  capabilities: { streaming: false },
  skills: [{ id: "release", name: "Release a package", tags: ["npm"] }],
});
/** Sign like BID: detached JWS over base64url(JCS(card without signatures)). */
async function signed(card: Record<string, unknown> = unsignedCard(), header: Record<string, unknown> = {}, key: CryptoKey = priv) {
  const jws = await new FlattenedSign(new TextEncoder().encode(canonicalize(card)))
    .setProtectedHeader({ alg: "EdDSA", kid: "card-k1", typ: "JOSE", jku: JKU, ...header })
    .sign(key);
  return { ...card, signatures: [{ protected: jws.protected, signature: jws.signature }] };
}
function keyServer() {
  const seen: string[] = [];
  let up = true;
  const fetchImpl = (async (url: string) => {
    seen.push(String(url));
    if (!up) throw new TypeError("fetch failed: ECONNREFUSED");
    if (String(url) === JKU) return Response.json({ keys: [pub] });
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { seen, fetchImpl, down() { up = false; } };
}
const opts = (fetchImpl: typeof fetch) => ({ issuer: ISS, fetchImpl, minRefetchIntervalMs: 0 });

describe("AC0 — a card signed with the issuer's key verifies; one changed byte does not", () => {
  it("valid card → ok with its kid, and the card returned WITHOUT signatures", async () => {
    const k = keyServer();
    const r = await verifyAgentCard(await signed(), opts(k.fetchImpl));
    expect(r).toEqual({ ok: true, kid: "card-k1", card: unsignedCard() });
    expect(k.seen).toEqual([JKU]);
  });
  it("one byte changed in a field → bad_signature", async () => {
    const card = await signed();
    const tampered = { ...card, url: "https://components.example/a2b" };
    expect(await verifyAgentCard(tampered, opts(keyServer().fetchImpl))).toMatchObject({ ok: false, reason: "bad_signature" });
  });
  it("a field ADDED after signing → bad_signature (the signature covers the whole card)", async () => {
    const card = await signed();
    expect(await verifyAgentCard({ ...card, extra: 1 }, opts(keyServer().fetchImpl))).toMatchObject({ ok: false, reason: "bad_signature" });
  });
  it("signed by a key that is not in the set, under a kid that is → bad_signature", async () => {
    const other = (await generateKeyPair("EdDSA", { extractable: true })).privateKey;
    expect(await verifyAgentCard(await signed(unsignedCard(), {}, other), opts(keyServer().fetchImpl))).toMatchObject({ ok: false, reason: "bad_signature" });
  });
  it("a kid the issuer does not publish → unknown_kid", async () => {
    expect(await verifyAgentCard(await signed(unsignedCard(), { kid: "nope" }), opts(keyServer().fetchImpl))).toMatchObject({ ok: false, reason: "unknown_kid" });
  });
  it("key set unreachable → jwks_unreachable, NOT bad_signature", async () => {
    const k = keyServer();
    k.down();
    expect(await verifyAgentCard(await signed(), opts(k.fetchImpl))).toMatchObject({ ok: false, reason: "jwks_unreachable" });
  });
  it.each([
    ["not an object", "x"],
    ["no signatures", unsignedCard()],
    ["empty signatures", { ...unsignedCard(), signatures: [] }],
    ["protected not base64url JSON", { ...unsignedCard(), signatures: [{ protected: "!!", signature: "x" }] }],
  ])("malformed: %s", async (_n, card) => {
    expect(await verifyAgentCard(card, opts(keyServer().fetchImpl))).toMatchObject({ ok: false, reason: "malformed" });
  });
  it("alg other than EdDSA → malformed", async () => {
    const card = await signed();
    const sig = (card.signatures as { protected: string; signature: string }[])[0]!;
    const forged = { ...card, signatures: [{ ...sig, protected: b64url(JSON.stringify({ alg: "none", kid: "card-k1", jku: JKU })) }] };
    expect(await verifyAgentCard(forged, opts(keyServer().fetchImpl))).toMatchObject({ ok: false, reason: "malformed" });
  });
});

describe("AC1 — jku from the card is never followed", () => {
  it("a card naming a foreign jku → untrusted_jku, and that URL is NEVER fetched", async () => {
    const k = keyServer();
    const evil = "https://evil.example/.well-known/agent-card-jwks.json";
    const r = await verifyAgentCard(await signed(unsignedCard(), { jku: evil }), opts(k.fetchImpl));
    expect(r).toMatchObject({ ok: false, reason: "untrusted_jku" });
    expect(k.seen).toEqual([]);
  });
  it("the trusted URL is derived from the issuer (a trailing slash on the issuer does not move it)", () => {
    expect(agentCardJwksUri("https://id.broberg.ai/")).toBe(JKU);
  });
});

describe("AC2 — JCS passes RFC 8785's own test vectors", () => {
  it("§3.2.2 numbers", () => {
    const input = JSON.parse('{"numbers": [333333333.33333329, 1E30, 4.50, 2e-3, 0.000000000000000000000000001]}');
    expect(canonicalize(input)).toBe('{"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27]}');
  });
  it("§3.2.2 strings", () => {
    const input = JSON.parse('{"string": "\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/"}');
    expect(canonicalize(input)).toBe('{"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}');
  });
  it("§3.2.2 literals", () => {
    expect(canonicalize(JSON.parse('{"literals": [null, true, false]}'))).toBe('{"literals":[null,true,false]}');
  });
  it("§3.2.3 sorting by UTF-16 code units", () => {
    const input = JSON.parse(
      '{"\\u20ac":"Euro Sign","\\r":"Carriage Return","\\ufb33":"Hebrew Letter Dalet With Dagesh","1":"One","\\ud83d\\ude00":"Emoji: Grinning Face","\\u0080":"Control","\\u00f6":"Latin Small Letter O With Diaeresis"}',
    );
    // Asserted on the STRING: reading it back with JSON.parse would let the
    // engine move the integer-like key "1" to the front again.
    const order = ["\r", "1", "\u0080", "ö", "€", "😀", "דּ"];
    expect(canonicalize(input)).toBe(`{${order.map((k) => `${JSON.stringify(k)}:${JSON.stringify(input[k])}`).join(",")}}`);
  });
  it.each([
    [0, "0"], [-0, "0"], [1e21, "1e+21"], [1e-7, "1e-7"], [9007199254740992, "9007199254740992"],
    [295147905179352830000, "295147905179352830000"], [5e-324, "5e-324"], [-1.5, "-1.5"],
  ])("Appendix B number %s → %s", (n, out) => {
    expect(canonicalize(n)).toBe(out);
  });
  it("non-finite numbers are refused, not serialised as null", () => {
    expect(() => canonicalize({ x: Infinity })).toThrow(SsoError);
    expect(() => canonicalize({ x: NaN })).toThrow(SsoError);
  });
  it("the signature covers the card WITHOUT signatures — signing with signatures inside does not verify", async () => {
    const card = unsignedCard();
    const withSigField = { ...card, signatures: [] };
    const jws = await new FlattenedSign(new TextEncoder().encode(canonicalize(withSigField)))
      .setProtectedHeader({ alg: "EdDSA", kid: "card-k1", typ: "JOSE", jku: JKU })
      .sign(priv);
    const r = await verifyAgentCard({ ...card, signatures: [{ protected: jws.protected, signature: jws.signature }] }, opts(keyServer().fetchImpl));
    expect(r).toMatchObject({ ok: false, reason: "bad_signature" });
  });
});

describe("AC3 — createA2AVerifier: principal_type is required, an agent ticket exposes its card", () => {
  const AUD = "https://components.example";
  async function ticket(claims: Record<string, unknown>) {
    const iat = Math.floor(Date.now() / 1000);
    return new SignJWT({ jti: "t-1", ver: 1, ...claims })
      .setProtectedHeader({ alg: "EdDSA", kid: "k1" })
      .setIssuer(ISS)
      .setAudience(AUD)
      .setIssuedAt(iat)
      .setExpirationTime(iat + 600)
      .sign(priv);
  }
  const verifier = () =>
    createA2AVerifier({
      issuer: ISS,
      audience: AUD,
      jwksUri: `${ISS}/jwks`,
      minRefetchIntervalMs: 0,
      fetchImpl: (async () => Response.json({ keys: [{ ...pub, kid: "k1" }] })) as unknown as typeof fetch,
    });
  const cardUrl = `${ISS}/agents/${AGENT}/agent-card.json`;

  it("an agent ticket → principal with agentCard = the ticket's agent_card", async () => {
    const p = await verifier().verify(await ticket({ sub: AGENT, client_id: AGENT, principal_type: "agent", org: "broberg", owner: "user-1", agent_card: cardUrl }));
    expect([p.type, p.principal, p.clientId, p.agentCard]).toEqual(["agent", AGENT, AGENT, cardUrl]);
  });
  it("a ticket without principal_type is refused", async () => {
    await expect(verifier().verify(await ticket({ sub: AGENT, client_id: AGENT, agent_card: cardUrl }))).rejects.toThrow(/no valid principal_type/);
  });
  it("a ticket with an unknown principal_type is refused", async () => {
    await expect(verifier().verify(await ticket({ sub: AGENT, principal_type: "robot", agent_card: cardUrl }))).rejects.toThrow(/no valid principal_type/);
  });
  it("an agent ticket whose agent_card points anywhere but the issuer's card for THAT agent is refused", async () => {
    for (const bad of ["https://evil.example/card.json", `${ISS}/agents/agent-someone-else/agent-card.json`, undefined]) {
      await expect(verifier().verify(await ticket({ sub: AGENT, principal_type: "agent", ...(bad ? { agent_card: bad } : {}) }))).rejects.toThrow(/agent_card/);
    }
  });
  it("a service ticket → agentCard null (not every principal has a card)", async () => {
    const p = await verifier().verify(await ticket({ sub: "svc-trail", client_id: "svc-trail", principal_type: "service" }));
    expect([p.type, p.agentCard]).toEqual(["service", null]);
  });
});
