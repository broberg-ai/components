// F099.5 — BrobergID login from an extension, against a fake BID and a fake chrome.identity.
import { describe, expect, it } from "vitest";
import { createBidAuth, BidLoginError, BidUnavailableError, BidTicketRefusedError, type IdentityApi, type KeyValueStorage } from "../src/auth";
import { sendClip, DestinationError, type Destination } from "../src/transport";

const ISS = "https://id.broberg.ai";
const REDIRECT = "https://abcdefghijklmnop.chromiumapp.org/";
const jwt = (payload: object) => `x.${btoa(JSON.stringify(payload)).replace(/=+$/, "")}.y`;

type Reply = { status: number; body: unknown } | "net";
function fakeBid(script: Record<string, Reply[]> = {}) {
  const calls: { grant: string | null; params: URLSearchParams }[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url === `${ISS}/.well-known/openid-configuration`) {
      return Response.json({ issuer: ISS, authorization_endpoint: `${ISS}/oauth2/authorize`, token_endpoint: `${ISS}/oauth2/token` });
    }
    const params = new URLSearchParams(String(init?.body ?? ""));
    const grant = params.get("grant_type");
    calls.push({ grant, params });
    const queue = script[grant ?? ""] ?? [];
    const r = queue.shift();
    if (r === "net") throw new TypeError("fetch failed");
    if (r) return new Response(JSON.stringify(r.body), { status: r.status });
    if (grant === "authorization_code") return Response.json({ access_token: "at-1", refresh_token: "rt-1", expires_in: 3600, id_token: jwt({ sub: "user-42" }) });
    if (grant === "refresh_token") return Response.json({ access_token: `at-r${calls.length}`, expires_in: 3600 });
    return Response.json({ access_token: `ticket-${calls.length}`, token_type: "Bearer", expires_in: 300 });
  }) as typeof fetch;
  return { fetchImpl, calls, grants: () => calls.map((c) => c.grant) };
}
function memory(): KeyValueStorage & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return { data, get: async (k) => data.get(k), set: async (k, v) => void data.set(k, v), remove: async (k) => void data.delete(k) };
}
/** A browser that "logs the user in" and answers with the given transform of the request. */
function identity(answer: (req: URL) => string | undefined | Error = (req) => `${REDIRECT}?code=c-1&state=${req.searchParams.get("state")}`) {
  const seen: URL[] = [];
  const api: IdentityApi = {
    getRedirectURL: () => REDIRECT,
    async launchWebAuthFlow({ url }) {
      const u = new URL(url);
      seen.push(u);
      const a = answer(u);
      if (a instanceof Error) throw a;
      return a;
    },
  };
  return { api, seen };
}
async function s256(v: string) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)));
  let s = ""; for (const x of d) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const clock = (t = 1_800_000_000_000) => { const c = { t, now: () => c.t }; return c; };

describe("F099.5 — login: PKCE + state, code for tokens, stored", () => {
  it("authorize carries S256 challenge, state, redirect and scopes; the code exchange carries the matching verifier", async () => {
    const bid = fakeBid(); const id = identity(); const store = memory();
    const auth = createBidAuth({ issuer: ISS, clientId: "trail-clipper", identity: id.api, storage: store, fetchImpl: bid.fetchImpl });
    const s = await auth.login();
    expect(s).toMatchObject({ accessToken: "at-1", sub: "user-42" });

    const req = id.seen[0]!;
    expect(req.origin + req.pathname).toBe(`${ISS}/oauth2/authorize`);
    expect(Object.fromEntries(req.searchParams)).toMatchObject({
      response_type: "code", client_id: "trail-clipper", redirect_uri: REDIRECT,
      scope: "openid profile email offline_access", code_challenge_method: "S256",
    });
    expect(req.searchParams.get("state")!.length).toBeGreaterThanOrEqual(32);

    const code = bid.calls.find((c) => c.grant === "authorization_code")!.params;
    expect(Object.fromEntries(code)).toMatchObject({ code: "c-1", redirect_uri: REDIRECT, client_id: "trail-clipper" });
    expect(await s256(code.get("code_verifier")!)).toBe(req.searchParams.get("code_challenge"));
    expect(code.get("client_secret")).toBeNull();

    expect(store.data.get("broberg-web-clipper:bid:trail-clipper")).toMatchObject({ accessToken: "at-1", refreshToken: "rt-1", sub: "user-42" });
  });

  it("a different state in the answer is refused and nothing is stored", async () => {
    const store = memory();
    const auth = createBidAuth({ issuer: ISS, clientId: "c", identity: identity(() => `${REDIRECT}?code=c-1&state=forged`).api, storage: store, fetchImpl: fakeBid().fetchImpl });
    await expect(auth.login()).rejects.toMatchObject({ name: "BidLoginError", reason: "state_mismatch" });
    expect(store.data.size).toBe(0);
  });

  it("BID says no → denied; the user closes the window → cancelled", async () => {
    const denied = createBidAuth({ issuer: ISS, clientId: "c", identity: identity((r) => `${REDIRECT}?error=access_denied&state=${r.searchParams.get("state")}`).api, storage: memory(), fetchImpl: fakeBid().fetchImpl });
    await expect(denied.login()).rejects.toMatchObject({ reason: "denied" });
    const closed = createBidAuth({ issuer: ISS, clientId: "c", identity: identity(() => new Error("The user did not approve access.")).api, storage: memory(), fetchImpl: fakeBid().fetchImpl });
    await expect(closed.login()).rejects.toBeInstanceOf(BidLoginError);
  });

  it("two extensions never share a login (storage is keyed by client)", async () => {
    const store = memory();
    const trail = createBidAuth({ issuer: ISS, clientId: "trail-clipper", identity: identity().api, storage: store, fetchImpl: fakeBid().fetchImpl });
    const jam = createBidAuth({ issuer: ISS, clientId: "jam-clipper", identity: identity().api, storage: store, fetchImpl: fakeBid().fetchImpl });
    await trail.login();
    expect(await jam.session()).toBeNull();
  });
});

describe("F099.5 — session renewal and its two different failures", () => {
  async function loggedIn(script: Record<string, Reply[]> = {}) {
    const bid = fakeBid(script); const store = memory(); const c = clock();
    const auth = createBidAuth({ issuer: ISS, clientId: "c", identity: identity().api, storage: store, fetchImpl: bid.fetchImpl, now: c.now });
    await auth.login();
    return { auth, bid, store, c };
  }

  it("before expiry: no network call", async () => {
    const { auth, bid } = await loggedIn();
    const n = bid.calls.length;
    expect((await auth.session())!.accessToken).toBe("at-1");
    expect(bid.calls.length).toBe(n);
  });

  it("within the skew of expiry: renewed with the refresh token, sub kept", async () => {
    const { auth, bid, c } = await loggedIn();
    c.t += 3600_000 - 30_000;
    const s = await auth.session();
    expect(bid.grants().at(-1)).toBe("refresh_token");
    expect(s!.accessToken).not.toBe("at-1");
    expect(s!.sub).toBe("user-42");
  });

  it("refresh REFUSED (BID login ended) → null and the stored login is gone («log ind igen»)", async () => {
    const { auth, store, c } = await loggedIn({ refresh_token: [{ status: 400, body: { error: "invalid_grant" } }] });
    c.t += 3600_000;
    expect(await auth.session()).toBeNull();
    expect(store.data.size).toBe(0);
  });

  it("BID DOWN during refresh → BidUnavailableError, and the login is KEPT", async () => {
    const { auth, store, c } = await loggedIn({ refresh_token: [{ status: 503, body: {} }, "net"] });
    c.t += 3600_000;
    await expect(auth.session()).rejects.toBeInstanceOf(BidUnavailableError);
    await expect(auth.session()).rejects.toBeInstanceOf(BidUnavailableError);
    expect(store.data.size).toBe(1);
  });

  it("logout clears it", async () => {
    const { auth, store } = await loggedIn();
    await auth.logout();
    expect(store.data.size).toBe(0);
    expect(await auth.session()).toBeNull();
  });
});

describe("F099.5 / contract v1.1 — a user ticket for one receiver", () => {
  async function withAudience(script: Record<string, Reply[]> = {}) {
    const bid = fakeBid(script); const store = memory(); const c = clock();
    const auth = createBidAuth({ issuer: ISS, clientId: "trail-clipper", audience: "https://app.trailmem.com", ticketScope: "trail:clip", identity: identity().api, storage: store, fetchImpl: bid.fetchImpl, now: c.now });
    await auth.login();
    return { auth, bid, store, c };
  }
  const EX = "urn:ietf:params:oauth:grant-type:token-exchange";

  it("session() is the TICKET, asked for exactly as BID's §4b says", async () => {
    const { auth, bid } = await withAudience();
    const s = await auth.session();
    expect(s!.accessToken).toMatch(/^ticket-/);
    expect(s!.sub).toBe("user-42");
    const ex = bid.calls.filter((c) => c.grant === EX).at(-1)!.params;
    expect(Object.fromEntries(ex)).toStrictEqual({
      grant_type: EX, subject_token: "at-1", subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
      client_id: "trail-clipper", resource: "https://app.trailmem.com", scope: "trail:clip",
    });
  });

  it("the ticket is reused while valid, and a forced refresh (after a 401) fetches a new one", async () => {
    const { auth, bid } = await withAudience();
    const a = await auth.session();
    const b = await auth.session();
    expect(b!.accessToken).toBe(a!.accessToken);
    const c = await auth.session({ refresh: true });
    expect(c!.accessToken).not.toBe(a!.accessToken);
    // One ticket at login (its own session()), reused by a and b, one more for the forced refresh.
    expect(bid.calls.filter((x) => x.grant === EX)).toHaveLength(2);
  });

  it("session_ended → null and the login is cleared", async () => {
    const { auth, store } = await withAudience({ [EX]: [{ status: 200, body: { access_token: "t0", expires_in: 300 } }, { status: 400, body: { error: "invalid_grant", error_description: "session_ended: …" } }] });
    expect(await auth.session({ refresh: true })).toBeNull();
    expect(store.data.size).toBe(0);
  });

  it("no rule for this receiver → BidTicketRefusedError (a setup fault, not a logout)", async () => {
    const { auth, store } = await withAudience({ [EX]: [{ status: 200, body: { access_token: "t0", expires_in: 300 } }, { status: 400, body: { error: "invalid_target", error_description: "no_rule_for_audience: …" } }] });
    await expect(auth.session({ refresh: true })).rejects.toMatchObject({ name: "BidTicketRefusedError", reason: "no_rule_for_audience" });
    expect(store.data.size).toBe(1);
  });

  it("subject_token_inactive → the BID token is renewed ONCE and the ticket asked for again", async () => {
    const { auth, bid } = await withAudience({ [EX]: [{ status: 200, body: { access_token: "t0", expires_in: 300 } }, { status: 400, body: { error: "invalid_grant", error_description: "subject_token_inactive: …" } }] });
    const s = await auth.session({ refresh: true });
    expect(s!.accessToken).toMatch(/^ticket-/);
    expect(bid.grants().slice(-3)).toStrictEqual([EX, "refresh_token", EX]);
  });
});

describe("F099.5 × F099.4 — the sender reads auth failures correctly", () => {
  const T = { id: "t", label: "t" };
  const clip = { url: "https://x/", title: "x", units: [{ kind: "page", content: "a", position: 0 }] };
  it("401, and BID is down when the sender asks for a fresh session → 'unavailable', never 'login_required'", async () => {
    const bid = fakeBid(); const store = memory(); const c = clock();
    const auth = createBidAuth({ issuer: ISS, clientId: "trail-clipper", audience: "https://app.trailmem.com", identity: identity().api, storage: store, fetchImpl: bid.fetchImpl, now: c.now });
    await auth.login();
    const down = { ...auth, session: async (o?: { refresh?: boolean }) => { if (o?.refresh) throw new BidUnavailableError("BID's token endpoint answered 503", 503); return auth.session(); } };
    const dest: Destination = { id: "d", label: "d", targets: async () => [T], async send() { throw new DestinationError(401); } };
    expect(await sendClip({ destination: dest, target: T, clip, auth: down, sleep: async () => {} })).toMatchObject({ state: "unavailable", status: 503 });
  });
  it("BID refuses the ticket for a setup reason → 'refused', not retried forever", async () => {
    const auth = { session: async () => { throw new BidTicketRefusedError("no_rule_for_audience", "BID refused a ticket"); } };
    const dest: Destination = { id: "d", label: "d", targets: async () => [T], async send() {} };
    expect(await sendClip({ destination: dest, target: T, clip, auth, sleep: async () => {} })).toMatchObject({ state: "refused" });
  });
});
