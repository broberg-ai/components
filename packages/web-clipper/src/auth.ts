// @broberg/web-clipper/auth — F099.5. Broberg ID login from a browser
// extension (contract F099.1 v1.1, docs/features/F099-web-clipper.md).
//
//  - OAuth 2.1 authorization code + PKCE (S256) + state, through
//    chrome.identity.launchWebAuthFlow. One PUBLIC BID client per extension
//    (trail-clipper, jam-clipper); no secret exists in the extension, so none
//    can leak from it (trail F207).
//  - Tokens live in chrome.storage.local, scoped to the extension — never
//    shared across extensions.
//  - session() renews before expiry with the refresh token (offline_access).
//    A refused refresh means the user's BID login ended (log out, «log ud
//    overalt», expiry): storage is cleared and session() returns null — the UI
//    says «log ind igen». A BID that does not answer is NOT that: it throws
//    BidUnavailableError, and the sender retries instead of logging anyone out.
//  - With `audience`, session() swaps the BID access token for a USER TICKET
//    to that one receiver (BID F087.37 token exchange, 5 min). Then
//    Session.accessToken IS the ticket, and the receiver checks it with
//    @broberg/sso createTicketVerifier. A ticket is never stored — it is
//    fetched again when it is close to expiry or when the sender asks for a
//    fresh one after a 401.
import type { Session, SessionSource } from "./transport";

/** The one chrome.identity function this needs — injectable for tests and for Firefox's browser.identity. */
export interface IdentityApi {
  launchWebAuthFlow(details: { url: string; interactive: boolean }): Promise<string | undefined>;
  getRedirectURL(path?: string): string;
}
export interface KeyValueStorage {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface BidAuthOptions {
  /** BID's issuer, e.g. https://id.broberg.ai */
  issuer: string;
  /** This extension's public BID client, e.g. "trail-clipper". */
  clientId: string;
  /** Default: openid profile email offline_access. */
  scopes?: string[];
  /** v1.1 — the receiver to get a user ticket for, e.g. https://app.trailmem.com */
  audience?: string;
  /** v1.1 — the scope to ask for on the ticket, e.g. "trail:clip". Omitted: the rule's scopes. */
  ticketScope?: string;
  identity?: IdentityApi;
  storage?: KeyValueStorage;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Renew this long before expiry. Default 60 s. */
  skewMs?: number;
}

export interface BidAuth extends SessionSource {
  /** Interactive login. Resolves with the session, or throws BidLoginError. */
  login(): Promise<Session>;
  logout(): Promise<void>;
}

/** The user cancelled, BID refused the login, or the answer did not match the request. */
export class BidLoginError extends Error {
  constructor(readonly reason: "cancelled" | "denied" | "state_mismatch" | "no_code" | "token_refused", message: string) {
    super(message);
    this.name = "BidLoginError";
  }
}
/** BID did not answer usefully (network, 5xx, unreadable body). Retry; do NOT log the user out. */
export class BidUnavailableError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message);
    this.name = "BidUnavailableError";
  }
}
/** BID refused a ticket for a reason that is a setup fault (no rule, scope not allowed, …). Not retried. */
export class BidTicketRefusedError extends Error {
  constructor(readonly reason: string, message: string) {
    super(message);
    this.name = "BidTicketRefusedError";
  }
}

interface Stored { accessToken: string; refreshToken: string | null; expiresAt: number; sub: string }
interface Ticket { token: string; expiresAt: number }
interface Discovery { authorization_endpoint: string; token_endpoint: string }
interface TokenResponse { access_token: string; refresh_token?: string; expires_in?: number; id_token?: string }

const DEFAULT_SCOPES = ["openid", "profile", "email", "offline_access"];
const TOKEN_EXCHANGE = "urn:ietf:params:oauth:grant-type:token-exchange";
const ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token";

export function createBidAuth(opts: BidAuthOptions): BidAuth {
  const issuer = opts.issuer.replace(/\/+$/, "");
  const scopes = opts.scopes ?? DEFAULT_SCOPES;
  const identity = opts.identity ?? chromeIdentity();
  const storage = opts.storage ?? extensionStorage();
  const doFetch = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const skew = opts.skewMs ?? 60_000;
  // One key per BID client: two extensions never read each other's login.
  const KEY = `broberg-web-clipper:bid:${opts.clientId}`;
  let discovery: Discovery | null = null;
  let ticket: Ticket | null = null;

  async function discover(): Promise<Discovery> {
    if (discovery) return discovery;
    const res = await call(`${issuer}/.well-known/openid-configuration`, { method: "GET" });
    if (!res.ok) throw new BidUnavailableError(`BID discovery answered ${res.status}`, res.status);
    const d = (await readJson(res)) as Partial<Discovery>;
    if (!d.authorization_endpoint || !d.token_endpoint) throw new BidUnavailableError("BID discovery has no authorization/token endpoint", res.status);
    return (discovery = { authorization_endpoint: d.authorization_endpoint, token_endpoint: d.token_endpoint });
  }

  async function call(url: string, init: RequestInit): Promise<Response> {
    try {
      return await doFetch(url, init);
    } catch (e) {
      throw new BidUnavailableError(`BID did not answer: ${e instanceof Error ? e.message : String(e)}`, null);
    }
  }

  async function tokenRequest(params: Record<string, string>): Promise<{ ok: true; body: TokenResponse } | { ok: false; status: number; error: string; description: string }> {
    const { token_endpoint } = await discover();
    const res = await call(token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams(params).toString(),
    });
    if (res.status >= 500) throw new BidUnavailableError(`BID's token endpoint answered ${res.status}`, res.status);
    const body = (await readJson(res)) as Record<string, unknown>;
    if (!res.ok) return { ok: false, status: res.status, error: String(body.error ?? "unknown"), description: String(body.error_description ?? "") };
    if (typeof body.access_token !== "string") throw new BidUnavailableError("BID's token answer has no access_token", res.status);
    return { ok: true, body: body as unknown as TokenResponse };
  }

  async function save(t: TokenResponse, previousRefresh: string | null, previousSub?: string): Promise<Stored> {
    const sub = (t.id_token && subOf(t.id_token)) || previousSub;
    if (!sub) throw new BidLoginError("token_refused", "BID's answer names no user (no id_token sub) — is the openid scope granted?");
    const s: Stored = {
      accessToken: t.access_token,
      refreshToken: t.refresh_token ?? previousRefresh,
      expiresAt: now() + (t.expires_in ?? 3600) * 1000,
      sub,
    };
    await storage.set(KEY, s);
    return s;
  }

  async function stored(): Promise<Stored | null> {
    const v = (await storage.get(KEY)) as Stored | undefined | null;
    return v && typeof v.accessToken === "string" && typeof v.sub === "string" ? v : null;
  }

  async function ended(): Promise<null> {
    ticket = null;
    await storage.remove(KEY);
    return null;
  }

  /** The BID login, renewed if it is close to expiry (or `force`). null → log in again. */
  async function bidSession(force: boolean): Promise<Stored | null> {
    const s = await stored();
    if (!s) return null;
    if (!force && s.expiresAt - skew > now()) return s;
    if (!s.refreshToken) return ended();
    const r = await tokenRequest({ grant_type: "refresh_token", refresh_token: s.refreshToken, client_id: opts.clientId });
    // A refused refresh is the user's BID login ending — never a hiccup (5xx threw above).
    if (!r.ok) return ended();
    return save(r.body, s.refreshToken, s.sub);
  }

  async function freshTicket(s: Stored, retried = false): Promise<Ticket | null> {
    const r = await tokenRequest({
      grant_type: TOKEN_EXCHANGE,
      subject_token: s.accessToken,
      subject_token_type: ACCESS_TOKEN_TYPE,
      client_id: opts.clientId,
      resource: opts.audience!,
      ...(opts.ticketScope ? { scope: opts.ticketScope } : {}),
    });
    if (r.ok) return { token: r.body.access_token, expiresAt: now() + (r.body.expires_in ?? 300) * 1000 };
    const reason = r.description.split(":")[0]!.trim();
    if (reason === "session_ended") return ended();
    // The BID access token itself went stale between our check and BID's: renew it once and ask again.
    if (reason === "subject_token_inactive" && !retried) {
      const renewed = await bidSession(true);
      return renewed ? freshTicket(renewed, true) : null;
    }
    if (reason === "subject_token_inactive") return ended();
    throw new BidTicketRefusedError(reason || r.error, `BID refused a ticket for ${opts.audience}: ${r.description || r.error}`);
  }

  return {
    async login() {
      const { authorization_endpoint } = await discover();
      const verifier = randomString(64);
      const state = randomString(32);
      const redirectUri = identity.getRedirectURL();
      const url = new URL(authorization_endpoint);
      url.search = new URLSearchParams({
        response_type: "code",
        client_id: opts.clientId,
        redirect_uri: redirectUri,
        scope: scopes.join(" "),
        code_challenge: await s256(verifier),
        code_challenge_method: "S256",
        state,
      }).toString();

      let back: string | undefined;
      try {
        back = await identity.launchWebAuthFlow({ url: url.toString(), interactive: true });
      } catch (e) {
        throw new BidLoginError("cancelled", `login window closed: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (!back) throw new BidLoginError("cancelled", "login window closed without an answer");
      const answer = new URL(back).searchParams;
      if (answer.get("error")) throw new BidLoginError("denied", `BID refused the login: ${answer.get("error")} ${answer.get("error_description") ?? ""}`.trim());
      if (answer.get("state") !== state) throw new BidLoginError("state_mismatch", "the login answer does not belong to this login (state differs)");
      const code = answer.get("code");
      if (!code) throw new BidLoginError("no_code", "the login answer carries no code");

      const r = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: opts.clientId, code_verifier: verifier });
      if (!r.ok) throw new BidLoginError("token_refused", `BID refused the code: ${r.error} ${r.description}`.trim());
      ticket = null;
      await save(r.body, null);
      const session = await this.session();
      if (!session) throw new BidLoginError("token_refused", "logged in, but BID refused the session right after");
      return session;
    },

    async session(options) {
      const force = options?.refresh === true;
      if (!opts.audience) {
        const s = await bidSession(force);
        return s && { accessToken: s.accessToken, sub: s.sub, expiresAt: s.expiresAt };
      }
      // With an audience: the BID login only renews when IT is near expiry; a
      // forced refresh (after a 401) fetches a new TICKET.
      const s = await bidSession(false);
      if (!s) return null;
      if (force || !ticket || ticket.expiresAt - skew <= now()) ticket = await freshTicket(s);
      return ticket && { accessToken: ticket.token, sub: s.sub, expiresAt: ticket.expiresAt };
    },

    async logout() {
      await ended();
    },
  };
}

function subOf(idToken: string): string | null {
  // The id_token comes straight from BID's token endpoint over TLS, to this
  // client; it is read for the user's id only, never trusted as a credential.
  const part = idToken.split(".")[1];
  if (!part) return null;
  try {
    const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof json.sub === "string" && json.sub ? json.sub : null;
  } catch {
    return null; // not a JWT — the caller reports "names no user"
  }
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new BidUnavailableError(`BID answered ${res.status} with a body that is not JSON`, res.status);
  }
}

function randomString(bytes: number): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return base64url(b);
}
async function s256(verifier: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}
function base64url(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type ChromeLike = {
  identity?: IdentityApi & { launchWebAuthFlow(d: { url: string; interactive: boolean }): Promise<string | undefined> };
  storage?: { local: { get(k: string): Promise<Record<string, unknown>>; set(v: Record<string, unknown>): Promise<void>; remove(k: string): Promise<void> } };
};
function ext(): ChromeLike {
  const g = globalThis as { chrome?: ChromeLike; browser?: ChromeLike };
  return g.browser?.identity ? g.browser : g.chrome ?? {};
}
function chromeIdentity(): IdentityApi {
  const id = ext().identity;
  if (!id) throw new Error("web-clipper/auth: no chrome.identity — add the \"identity\" permission, or pass `identity`");
  return id;
}
/** chrome.storage.local (or Firefox's browser.storage.local) as a KeyValueStorage — for the popup's own memory too. */
export function extensionStorage(): KeyValueStorage {
  const local = ext().storage?.local;
  if (!local) throw new Error("web-clipper/auth: no chrome.storage.local — add the \"storage\" permission, or pass `storage`");
  return {
    get: async (k) => (await local.get(k))[k],
    set: (k, v) => local.set({ [k]: v }),
    remove: (k) => local.remove(k),
  };
}
