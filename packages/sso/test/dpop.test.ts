// F084.157 — DPoP (broberg-id-F087.16). One test per refusal branch: a verifier
// that accepts too much looks exactly like one that works, until a copied ticket
// is used from somewhere else.
import { beforeAll, describe, expect, it } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey, type JWK } from "jose";
import {
  createDpopKey,
  createDpopProof,
  createMemoryReplayStore,
  createTicketClient,
  createTicketVerifier,
  verifyDpopProof,
  type DpopKey,
} from "../src/index";

const ISS = "https://id.broberg.ai";
const AUD = "https://discovery.broberg.ai";
const URL_ = "https://discovery.broberg.ai/api/packages";
let priv: CryptoKey;
let pub: JWK;
let holder: DpopKey;
let thief: DpopKey;
beforeAll(async () => {
  const pair = await generateKeyPair("EdDSA", { extractable: true });
  priv = pair.privateKey;
  pub = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "EdDSA", use: "sig" };
  holder = await createDpopKey();
  thief = await createDpopKey();
});
async function ticket(claims: Record<string, unknown> = {}) {
  const iat = Math.floor(Date.now() / 1000);
  return new SignJWT({ sub: "svc-a", client_id: "svc-a", principal_type: "service", scope: "discovery:read", jti: crypto.randomUUID(), ...claims })
    .setProtectedHeader({ alg: "EdDSA", kid: "k1" })
    .setIssuer(ISS)
    .setAudience(AUD)
    .setIssuedAt(iat)
    .setExpirationTime(iat + 300)
    .sign(priv);
}
const verifier = (extra: Record<string, unknown> = {}) =>
  createTicketVerifier({
    issuer: ISS,
    audience: AUD,
    jwksUri: `${ISS}/jwks`,
    minRefetchIntervalMs: 0,
    fetchImpl: (async () => Response.json({ keys: [pub] })) as unknown as typeof fetch,
    ...extra,
  });
const bound = () => ticket({ cnf: { jkt: holder.jkt } });
const proof = (t: string, o: { key?: DpopKey; method?: string; url?: string; now?: () => number } = {}) =>
  createDpopProof(o.key ?? holder, { method: o.method ?? "GET", url: o.url ?? URL_, ticket: t, now: o.now });

describe("AC1 — a valid proof is accepted; each wrong one is refused on its own", () => {
  it("valid proof → principal with cnf.jkt", async () => {
    const t = await bound();
    const p = await verifier().verify(t, { dpop: { proof: await proof(t), method: "GET", url: URL_ } });
    expect(p.cnf).toEqual({ jkt: holder.jkt });
  });

  it("htu is compared without query and fragment", async () => {
    const t = await bound();
    await expect(verifier().verify(t, { dpop: { proof: await proof(t, { url: `${URL_}?a=1` }), method: "GET", url: `${URL_}?b=2#x` } })).resolves.toBeTruthy();
  });

  it("a tampered proof (signature no longer matches) is refused", async () => {
    const t = await bound();
    const [h, pl, sig] = (await proof(t)).split(".");
    const forged = JSON.parse(Buffer.from(pl!, "base64url").toString());
    forged.htm = "POST";
    const bad = `${h}.${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${sig}`;
    await expect(verifier().verify(t, { dpop: { proof: bad, method: "POST", url: URL_ } })).rejects.toThrow(/signature rejected/);
  });

  it("a proof signed by ANOTHER key (the copied-ticket case) is refused", async () => {
    const t = await bound();
    await expect(verifier().verify(t, { dpop: { proof: await proof(t, { key: thief }), method: "GET", url: URL_ } })).rejects.toThrow(/does not match the ticket's cnf.jkt/);
  });

  it("wrong method is refused", async () => {
    const t = await bound();
    await expect(verifier().verify(t, { dpop: { proof: await proof(t), method: "POST", url: URL_ } })).rejects.toThrow(/proof is for "GET", the request is POST/);
  });

  it("wrong URL is refused", async () => {
    const t = await bound();
    await expect(verifier().verify(t, { dpop: { proof: await proof(t), method: "GET", url: `${AUD}/api/other` } })).rejects.toThrow(/proof is for .*packages, the request is .*other/);
  });

  it("iat outside ±60 s is refused (both directions)", async () => {
    const t = await bound();
    for (const skew of [-61_000, 61_000]) {
      const p = await proof(t, { now: () => Date.now() + skew });
      await expect(verifier().verify(t, { dpop: { proof: p, method: "GET", url: URL_ } })).rejects.toThrow(/iat is outside ±60s/);
    }
  });

  it("a proof made for a DIFFERENT ticket (ath) is refused", async () => {
    const t = await bound();
    const other = await bound();
    await expect(verifier().verify(t, { dpop: { proof: await proof(other), method: "GET", url: URL_ } })).rejects.toThrow(/ath does not match/);
  });

  it("the same proof twice is refused the second time (jti replay)", async () => {
    const v = verifier();
    const t = await bound();
    const p = await proof(t);
    await v.verify(t, { dpop: { proof: p, method: "GET", url: URL_ } });
    await expect(v.verify(t, { dpop: { proof: p, method: "GET", url: URL_ } })).rejects.toThrow(/already used/);
  });

  it("a shared replay store catches a replay across two verifiers (two machines)", async () => {
    const replayStore = createMemoryReplayStore();
    const t = await bound();
    const p = await proof(t);
    await verifier({ replayStore }).verify(t, { dpop: { proof: p, method: "GET", url: URL_ } });
    await expect(verifier({ replayStore }).verify(t, { dpop: { proof: p, method: "GET", url: URL_ } })).rejects.toThrow(/already used/);
  });
});

describe("AC2 — bound tickets always need a proof; requireDpop is about the unbound ones", () => {
  it("a BOUND ticket without a proof is refused even WITHOUT requireDpop", async () => {
    await expect(verifier().verify(await bound())).rejects.toThrow(/DPoP-bound \(cnf.jkt\) but no DPoP proof/);
  });

  it("an unbound ticket passes without requireDpop and is refused with it", async () => {
    const t = await ticket();
    await expect(verifier().verify(t)).resolves.toMatchObject({ cnf: null });
    await expect(verifier({ requireDpop: true }).verify(t)).rejects.toThrow(/requires DPoP; the ticket is not bound/);
  });

  it("with requireDpop, a cnf without a string jkt is refused (not read as unbound)", async () => {
    const t = await ticket({ cnf: { x5t: "abc" } });
    await expect(verifier({ requireDpop: true }).verify(t)).rejects.toThrow(/cnf without a string jkt/);
    await expect(verifier().verify(t)).resolves.toMatchObject({ cnf: null }); // unchanged without it
  });
});

describe("AC0 — the calling side", () => {
  const tokenUrl = `${ISS}/oauth2/token`;
  function fakeBid(issued: () => Promise<string>) {
    const calls: { headers: Record<string, string> }[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit = {}) => {
      calls.push({ headers: { ...((init.headers ?? {}) as Record<string, string>) } });
      return Response.json({ access_token: await issued(), token_type: "DPoP", expires_in: 300 });
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }

  it("without dpop: no DPoP header to BID, and authHeaders is Bearer — exactly as before", async () => {
    const bid = fakeBid(() => ticket());
    const c = createTicketClient({ env: {}, onFly: () => true, flyOidc: async () => "fly", fetchImpl: bid.fetchImpl });
    const h = await c.authHeaders({ audience: "discovery", method: "GET", url: URL_ });
    expect(Object.keys(h)).toEqual(["authorization"]);
    expect(h.authorization).toMatch(/^Bearer /);
    expect(bid.calls[0]!.headers.dpop).toBeUndefined();
  });

  it("with dpop: BID gets a proof for POST <issuer>/oauth2/token; the receiver accepts authHeaders' DPoP ticket + proof", async () => {
    let jkt = "";
    const bid = fakeBid(async () => ticket({ cnf: { jkt } }));
    // BID binds to the key in the proof it receives — read it the way BID would.
    const origFetch = bid.fetchImpl;
    const sniff = (async (url: string, init: RequestInit = {}) => {
      const p = (init.headers as Record<string, string>).dpop!;
      const header = JSON.parse(Buffer.from(p.split(".")[0]!, "base64url").toString());
      const { calculateJwkThumbprint } = await import("jose");
      jkt = await calculateJwkThumbprint(header.jwk);
      return origFetch(url, init);
    }) as unknown as typeof fetch;
    const c = createTicketClient({ env: {}, onFly: () => true, flyOidc: async () => "fly", fetchImpl: sniff, dpop: true });
    const h = await c.authHeaders({ audience: "discovery", method: "GET", url: URL_ });
    expect(h.authorization).toMatch(/^DPoP /);
    const t = h.authorization.slice("DPoP ".length);
    // The token-endpoint proof: htm POST, htu the token URL, no ath.
    const tokenProof = bid.calls.at(-1)!.headers.dpop!;
    const tp = JSON.parse(Buffer.from(tokenProof.split(".")[1]!, "base64url").toString());
    expect([tp.htm, tp.htu, "ath" in tp]).toEqual(["POST", tokenUrl, false]);
    // The receiver: the real verifier, with the request's DPoP header.
    const p = await verifier().verify(t, { dpop: { proof: h.dpop, method: "GET", url: URL_ } });
    expect(p.cnf).toEqual({ jkt });
  });

  it("the private key cannot be exported", async () => {
    const k = await createDpopKey();
    await expect(crypto.subtle.exportKey("jwk", k.privateKey)).rejects.toBeTruthy();
    expect(Object.keys(k.publicJwk).sort()).toEqual(["crv", "kty", "x", "y"]);
  });

  it("verifyDpopProof refuses a proof whose jwk carries a private key", async () => {
    const { privateKey } = await generateKeyPair("ES256", { extractable: true });
    const leaky = await exportJWK(privateKey);
    const p = await new SignJWT({ jti: "j", htm: "GET", htu: URL_, iat: Math.floor(Date.now() / 1000) })
      .setProtectedHeader({ typ: "dpop+jwt", alg: "ES256", jwk: leaky })
      .sign(privateKey);
    await expect(
      verifyDpopProof(p, { method: "GET", url: URL_, ticket: "t", jkt: "x", replay: createMemoryReplayStore(), iatWindowSec: 60, now: Date.now }),
    ).rejects.toThrow(/contains a private key/);
  });
});
