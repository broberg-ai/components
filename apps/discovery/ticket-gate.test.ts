import { beforeAll, describe, expect, it } from "vitest";
// F038.24 — Broberg ID tickets as a THIRD door (broberg-id-F087.5). Real EdDSA
// tickets, verified by the real @broberg/sso verifier against a key set this test
// serves; only the network is faked.
process.env.ENROLL_DB_URL = ":memory:";

import { SignJWT, exportJWK, generateKeyPair, type CryptoKey, type JWK } from "jose";
import { createTicketVerifier } from "@broberg/sso";
import { createHash } from "node:crypto";
const { app, setTicketVerifierForTests } = await import("./server");
const { getEnrollStore } = await import("./enroll");

const ISS = "https://id.broberg.ai";
const AUD = "https://discovery.broberg.ai";
const JWKS = `${ISS}/jwks`;
let priv: CryptoKey;
let pub: JWK;
let bidUp = true;
let kid = "k1";

beforeAll(async () => {
  const pair = await generateKeyPair("EdDSA", { extractable: true });
  priv = pair.privateKey;
  pub = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "EdDSA", use: "sig" };
  const fetchImpl = (async (url: string) => {
    if (!bidUp) throw new TypeError("fetch failed");
    return url === JWKS ? Response.json({ keys: [pub] }) : new Response("no", { status: 404 });
  }) as unknown as typeof fetch;
  setTicketVerifierForTests(createTicketVerifier({ issuer: ISS, audience: AUD, jwksUri: JWKS, fetchImpl, minRefetchIntervalMs: 0 }));
});

const ticket = async (claims: Record<string, unknown> = {}, aud = AUD) => {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ sub: "svc:broberg-id", client_id: "svc:broberg-id", principal_type: "service", scope: "discovery:read", jti: crypto.randomUUID(), ...claims })
    .setProtectedHeader({ alg: "EdDSA", kid })
    .setIssuer(ISS).setAudience(aud).setIssuedAt(now).setExpirationTime(now + 300)
    .sign(priv);
};
const bearer = (t: string, extra: Record<string, string> = {}) => ({ headers: { authorization: `Bearer ${t}`, ...extra } });

describe("AC0 — the fleet layer with a ticket", () => {
  it("discovery:read for this audience gets in", async () => {
    const res = await app.request("/api/fleet", bearer(await ticket()));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });
  it("without the scope → 401 naming it", async () => {
    const res = await app.request("/api/fleet", bearer(await ticket({ scope: "discovery:enroll" })));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/lacks scope discovery:read/);
  });
  it("a ticket for another service → 401", async () => {
    const res = await app.request("/api/fleet", bearer(await ticket({}, "https://cardmem.broberg.ai")));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/^ticket_rejected/);
  });
  it("garbage after Bearer → 401, and it does NOT fall through to the key door", async () => {
    const sha = (k: string) => createHash("sha256").update(k).digest("hex");
    await (await getEnrollStore())!.bindSessionKey("keyed", sha("k".repeat(64)));
    const res = await app.request("/api/fleet", bearer("not-a-jwt", { "x-discovery-session": "keyed", "x-enroll-key": "k".repeat(64) }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/^ticket_rejected/);
  });
  it("BID unreachable and an unknown key → 503, not a rejection", async () => {
    kid = "k-unknown";
    bidUp = false;
    try {
      const res = await app.request("/api/fleet", bearer(await ticket()));
      expect(res.status).toBe(503);
      expect((await res.json()).error).toMatch(/^ticket_unverifiable_now/);
    } finally {
      kid = "k1";
      bidUp = true;
    }
  });
});

describe("AC1 — enroll with a ticket enrolls only itself", () => {
  const enroll = async (t: string, body: Record<string, unknown>) =>
    app.request("/api/enroll", { method: "POST", headers: { authorization: `Bearer ${t}`, "content-type": "application/json" }, body: JSON.stringify(body) });

  it("discovery:enroll + no session in body → the ticket's subject is enrolled; read back from the store", async () => {
    const res = await enroll(await ticket({ scope: "discovery:enroll" }), { pkg: "@broberg/sso", version: "0.13.0" });
    expect(res.status).toBe(200);
    expect((await res.json()).key).toBe("ticket");
    const rows = (await (await getEnrollStore())!.list()).filter((r: { session: string; pkg: string }) => r.session === "svc:broberg-id" && r.pkg === "@broberg/sso");
    expect(rows.map((r: { version: string }) => r.version)).toEqual(["0.13.0"]);
  });
  it("a ticket naming ANOTHER session in the body → 403, nothing written", async () => {
    const res = await enroll(await ticket({ scope: "discovery:enroll" }), { session: "cardmem", pkg: "@broberg/mail", version: "9.9.9" });
    expect(res.status).toBe(403);
    const rows = (await (await getEnrollStore())!.list()).filter((r: { session: string; version: string }) => r.session === "cardmem" && r.version === "9.9.9");
    expect(rows).toEqual([]);
  });
  it("discovery:read is not enough to enroll", async () => {
    const res = await enroll(await ticket({ scope: "discovery:read" }), { pkg: "@broberg/sso", version: "0.13.0" });
    expect(res.status).toBe(401);
  });
});

describe("AC2 — the other doors are unchanged, and dictionary edit takes no tickets", () => {
  it("a registered session key still reads the fleet layer", async () => {
    const sha = (k: string) => createHash("sha256").update(k).digest("hex");
    await (await getEnrollStore())!.bindSessionKey("keyed2", sha("q".repeat(64)));
    const res = await app.request("/api/fleet", { headers: { "x-discovery-session": "keyed2", "x-enroll-key": "q".repeat(64) } });
    expect(res.status).toBe(200);
  });
  it("speech-dictionary edit with only a ticket is refused AT THE AUTH CHECK", async () => {
    // Configured, so the request reaches the editor check — otherwise a 503
    // "unconfigured" would pass this test without proving anything about tickets.
    process.env.GITHUB_WRITE_TOKEN = "test-not-used";
    const res = await app.request("/api/speech-dictionary/edit", {
      method: "POST",
      headers: { authorization: `Bearer ${await ticket({ scope: "discovery:read discovery:enroll discovery:dictionary-edit" })}`, "content-type": "application/json" },
      body: JSON.stringify({ session: "svc:broberg-id", addTerms: ["x"] }),
    });
    delete process.env.GITHUB_WRITE_TOKEN;
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/x-speech-dict-key required/);
  });
});
