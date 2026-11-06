/**
 * components-F084.186 — the embedded passkey login, both halves, against a fake BID that follows
 * the contract bid MEASURED in broberg-id src/embedded-login.ts (#48995, 6 Nov 2026):
 * start {client_id, code_challenge, S256, nonce, redirect_uri} → {flow_id, frame_url, expires_in};
 * the frame posts {type:"bid-embedded-passkey", flow_id, ok, error?} from https://id.broberg.ai;
 * complete {client_id, flow_id} → {next:"done", code}; the swap on /oauth2/token with the
 * client's own auth + verifier, and the nonce lands in id_token.
 * A fake agrees with what this file believes the contract is — the live half is fysio.work's.
 */
import { describe, expect, test } from "vitest";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { createSsoClient, SsoError } from "../src/client.js";
import { sealEmbeddedPasskeyFlow, openEmbeddedPasskeyFlow } from "../src/embedded.js";
import { EmbeddedPasskeyError, loginWithEmbeddedPasskey, type EmbeddedPasskeyBrowserStart } from "../src/embedded-passkey.js";

const ISSUER = "https://id.broberg.ai";
const CLIENT_ID = "fysio-work-app";
const SECRET = "fw-secret";
const REDIRECT = "https://app.fysio.work/auth/callback";

async function challenge(v: string) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)));
  let s = ""; for (const x of d) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** BID per #48995. The browser calls /embedded/passkey/*; the server calls /oauth2/token. */
async function contractBid(o: { nonceOverride?: string; frameOrigin?: string; startStatus?: number } = {}) {
  const pair = await generateKeyPair("RS256", { extractable: true });
  const flows = new Map<string, { challenge: string; nonce: string; redirect: string; confirmed: boolean }>();
  const codes = new Map<string, { challenge: string; nonce: string; redirect: string }>();
  const log: { path: string; body: Record<string, unknown> }[] = [];
  let n = 0;
  const err = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (url.pathname === "/.well-known/openid-configuration") return Response.json({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/oauth2/authorize`, token_endpoint: `${ISSUER}/oauth2/token`, jwks_uri: `${ISSUER}/jwks`, userinfo_endpoint: `${ISSUER}/oauth2/userinfo` });
    if (url.pathname === "/jwks") return Response.json({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" }] });
    if (url.pathname === "/oauth2/token") {
      const p = new URLSearchParams(String(init?.body));
      log.push({ path: url.pathname, body: Object.fromEntries(p) });
      const c = codes.get(p.get("code") ?? "");
      if (!c || p.get("client_secret") !== SECRET || p.get("redirect_uri") !== c.redirect || (await challenge(p.get("code_verifier") ?? "")) !== c.challenge) return err(400, { error: "invalid_grant" });
      codes.delete(p.get("code")!);
      const id_token = await new SignJWT({ nonce: o.nonceOverride ?? c.nonce, email: "anne@klinik.dk" }).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(ISSUER).setAudience(CLIENT_ID).setSubject("sub-anne").setIssuedAt().setExpirationTime("1h").sign(pair.privateKey);
      return Response.json({ id_token, access_token: "at-pk", expires_in: 3600 });
    }
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    log.push({ path: url.pathname, body });
    if (url.pathname === "/embedded/passkey/start") {
      if (o.startStatus) return err(o.startStatus, { error: "invalid_redirect_uri" });
      const id = `pk-${++n}`;
      flows.set(id, { challenge: String(body.code_challenge), nonce: String(body.nonce), redirect: String(body.redirect_uri), confirmed: false });
      return Response.json({ flow_id: id, frame_url: `${o.frameOrigin ?? ISSUER}/embedded/passkey-frame?flow_id=${id}`, expires_in: 600 });
    }
    if (url.pathname === "/embedded/passkey/complete") {
      const f = flows.get(String(body.flow_id));
      if (!f || !f.confirmed) return err(400, { error: "invalid_request" });
      const code = `ac-${++n}`;
      codes.set(code, { challenge: f.challenge, nonce: f.nonce, redirect: f.redirect });
      return Response.json({ next: "done", code });
    }
    return err(404, {});
  }) as unknown as typeof fetch;
  /** What the frame does when the user touches the key: BID marks the flow, the frame posts. */
  const confirm = (flowId: string) => { flows.get(flowId)!.confirmed = true; };
  return { fetchImpl, log, flows, confirm, mintForeignCode: async (verifier: string, nonce: string) => { const c = `foreign-${++n}`; codes.set(c, { challenge: await challenge(verifier), nonce, redirect: REDIRECT }); return c; } };
}

const server = (bid: { fetchImpl: typeof fetch }) =>
  createSsoClient({ issuer: ISSUER, clientId: CLIENT_ID, redirectUri: REDIRECT, scopes: ["openid", "profile", "email"], cookieSecret: "c".repeat(64), clientSecret: SECRET } as never, { fetchImpl: bid.fetchImpl });

/** A page: a window that dispatches messages, a document that makes frames, a container. */
function page() {
  const listeners = new Set<(e: MessageEvent) => void>();
  const frames: { src: string; title: string; attrs: Record<string, string>; removed: boolean }[] = [];
  const timers = new Map<number, () => void>();
  let t = 0;
  const win = {
    addEventListener: (_: string, fn: (e: MessageEvent) => void) => void listeners.add(fn),
    removeEventListener: (_: string, fn: (e: MessageEvent) => void) => void listeners.delete(fn),
    setTimeout: (fn: () => void) => { timers.set(++t, fn); return t; },
    clearTimeout: (id: number) => void timers.delete(id),
  };
  const doc = {
    createElement: () => {
      const f = { src: "", title: "", attrs: {} as Record<string, string>, removed: false, setAttribute(k: string, v: string) { this.attrs[k] = v; }, remove() { this.removed = true; } };
      frames.push(f);
      return f;
    },
  };
  const container = { appendChild: () => {} };
  const post = (origin: string, data: unknown) => { for (const fn of [...listeners]) fn({ origin, data } as MessageEvent); };
  const fireTimers = () => { for (const fn of [...timers.values()]) fn(); };
  return { win, doc, container, frames, listeners, post, fireTimers };
}

const opts = (p: ReturnType<typeof page>, bid: { fetchImpl: typeof fetch }, extra: Record<string, unknown> = {}) =>
  ({ container: p.container as unknown as HTMLElement, window: p.win as never, document: p.doc as never, fetch: bid.fetchImpl, ...extra });

/** Wait until the frame is shown, then return its flow id. */
async function shown(p: ReturnType<typeof page>) {
  for (let i = 0; i < 50 && p.frames.length === 0; i++) await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 50 && p.listeners.size === 0; i++) await new Promise((r) => setTimeout(r, 0));
  return new URL(p.frames[0]!.src).searchParams.get("flow_id")!;
}

describe("components-F084.186 — embedded passkey login", () => {
  test("begin → browser (start, frame, complete) → server complete: the same LoginResult; the browser never sees the verifier", async () => {
    const bid = await contractBid(); const sso = server(bid); const p = page();
    const { browser, flow } = await sso.embeddedPasskey.begin();
    expect(Object.keys(browser).sort()).toStrictEqual(["clientId", "codeChallenge", "issuer", "nonce", "redirectUri"]);
    expect(JSON.stringify(browser)).not.toContain(flow.codeVerifier);
    expect(browser.codeChallenge).toBe(await challenge(flow.codeVerifier));

    const running = loginWithEmbeddedPasskey(browser, opts(p, bid));
    const flowId = await shown(p);
    expect(p.frames[0]!.attrs).toEqual({ allow: "publickey-credentials-get", "data-testid": "embedded-passkey-frame" });
    bid.confirm(flowId);
    p.post(ISSUER, { type: "bid-embedded-passkey", flow_id: flowId, ok: true });
    const { code } = await running;

    const start = bid.log.find((c) => c.path === "/embedded/passkey/start")!;
    expect(start.body).toStrictEqual({ client_id: CLIENT_ID, code_challenge: browser.codeChallenge, code_challenge_method: "S256", nonce: browser.nonce, redirect_uri: REDIRECT });
    expect(bid.log.find((c) => c.path === "/embedded/passkey/complete")!.body).toStrictEqual({ client_id: CLIENT_ID, flow_id: flowId });
    expect(p.frames[0]!.removed).toBe(true);
    expect(p.listeners.size).toBe(0);

    const result = await sso.embeddedPasskey.complete({ code, flow });
    expect(result.claims.sub).toBe("sub-anne");
    const swap = bid.log.find((c) => c.path === "/oauth2/token")!.body;
    expect(swap.code_verifier).toBe(flow.codeVerifier);
    expect(swap.redirect_uri).toBe(REDIRECT);
  });

  test("LOGIN CSRF: an attacker's code (minted for the attacker's own verifier) cannot be swapped with this browser's flow", async () => {
    const bid = await contractBid(); const sso = server(bid);
    const { flow } = await sso.embeddedPasskey.begin();
    const attackerCode = await bid.mintForeignCode("attacker-verifier-0123456789012345678901234", "attacker-nonce");
    await expect(sso.embeddedPasskey.complete({ code: attackerCode, flow })).rejects.toThrow(SsoError);
  });

  test("an id_token with the wrong nonce is refused", async () => {
    const bid = await contractBid({ nonceOverride: "not-ours" }); const sso = server(bid); const p = page();
    const { browser, flow } = await sso.embeddedPasskey.begin();
    const running = loginWithEmbeddedPasskey(browser, opts(p, bid));
    const flowId = await shown(p); bid.confirm(flowId);
    p.post(ISSUER, { type: "bid-embedded-passkey", flow_id: flowId, ok: true });
    const { code } = await running;
    await expect(sso.embeddedPasskey.complete({ code, flow })).rejects.toThrow(/nonce/i);
  });

  test("a message from another origin, or for another flow, is IGNORED — only BID's own answer counts", async () => {
    const bid = await contractBid(); const sso = server(bid); const p = page();
    const { browser } = await sso.embeddedPasskey.begin();
    const running = loginWithEmbeddedPasskey(browser, opts(p, bid));
    const flowId = await shown(p); bid.confirm(flowId);
    p.post("https://evil.example", { type: "bid-embedded-passkey", flow_id: flowId, ok: true });
    p.post(ISSUER, { type: "bid-embedded-passkey", flow_id: "pk-other", ok: true });
    p.post(ISSUER, { type: "something-else", flow_id: flowId, ok: true });
    let settled = false; void running.then(() => (settled = true), () => (settled = true));
    await new Promise((r) => setTimeout(r, 5));
    expect(settled).toBe(false);
    expect(bid.log.some((c) => c.path === "/embedded/passkey/complete")).toBe(false);
    p.post(ISSUER, { type: "bid-embedded-passkey", flow_id: flowId, ok: true });
    await expect(running).resolves.toHaveProperty("code");
  });

  for (const error of ["not_found", "cancelled", "failed"] as const) {
    test(`BID's frame says ${error} → EmbeddedPasskeyError("${error}"), frame removed, no complete call`, async () => {
      const bid = await contractBid(); const sso = server(bid); const p = page();
      const { browser } = await sso.embeddedPasskey.begin();
      const running = loginWithEmbeddedPasskey(browser, opts(p, bid));
      const flowId = await shown(p);
      p.post(ISSUER, { type: "bid-embedded-passkey", flow_id: flowId, ok: false, error });
      const e = await running.catch((x) => x);
      expect(e).toBeInstanceOf(EmbeddedPasskeyError);
      expect(e.reason).toBe(error);
      expect(p.frames[0]!.removed).toBe(true);
      expect(bid.log.some((c) => c.path === "/embedded/passkey/complete")).toBe(false);
    });
  }

  test("no answer from the frame → timeout, never a hanging promise; listener and frame cleaned up", async () => {
    const bid = await contractBid(); const sso = server(bid); const p = page();
    const { browser } = await sso.embeddedPasskey.begin();
    const running = loginWithEmbeddedPasskey(browser, opts(p, bid, { timeoutMs: 1000 }));
    await shown(p);
    p.fireTimers();
    const e = await running.catch((x) => x);
    expect(e.reason).toBe("timeout");
    expect(p.listeners.size).toBe(0);
    expect(p.frames[0]!.removed).toBe(true);
  });

  test("AbortSignal → aborted", async () => {
    const bid = await contractBid(); const sso = server(bid); const p = page();
    const { browser } = await sso.embeddedPasskey.begin();
    const ac = new AbortController();
    const running = loginWithEmbeddedPasskey(browser, opts(p, bid, { signal: ac.signal }));
    await shown(p);
    ac.abort();
    expect((await running.catch((x) => x)).reason).toBe("aborted");
  });

  test("start refused (4xx) → refused with the status; a frame_url off the issuer → unavailable, no frame shown", async () => {
    const p1 = page(); const bid1 = await contractBid({ startStatus: 400 });
    const b1 = (await server(bid1).embeddedPasskey.begin()).browser;
    const e1 = await loginWithEmbeddedPasskey(b1, opts(p1, bid1)).catch((x) => x);
    expect([e1.reason, e1.status]).toEqual(["refused", 400]);

    const p2 = page(); const bid2 = await contractBid({ frameOrigin: "https://evil.example" });
    const b2 = (await server(bid2).embeddedPasskey.begin()).browser;
    const e2 = await loginWithEmbeddedPasskey(b2, opts(p2, bid2)).catch((x) => x);
    expect(e2.reason).toBe("unavailable");
    expect(p2.frames.length).toBe(0);
  });

  test("the flow seals into a cookie and opens again; tampered, expired or the OTHER embedded flow's cookie is refused", async () => {
    const secret = "s".repeat(64);
    const flow = { codeVerifier: "v".repeat(43), nonce: "n".repeat(22) };
    const sealed = await sealEmbeddedPasskeyFlow(flow, secret);
    expect(await openEmbeddedPasskeyFlow(sealed, secret)).toStrictEqual({ ok: true, flow });
    expect(await openEmbeddedPasskeyFlow(sealed.slice(0, -2) + "xx", secret)).toStrictEqual({ ok: false, reason: "unreadable" });
    expect(await openEmbeddedPasskeyFlow(undefined, secret)).toStrictEqual({ ok: false, reason: "absent" });
    const later = Date.now() + 601_000;
    expect(await openEmbeddedPasskeyFlow(sealed, secret, { now: () => later })).toStrictEqual({ ok: false, reason: "expired" });
    const { sealEmbeddedFlow } = await import("../src/embedded.js");
    const other = await sealEmbeddedFlow({ flowId: "f", codeVerifier: "v", nonce: "n", email: "a@b.dk" }, secret);
    expect(await openEmbeddedPasskeyFlow(other, secret)).toStrictEqual({ ok: false, reason: "unreadable" });
  });

  test("complete without a code throws before any request", async () => {
    const bid = await contractBid(); const sso = server(bid);
    const { flow } = await sso.embeddedPasskey.begin();
    await expect(sso.embeddedPasskey.complete({ code: "", flow })).rejects.toThrow(/no code/);
    expect(bid.log.some((c) => c.path === "/oauth2/token")).toBe(false);
  });
});
