/**
 * components-F084.165 — the embedded login and signup from the app's server, against a fake BID
 * that follows broberg-id's written contract (F084.166 v1.1 «web-klient» + F084.167 v1
 * «oprettelse», broberg-ai/broberg-id@022b07b): Basic client auth, client_id in Basic = body,
 * nonce into id_token.nonce, the swap on /oauth2/token with the client's own auth + verifier.
 * A fake agrees with what this file believes the contract is; the live half is measured by jam.
 */
import { describe, expect, test } from "vitest";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { createSsoClient, SsoError } from "../src/client.js";
import { sealEmbeddedFlow, openEmbeddedFlow, type EmbeddedFlow } from "../src/embedded.js";

const ISSUER = "https://id.broberg.ai";
const CLIENT_ID = "jam";
const SECRET = "jam-secret";
const REDIRECT = "https://jam.broberg.ai/auth/callback";
const TERMS = "2026-10-15";

async function challenge(v: string) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)));
  let s = ""; for (const x of d) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** BID per the written contract. Mail code 481072, app 123456, SMS 777777; 5 wrong lock. */
async function contractBid(o: { secondFactor?: boolean; signup?: boolean; nonceOverride?: string } = {}) {
  const pair = await generateKeyPair("RS256", { extractable: true });
  const flows = new Map<string, { challenge: string; nonce: string; email: string; wrong: number; sms: boolean; intent: string; name?: string }>();
  const codes = new Map<string, { challenge: string; nonce: string; sub: string }>();
  const log: { path: string; auth: string | null; body: Record<string, unknown> }[] = [];
  let n = 0;
  const err = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const issue = (f: { challenge: string; nonce: string; email: string }) => { const c = `ac-${++n}`; codes.set(c, { challenge: f.challenge, nonce: f.nonce, sub: `sub-${f.email}` }); return Response.json({ next: "done", code: c }); };
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const headers = new Headers(init?.headers);
    if (url.pathname === "/.well-known/openid-configuration") return Response.json({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/oauth2/authorize`, token_endpoint: `${ISSUER}/oauth2/token`, jwks_uri: `${ISSUER}/jwks`, userinfo_endpoint: `${ISSUER}/oauth2/userinfo` });
    if (url.pathname === "/jwks") return Response.json({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" }] });
    if (url.pathname === "/oauth2/userinfo") return Response.json({ sub: "sub-anne@eksempel.dk", email: "anne@eksempel.dk" });
    if (url.pathname === "/oauth2/token") {
      const p = new URLSearchParams(String(init?.body));
      log.push({ path: url.pathname, auth: headers.get("authorization"), body: Object.fromEntries(p) });
      const c = codes.get(p.get("code") ?? "");
      if (!c || p.get("client_secret") !== SECRET || p.get("redirect_uri") !== REDIRECT || (await challenge(p.get("code_verifier") ?? "")) !== c.challenge) return err(400, { error: "invalid_grant" });
      codes.delete(p.get("code")!);
      const id_token = await new SignJWT({ nonce: o.nonceOverride ?? c.nonce, email: "anne@eksempel.dk" }).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(ISSUER).setAudience(CLIENT_ID).setSubject(c.sub).setIssuedAt().setExpirationTime("1h").sign(pair.privateKey);
      return Response.json({ id_token, access_token: "at-emb", refresh_token: "rt-emb", expires_in: 3600 });
    }
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    log.push({ path: url.pathname, auth: headers.get("authorization"), body });
    // Basic client_id:client_secret, and client_id in Basic = the body's
    const basic = headers.get("authorization")?.match(/^Basic (.+)$/)?.[1];
    const [bid, bsecret] = basic ? atob(basic).split(":") : [];
    if (bsecret !== SECRET || (url.pathname !== "/embedded/terms" && bid !== body.client_id)) return err(401, { error: "invalid_client" });
    if (url.pathname === "/embedded/terms") return Response.json({ version: TERMS, text: "Ved at oprette et BID accepterer du …", links: [{ label: "Privatlivspolitik", url: "https://id.broberg.ai/privatliv" }] });
    if (url.pathname === "/embedded/start") {
      if (body.intent === "signup") {
        if (!o.signup) return err(403, { error: "signup_not_enabled" });
        if (typeof body.name !== "string" || !body.name) return err(400, { error: "invalid_request" });
        if (body.terms_version !== TERMS) return err(400, { error: "terms_outdated", version: TERMS });
      }
      const id = `flow-${++n}`;
      flows.set(id, { challenge: String(body.code_challenge), nonce: String(body.nonce), email: String(body.email), wrong: 0, sms: false, intent: String(body.intent ?? "login"), ...(typeof body.name === "string" ? { name: body.name } : {}) });
      return Response.json({ flow_id: id, expires_in: 600 });
    }
    const f = flows.get(String(body.flow_id));
    if (!f) return err(400, { error: "expired" });
    const wrong = () => (++f.wrong >= 5 ? err(429, { error: "locked", retry_after: 900 }) : err(400, { error: "invalid_code", attempts_left: 5 - f.wrong }));
    if (url.pathname === "/embedded/verify") return body.code !== "481072" ? wrong() : o.secondFactor ? Response.json({ next: "second_factor", methods: ["totp", "sms"] }) : issue(f);
    if (url.pathname === "/embedded/second-factor/sms") { f.sms = true; return Response.json({ sent: true }); }
    if (url.pathname === "/embedded/second-factor") return (body.method === "totp" && body.code === "123456") || (body.method === "sms" && f.sms && body.code === "777777") ? issue(f) : wrong();
    return err(404, {});
  }) as unknown as typeof fetch;
  return { fetchImpl, log, flows };
}
const client = (bid: { fetchImpl: typeof fetch }, secret: string | null = SECRET) =>
  createSsoClient({ issuer: ISSUER, clientId: CLIENT_ID, redirectUri: REDIRECT, scopes: ["openid", "profile", "email"], cookieSecret: "c".repeat(64), ...(secret ? { clientSecret: secret } : {}) } as never, { fetchImpl: bid.fetchImpl });

describe("components-F084.165 — embedded login from the server", () => {
  test("start → verify → the same LoginResult shape as completeLogin; Basic client auth; PKCE + nonce checked end to end", async () => {
    const bid = await contractBid(); const sso = client(bid);
    const s = await sso.embedded.start({ email: "anne@eksempel.dk", endUserIp: "203.0.113.7" });
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect(s.expiresIn).toBe(600);
    const start = bid.log.find((c) => c.path === "/embedded/start")!;
    expect(start.auth).toBe(`Basic ${btoa(`${CLIENT_ID}:${SECRET}`)}`);
    expect(Object.keys(start.body).sort()).toStrictEqual(["client_id", "code_challenge", "code_challenge_method", "email", "end_user_ip", "nonce"]);
    expect(start.body).toMatchObject({ client_id: CLIENT_ID, email: "anne@eksempel.dk", code_challenge_method: "S256", end_user_ip: "203.0.113.7" });
    expect(start.body.code_challenge).toBe(await challenge(s.flow.codeVerifier));
    const step = await sso.embedded.verify(s.flow, "481072");
    expect(step.kind).toBe("done");
    if (step.kind !== "done") return;
    expect(step.result.claims.sub).toBe("sub-anne@eksempel.dk");
    expect(step.result.claims.nonce).toBe(s.flow.nonce);
    expect(Object.keys(step.result).sort()).toStrictEqual(["accessToken", "claims", "expiresIn", "idToken", "refreshToken", "unverifiedClaims"]);
    expect(bid.log.find((c) => c.path === "/oauth2/token")!.body).toMatchObject({ grant_type: "authorization_code", client_id: CLIENT_ID, client_secret: SECRET, redirect_uri: REDIRECT });
  });

  test("second factor by app code and by SMS — each ends in the same result", async () => {
    for (const method of ["totp", "sms"] as const) {
      const bid = await contractBid({ secondFactor: true }); const sso = client(bid);
      const s = await sso.embedded.start({ email: "anne@eksempel.dk" });
      if (!s.ok) throw new Error("start failed");
      expect(await sso.embedded.verify(s.flow, "481072")).toStrictEqual({ kind: "second_factor", methods: ["totp", "sms"] });
      if (method === "sms") expect(await sso.embedded.sendSms(s.flow)).toStrictEqual({ ok: true });
      const step = await sso.embedded.verifySecondFactor(s.flow, method, method === "totp" ? "123456" : "777777");
      expect(step.kind === "done" && step.result.claims.sub).toBe("sub-anne@eksempel.dk");
    }
  });

  test("errors as data: invalid_code{attemptsLeft} → locked{retryAfter}; expired flow", async () => {
    const bid = await contractBid(); const sso = client(bid);
    const s = await sso.embedded.start({ email: "anne@eksempel.dk" });
    if (!s.ok) throw new Error("start failed");
    expect(await sso.embedded.verify(s.flow, "000000")).toStrictEqual({ kind: "error", error: { kind: "invalid_code", attemptsLeft: 4 } });
    for (let i = 0; i < 3; i++) await sso.embedded.verify(s.flow, "000000");
    expect(await sso.embedded.verify(s.flow, "000000")).toStrictEqual({ kind: "error", error: { kind: "locked", retryAfter: 900 } });
    expect(await sso.embedded.verify({ ...s.flow, flowId: "gone" }, "481072")).toStrictEqual({ kind: "error", error: { kind: "expired" } });
  });

  test("errors as data, the rest of the table: too_many_requests{retryAfter}, not_embedded (403/404/405), invalid_request, unavailable (5xx and no answer)", async () => {
    const answering = (status: number, body: object | null) => ({
      fetchImpl: (async () => {
        if (body === null) throw new TypeError("fetch failed");
        return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      }) as unknown as typeof fetch,
    });
    const startWith = async (status: number, body: object | null) => {
      const s = await client(answering(status, body)).embedded.start({ email: "anne@eksempel.dk" });
      if (s.ok) throw new Error(`start ${status} was not an error`);
      return s.error;
    };
    expect(await startWith(429, { error: "too_many_requests", retry_after: 60 })).toStrictEqual({ kind: "too_many_requests", retryAfter: 60 });
    expect(await startWith(403, { error: "client_not_embedded" })).toStrictEqual({ kind: "not_embedded" });
    expect(await startWith(404, {})).toStrictEqual({ kind: "not_embedded" });
    expect(await startWith(405, {})).toStrictEqual({ kind: "not_embedded" });
    expect(await startWith(400, { error: "invalid_request" })).toStrictEqual({ kind: "invalid_request" });
    expect(await startWith(502, { error: "authorize_failed" })).toStrictEqual({ kind: "unavailable", message: "BID answered 502 (authorize_failed)" });
    expect(await startWith(0, null)).toStrictEqual({ kind: "unavailable", message: "BID did not answer: fetch failed" });
  });

  test("NEGATIVE CONTROL: an id_token whose nonce is not this flow's is refused — never a session", async () => {
    const bid = await contractBid({ nonceOverride: "someone-elses-nonce" }); const sso = client(bid);
    const s = await sso.embedded.start({ email: "anne@eksempel.dk" });
    if (!s.ok) throw new Error("start failed");
    await expect(sso.embedded.verify(s.flow, "481072")).rejects.toThrow(/nonce/i);
  });

  test("a wrong client secret is OUR configuration, thrown loudly — never shown to the user as a wrong code; no secret at all refuses before calling BID", async () => {
    const bid = await contractBid();
    await expect(client(bid, "wrong").embedded.start({ email: "anne@eksempel.dk" })).rejects.toThrow(/401 invalid_client/);
    const calls = bid.log.length;
    await expect(client(bid, null).embedded.start({ email: "anne@eksempel.dk" })).rejects.toThrow(SsoError);
    expect(bid.log.length).toBe(calls);
  });
});

describe("components-F084.165 — signup (F084.167)", () => {
  test("terms() gives BID's text verbatim; start with intent signup sends name + terms_version; a stale version → terms_outdated{version}", async () => {
    const bid = await contractBid({ signup: true }); const sso = client(bid);
    expect(await sso.embedded.terms("da")).toStrictEqual({ version: TERMS, text: "Ved at oprette et BID accepterer du …", links: [{ label: "Privatlivspolitik", url: "https://id.broberg.ai/privatliv" }] });
    const ok = await sso.embedded.start({ email: "ny@eksempel.dk", intent: "signup", name: "Ny Bruger", termsVersion: TERMS });
    expect(ok.ok).toBe(true);
    expect(bid.log.filter((c) => c.path === "/embedded/start").at(-1)!.body).toMatchObject({ intent: "signup", name: "Ny Bruger", terms_version: TERMS });
    expect(await sso.embedded.start({ email: "ny@eksempel.dk", intent: "signup", name: "Ny Bruger", termsVersion: "2026-01-01" })).toStrictEqual({ ok: false, error: { kind: "terms_outdated", version: TERMS } });
  });

  test("NEGATIVE CONTROL: a client without signup → signup_not_enabled; a plain login start carries no signup fields", async () => {
    const bid = await contractBid(); const sso = client(bid);
    expect(await sso.embedded.start({ email: "ny@eksempel.dk", intent: "signup", name: "Ny", termsVersion: TERMS })).toStrictEqual({ ok: false, error: { kind: "signup_not_enabled" } });
    await sso.embedded.start({ email: "anne@eksempel.dk" });
    const body = bid.log.filter((c) => c.path === "/embedded/start").at(-1)!.body;
    expect("intent" in body || "name" in body || "terms_version" in body).toBe(false);
  });
});

describe("components-F084.165 — the flow cookie", () => {
  const flow: EmbeddedFlow = { flowId: "flow-1", codeVerifier: "v".repeat(43), nonce: "n".repeat(22), email: "anne@eksempel.dk" };
  test("sealed and opened back strict; tampered → unreadable; older than 10 min → expired; none → absent", async () => {
    const t = { now: 1_800_000_000_000 };
    const sealed = await sealEmbeddedFlow(flow, "k".repeat(64), { now: () => t.now });
    expect(sealed.includes(flow.codeVerifier)).toBe(false);
    expect(await openEmbeddedFlow(sealed, "k".repeat(64), { now: () => t.now })).toStrictEqual({ ok: true, flow });
    expect(await openEmbeddedFlow(sealed.slice(0, -2) + "xx", "k".repeat(64), { now: () => t.now })).toStrictEqual({ ok: false, reason: "unreadable" });
    expect(await openEmbeddedFlow(sealed, "other".repeat(13), { now: () => t.now })).toStrictEqual({ ok: false, reason: "unreadable" });
    t.now += 601_000;
    expect(await openEmbeddedFlow(sealed, "k".repeat(64), { now: () => t.now })).toStrictEqual({ ok: false, reason: "expired" });
    expect(await openEmbeddedFlow(undefined, "k".repeat(64))).toStrictEqual({ ok: false, reason: "absent" });
  });
});
