// F099.24 — the login INSIDE the popup, against a fake BID that follows F084.166 contract v1
// (broberg-ai/broberg-id@f9e148d «KONTRAKT v1»): start → mail code → (second factor) → authorization
// code, swapped on /oauth2/token exactly as after the login window — the same Session.
import { describe, expect, it } from "vitest";
import { createBidAuth, popupAuth, type EmbeddedState, type RuntimeApi } from "../src/auth";
import { contractBid, identity, ISS, memory, REDIRECT, s256 } from "./bid-contract";

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

  it("a BID without the /embedded endpoints (404) is not_embedded — fall back to the window, never «no connection»", async () => {
    const fetchImpl = (async (input: unknown) => String(input).includes("/embedded/") ? new Response("Not Found", { status: 404 }) : contractBid().fetchImpl(input as string)) as typeof fetch;
    const auth = createBidAuth({ issuer: ISS, clientId: "jam-clipper", identity, storage: memory(), fetchImpl });
    expect(strip(await auth.embedded!().start("anne@eksempel.dk"))).toStrictEqual({ step: "email", busy: false, error: { kind: "not_embedded" } });
  });

  it("NEGATIVE CONTROL: a client without embedded login gets not_embedded (fall back to the window), and nothing is stored", async () => {
    const bid = contractBid({ embedded: false }); const { auth, store } = make(bid);
    expect(strip(await auth.embedded!().start("anne@eksempel.dk"))).toStrictEqual({ step: "email", busy: false, error: { kind: "not_embedded" } });
    expect(store.data.size).toBe(0);
  });
});

// F099.25 — passkey login (contract v2, broberg-ai/broberg-id@3c8e6bc «KONTRAKT v2»): BID's frame
// confirms the key and posts to the popup; the engine listens, completes and swaps like the mail code.
describe("F099.25 — passkey login (contract v2)", () => {
  const withWindow = (bid: ReturnType<typeof contractBid>, store = memory(), t = { now: 1_800_000_000_000 }) => {
    const win = new EventTarget() as EventTarget & Pick<Window, "addEventListener" | "removeEventListener">;
    const auth = createBidAuth({ issuer: ISS, clientId: "jam-clipper", identity, storage: store, fetchImpl: bid.fetchImpl, now: () => t.now, messages: win });
    const post = (data: unknown, origin = ISS) => win.dispatchEvent(new MessageEvent("message", { data, origin }));
    return { auth, store, win, post, t };
  };
  /** Let the engine's async answer to a message settle. */
  const settle = async (login: { state(): EmbeddedState }, step: string) => {
    for (let i = 0; i < 50 && (login.state().step !== step || login.state().busy); i++) await new Promise((r) => setTimeout(r, 1));
    return strip(login.state());
  };

  it("passkeyStart → frame → ok from BID → complete → signed in: the SAME session as the mail code, the swap carries the matching verifier", async () => {
    const bid = contractBid(); const { auth, store, post } = withWindow(bid);
    const login = auth.embedded!();
    const s = await login.passkeyStart();
    const start = bid.log.find((c) => c.path === "/embedded/passkey/start")!;
    expect(Object.keys(start.body).sort()).toStrictEqual(["client_id", "code_challenge", "code_challenge_method"]);
    const flowId = [...bid.passkeys.keys()][0]!;
    expect(strip(s)).toStrictEqual({ step: "passkey", frameUrl: `${ISS}/embedded/passkey/frame?flow=${flowId}`, expiresAt: 1_800_000_600_000, busy: false });
    bid.confirmPasskey(flowId); // the user's Face ID, inside BID's frame
    post({ type: "bid-embedded-passkey", flow_id: flowId, ok: true });
    const end = await settle(login, "signed_in");
    expect(end).toStrictEqual({ step: "signed_in", session: { accessToken: "at-emb", sub: "user-42", expiresAt: 1_800_003_600_000 }, busy: false });
    expect(bid.log.find((c) => c.path === "/embedded/passkey/complete")!.body).toStrictEqual({ flow_id: flowId });
    const swap = bid.log.find((c) => c.path === "/oauth2/token")!.body;
    expect(swap).toMatchObject({ grant_type: "authorization_code", client_id: "jam-clipper", redirect_uri: REDIRECT });
    expect(await s256(String(swap.code_verifier))).toBe(start.body.code_challenge);
    expect(store.data.has("broberg-web-clipper:bid:jam-clipper:embedded")).toBe(false);
    expect(await auth.session()).toStrictEqual({ accessToken: "at-emb", sub: "user-42", expiresAt: 1_800_003_600_000 });
  });

  it("cancelled → stays on the passkey step without an error; not_found / failed → error {kind:passkey} on the step; the mail code still works from there", async () => {
    const bid = contractBid(); const { auth, post } = withWindow(bid);
    const login = auth.embedded!();
    await login.passkeyStart();
    const flowId = [...bid.passkeys.keys()][0]!;
    const frameUrl = `${ISS}/embedded/passkey/frame?flow=${flowId}`;
    post({ type: "bid-embedded-passkey", flow_id: flowId, ok: false, error: "cancelled" });
    expect(await settle(login, "passkey")).toStrictEqual({ step: "passkey", frameUrl, expiresAt: 1_800_000_600_000, busy: false });
    post({ type: "bid-embedded-passkey", flow_id: flowId, ok: false, error: "not_found" });
    expect(await settle(login, "passkey")).toStrictEqual({ step: "passkey", frameUrl, expiresAt: 1_800_000_600_000, busy: false, error: { kind: "passkey", reason: "not_found" } });
    post({ type: "bid-embedded-passkey", flow_id: flowId, ok: false, error: "failed" });
    expect(await settle(login, "passkey")).toStrictEqual({ step: "passkey", frameUrl, expiresAt: 1_800_000_600_000, busy: false, error: { kind: "passkey", reason: "failed" } });
    expect(bid.log.some((c) => c.path === "/embedded/passkey/complete")).toBe(false);
    expect(strip(await login.start("anne@eksempel.dk"))).toMatchObject({ step: "code", email: "anne@eksempel.dk" });
    expect((await login.verify("481072")).step).toBe("signed_in");
  });

  it("NEGATIVE CONTROL: a message from another origin, for another flow, or of another type is ignored — no complete call, no session", async () => {
    const bid = contractBid(); const { auth, post } = withWindow(bid);
    const login = auth.embedded!();
    await login.passkeyStart();
    const flowId = [...bid.passkeys.keys()][0]!;
    bid.confirmPasskey(flowId);
    post({ type: "bid-embedded-passkey", flow_id: flowId, ok: true }, "https://evil.example");
    post({ type: "bid-embedded-passkey", flow_id: "pk-someone-else", ok: true });
    post({ type: "something-else", flow_id: flowId, ok: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(login.state().step).toBe("passkey");
    expect(bid.log.some((c) => c.path === "/embedded/passkey/complete")).toBe(false);
    expect(await auth.session()).toBeNull();
  });

  it("a closed popup: resume() brings back the passkey step and listens again; after start(email) the passkey frame's answer is ignored", async () => {
    const bid = contractBid(); const store = memory();
    const first = withWindow(bid, store);
    await first.auth.embedded!().passkeyStart();
    const flowId = [...bid.passkeys.keys()][0]!;
    const again = withWindow(bid, store); // the popup reopened: a new window, the same storage
    const login = again.auth.embedded!();
    expect(strip(await login.resume())).toMatchObject({ step: "passkey", frameUrl: `${ISS}/embedded/passkey/frame?flow=${flowId}` });
    bid.confirmPasskey(flowId);
    again.post({ type: "bid-embedded-passkey", flow_id: flowId, ok: true });
    expect((await settle(login, "signed_in")).step).toBe("signed_in");

    const bid2 = contractBid(); const w2 = withWindow(bid2);
    const l2 = w2.auth.embedded!();
    await l2.passkeyStart();
    const pk = [...bid2.passkeys.keys()][0]!;
    await l2.start("anne@eksempel.dk");
    bid2.confirmPasskey(pk);
    w2.post({ type: "bid-embedded-passkey", flow_id: pk, ok: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(l2.state().step).toBe("code");
    expect(bid2.log.some((c) => c.path === "/embedded/passkey/complete")).toBe(false);
  });

  it("a frame_url off BID's origin is refused — the popup never frames (and grants the passkey permission to) another site", async () => {
    const bid = contractBid();
    const fetchImpl = (async (input: unknown, init?: RequestInit) =>
      new URL(String(input)).pathname === "/embedded/passkey/start" ? Response.json({ flow_id: "pk-x", frame_url: "https://evil.example/frame", expires_in: 600 }) : bid.fetchImpl(input as RequestInfo, init)) as typeof fetch;
    const auth = createBidAuth({ issuer: ISS, clientId: "jam-clipper", identity, storage: memory(), fetchImpl, now: () => 1_800_000_000_000, messages: new EventTarget() as never });
    expect(strip(await auth.embedded!().passkeyStart())).toStrictEqual({ step: "email", busy: false, error: { kind: "unavailable", message: "BID's frame_url is not on BID's origin" } });
  });
});
