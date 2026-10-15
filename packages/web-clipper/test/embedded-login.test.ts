// F099.24 — the login INSIDE the popup, against a fake BID that follows F084.166 contract v1
// (broberg-ai/broberg-id@f9e148d «KONTRAKT v1»): start → mail code → (second factor) → authorization
// code, swapped on /oauth2/token exactly as after the login window — the same Session.
import { describe, expect, it } from "vitest";
import { createBidAuth, popupAuth, type EmbeddedState, type IdentityApi, type KeyValueStorage, type RuntimeApi } from "../src/auth";

const ISS = "https://id.broberg.ai";
const REDIRECT = "https://abcdefghijklmnop.chromiumapp.org/";
const jwt = (payload: object) => `x.${btoa(JSON.stringify(payload)).replace(/=+$/, "")}.y`;
const identity: IdentityApi = { getRedirectURL: () => REDIRECT, launchWebAuthFlow: async () => { throw new Error("no window in the embedded login"); } };
function memory(): KeyValueStorage & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return { data, get: async (k) => data.get(k), set: async (k, v) => void data.set(k, v), remove: async (k) => void data.delete(k) };
}
async function s256(v: string) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)));
  let s = ""; for (const x of d) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** BID per contract v1: the mail code is 481072, the app code 123456, the SMS code 777777; 5 wrong codes lock the flow. */
function contractBid(o: { secondFactor?: ("totp" | "sms")[]; embedded?: boolean } = {}) {
  const flows = new Map<string, { email: string; challenge: string; wrong: number; stage: "code" | "second"; smsSent: boolean }>();
  const codes = new Map<string, string>(); // authorization code → challenge
  const log: { path: string; body: Record<string, unknown>; credentials?: RequestCredentials }[] = [];
  let n = 0;
  const err = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const issue = (challenge: string) => { const c = `ac-${++n}`; codes.set(c, challenge); return Response.json({ next: "done", code: c }); };
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === "/.well-known/openid-configuration") return Response.json({ issuer: ISS, authorization_endpoint: `${ISS}/oauth2/authorize`, token_endpoint: `${ISS}/oauth2/token` });
    if (url.pathname === "/oauth2/token") {
      const p = new URLSearchParams(String(init?.body));
      log.push({ path: url.pathname, body: Object.fromEntries(p), credentials: init?.credentials });
      const challenge = codes.get(p.get("code") ?? "");
      if (!challenge || (await s256(p.get("code_verifier") ?? "")) !== challenge || p.get("redirect_uri") !== REDIRECT) return err(400, { error: "invalid_grant" });
      codes.delete(p.get("code")!);
      return Response.json({ access_token: "at-emb", refresh_token: "rt-emb", expires_in: 3600, id_token: jwt({ sub: "user-42" }) });
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    log.push({ path: url.pathname, body, credentials: init?.credentials });
    if (o.embedded === false) return err(403, { error: "client_not_embedded" });
    if (url.pathname === "/embedded/start") {
      if (typeof body.email !== "string" || body.code_challenge_method !== "S256") return err(400, { error: "invalid_request" });
      const id = `flow-${++n}`;
      flows.set(id, { email: body.email, challenge: String(body.code_challenge), wrong: 0, stage: "code", smsSent: false });
      return Response.json({ flow_id: id, expires_in: 600 });
    }
    const f = flows.get(String(body.flow_id));
    if (!f) return err(400, { error: "expired" });
    const wrong = () => { f.wrong++; return f.wrong >= 5 ? err(429, { error: "locked", retry_after: 900 }) : err(400, { error: "invalid_code", attempts_left: 5 - f.wrong }); };
    if (url.pathname === "/embedded/verify") {
      if (body.code !== "481072") return wrong();
      if (o.secondFactor?.length) { f.stage = "second"; f.wrong = 0; return Response.json({ next: "second_factor", methods: o.secondFactor }); }
      return issue(f.challenge);
    }
    if (url.pathname === "/embedded/second-factor/sms") { f.smsSent = true; return Response.json({ sent: true }); }
    if (url.pathname === "/embedded/second-factor") {
      const ok = (body.method === "totp" && body.code === "123456") || (body.method === "sms" && f.smsSent && body.code === "777777");
      return ok ? issue(f.challenge) : wrong();
    }
    return err(404, {});
  }) as typeof fetch;
  return { fetchImpl, log, flows };
}
const make = (bid: ReturnType<typeof contractBid>, store = memory(), t = { now: 1_800_000_000_000 }) =>
  ({ auth: createBidAuth({ issuer: ISS, clientId: "jam-clipper", identity, storage: store, fetchImpl: bid.fetchImpl, now: () => t.now }), store, t });
const strip = (s: EmbeddedState) => JSON.parse(JSON.stringify(s));

describe("F099.24 — embedded login (contract v1)", () => {
  it("email → code → signed in: start carries client, email and an S256 challenge; the code swap carries the matching verifier and the registered redirect; the SAME stored session as the window login", async () => {
    const bid = contractBid(); const { auth, store } = make(bid);
    const login = auth.embedded!();
    const seen: string[] = [];
    login.subscribe((s) => seen.push(`${s.step}${s.busy ? "…" : ""}`));
    expect(strip(await login.start("anne@eksempel.dk"))).toStrictEqual({ step: "code", email: "anne@eksempel.dk", expiresAt: 1_800_000_600_000, busy: false });
    const start = bid.log.find((c) => c.path === "/embedded/start")!;
    expect(Object.keys(start.body).sort()).toStrictEqual(["client_id", "code_challenge", "code_challenge_method", "email"]);
    expect(start.body).toMatchObject({ client_id: "jam-clipper", email: "anne@eksempel.dk", code_challenge_method: "S256" });
    const end = await login.verify("481072");
    expect(end.step).toBe("signed_in");
    expect(end.step === "signed_in" && end.session).toStrictEqual({ accessToken: "at-emb", sub: "user-42", expiresAt: 1_800_003_600_000 });
    const swap = bid.log.find((c) => c.path === "/oauth2/token")!.body;
    expect(swap).toMatchObject({ grant_type: "authorization_code", client_id: "jam-clipper", redirect_uri: REDIRECT });
    expect(await s256(String(swap.code_verifier))).toBe(start.body.code_challenge);
    expect(store.data.get("broberg-web-clipper:bid:jam-clipper")).toMatchObject({ accessToken: "at-emb", refreshToken: "rt-emb", sub: "user-42" });
    expect(store.data.has("broberg-web-clipper:bid:jam-clipper:embedded")).toBe(false);
    expect(await auth.session()).toStrictEqual({ accessToken: "at-emb", sub: "user-42", expiresAt: 1_800_003_600_000 });
    expect(seen).toStrictEqual(["email…", "code", "code…", "signed_in"]);
    expect(bid.log.every((c) => c.credentials === "omit")).toBe(true);
  });

  it("second factor: app code, or SMS after asking for it — each ends in the same session", async () => {
    for (const method of ["totp", "sms"] as const) {
      const bid = contractBid({ secondFactor: ["totp", "sms"] }); const { auth } = make(bid);
      const login = auth.embedded!();
      await login.start("anne@eksempel.dk");
      expect(strip(await login.verify("481072"))).toStrictEqual({ step: "second_factor", email: "anne@eksempel.dk", methods: ["totp", "sms"], smsSent: false, busy: false });
      if (method === "sms") expect(strip(await login.sendSms())).toMatchObject({ step: "second_factor", smsSent: true });
      const end = await login.verifySecondFactor(method, method === "totp" ? "123456" : "777777");
      expect(end.step === "signed_in" && end.session.sub).toBe("user-42");
    }
  });

  it("wrong code → stays on the step with attemptsLeft; the fifth locks the flow → back to email with retryAfter, no session", async () => {
    const bid = contractBid(); const { auth } = make(bid);
    const login = auth.embedded!();
    await login.start("anne@eksempel.dk");
    expect(strip(await login.verify("000000"))).toStrictEqual({ step: "code", email: "anne@eksempel.dk", expiresAt: 1_800_000_600_000, busy: false, error: { kind: "invalid_code", attemptsLeft: 4 } });
    for (let i = 0; i < 3; i++) await login.verify("000000");
    expect(strip(await login.verify("000000"))).toStrictEqual({ step: "email", busy: false, error: { kind: "locked", retryAfter: 900 } });
    expect(await auth.session()).toBeNull();
  });

  it("a closed popup: the flow survives in storage and resume() puts the user back on the code step; an expired flow says so", async () => {
    const bid = contractBid(); const store = memory(); const t = { now: 1_800_000_000_000 };
    await make(bid, store, t).auth.embedded!().start("anne@eksempel.dk");
    const reopened = make(bid, store, t).auth.embedded!(); // a new popup, same storage
    expect(strip(await reopened.resume())).toStrictEqual({ step: "code", email: "anne@eksempel.dk", expiresAt: 1_800_000_600_000, busy: false });
    expect((await reopened.verify("481072")).step).toBe("signed_in");
    const late = make(bid, store, t);
    await late.auth.embedded!().start("bo@eksempel.dk");
    t.now += 601_000;
    expect(strip(await make(bid, store, t).auth.embedded!().resume())).toStrictEqual({ step: "email", busy: false, error: { kind: "expired" } });
  });

  it("popupAuth passes the embedded login through (it runs in the popup — no background, no window)", async () => {
    const bid = contractBid(); const { auth } = make(bid);
    const runtime: RuntimeApi = { sendMessage: async () => { throw new Error("must not be used"); }, onMessage: { addListener: () => {} } };
    const login = popupAuth(auth, runtime).embedded!();
    await login.start("anne@eksempel.dk");
    expect((await login.verify("481072")).step).toBe("signed_in");
  });

  it("NEGATIVE CONTROL: a client without embedded login gets not_embedded (fall back to the window), and nothing is stored", async () => {
    const bid = contractBid({ embedded: false }); const { auth, store } = make(bid);
    expect(strip(await auth.embedded!().start("anne@eksempel.dk"))).toStrictEqual({ step: "email", busy: false, error: { kind: "not_embedded" } });
    expect(store.data.size).toBe(0);
  });
});
