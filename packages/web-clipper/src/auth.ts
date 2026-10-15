// @broberg/web-clipper/auth — F099.5. BrobergID login from a browser
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
  /** F099.25 — where BID's passkey frame posts its answer. Default: the popup's own window. */
  messages?: Pick<Window, "addEventListener" | "removeEventListener">;
  /** Renew this long before expiry. Default 60 s. */
  skewMs?: number;
}

export interface BidAuth extends SessionSource {
  /** Interactive login. Resolves with the session, or throws BidLoginError. */
  login(): Promise<Session>;
  logout(): Promise<void>;
  /**
   * F099.24 — the login INSIDE the popup (BID F084.166 contract v1): no window, a code by mail,
   * then a second factor if the account has one. Ends in the same Session as login().
   */
  embedded?(): EmbeddedLogin;
}

/** F099.24 — what can go wrong on a step, as data the popup can word and style itself. */
export type EmbeddedError =
  | { kind: "invalid_code"; attemptsLeft?: number }
  | { kind: "expired" }
  | { kind: "locked"; retryAfter?: number }
  | { kind: "too_many_requests"; retryAfter?: number }
  | { kind: "not_embedded" }
  | { kind: "invalid_request" }
  /** F099.25 — the passkey frame said no: no key for this site on this device, or the check failed. Mail code still works. */
  | { kind: "passkey"; reason: "not_found" | "failed" }
  | { kind: "unavailable"; message: string };

/** F099.24 — where the embedded login stands. `busy` while a call is out; `error` from the last call. */
export type EmbeddedState = { busy: boolean; error?: EmbeddedError } & (
  | { step: "email" }
  | { step: "code"; email: string; expiresAt: number }
  /** F099.25 — show `<iframe src={frameUrl} allow="publickey-credentials-get">`; BID's frame draws the button. */
  | { step: "passkey"; frameUrl: string; expiresAt: number }
  | { step: "second_factor"; email: string; methods: ("totp" | "sms")[]; smsSent: boolean }
  | { step: "signed_in"; session: Session }
);

export interface EmbeddedLogin {
  /** The current state. */
  state(): EmbeddedState;
  /** Called on every change; returns the unsubscribe. */
  subscribe(fn: (s: EmbeddedState) => void): () => void;
  /**
   * Pick up a flow a closed popup left behind (the user went to their mail for the code and Chrome
   * closed the popup). Call once when the popup opens.
   */
  resume(): Promise<EmbeddedState>;
  /** Send a code to this address. The answer is the same whether the account exists or not. */
  start(email: string): Promise<EmbeddedState>;
  /**
   * F099.25 — log in with a passkey (BID F084.166 contract v2): a new flow whose frame the popup shows.
   * The engine listens for the frame's answer itself and ends in signed_in like the mail code.
   */
  passkeyStart(): Promise<EmbeddedState>;
  /** The code from the mail. */
  verify(code: string): Promise<EmbeddedState>;
  /** Ask for the second-factor code by SMS (when `methods` has "sms"). */
  sendSms(): Promise<EmbeddedState>;
  /** The second-factor code from the authenticator app ("totp") or the SMS. */
  verifySecondFactor(method: "totp" | "sms", code: string): Promise<EmbeddedState>;
  /** A new code to the same address (a new flow). */
  resend(): Promise<EmbeddedState>;
  /** Back to the email step, forgetting the flow. */
  restart(): Promise<EmbeddedState>;
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
      // NEVER the user's BrobergID cookie: the extension's host access lets fetch
      // send it, and then BID's CSRF guard answers 403 «Invalid origin:
      // chrome-extension://…» (measured by broberg-id in production 12/10).
      // These calls authenticate with the code/token in the body, not a session.
      return await doFetch(url, { ...init, credentials: "omit" });
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
    if (!res.ok) {
      // A refusal must be readable in production: when BID's body has no OAuth
      // `error`, the HTTP status and a short, scrubbed excerpt say what happened.
      const text = await res.text();
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(text) as Record<string, unknown>;
      } catch {
        // not JSON — the excerpt below carries it
      }
      // OAuth's `error`/`error_description` first; Better Auth's own `code`/`message` (e.g. INVALID_ORIGIN) next; then the raw excerpt.
      const str = (v: unknown) => (typeof v === "string" && v ? v : null);
      // A `code` counts only if it looks like an error name — never echo a value that could be a credential.
      const code = str(body.code) && /^[A-Z][A-Z0-9_]{1,63}$/.test(body.code as string) ? (body.code as string) : null;
      const error = str(body.error) ?? code ?? `http_${res.status}`;
      const description = str(body.error_description) ?? (str(body.message) ? excerpt(str(body.message)!) : str(body.error) || code ? "" : excerpt(text));
      return { ok: false, status: res.status, error, description };
    }
    const body = (await readJson(res)) as Record<string, unknown>;
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

  const api: BidAuth = {
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
      if (!r.ok) throw new BidLoginError("token_refused", `BID refused the code (HTTP ${r.status}): ${r.error} ${r.description}`.trim());
      ticket = null;
      await save(r.body, null);
      const session = await api.session();
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

    embedded() {
      return embeddedLogin();
    },
  };

  /** F099.24 — the embedded login against BID's /embedded/* (F084.166 contract v1). */
  function embeddedLogin(): EmbeddedLogin {
    const FLOW = `${KEY}:embedded`;
    interface Flow { flowId: string; verifier: string; email: string; expiresAt: number; step: "code" | "second_factor" | "passkey"; methods?: ("totp" | "sms")[]; smsSent?: boolean; frameUrl?: string }
    let state: EmbeddedState = { step: "email", busy: false };
    const subs = new Set<(s: EmbeddedState) => void>();
    const set = (next: EmbeddedState): EmbeddedState => {
      state = next;
      for (const fn of subs) fn(state);
      return state;
    };
    const fromFlow = (f: Flow, error?: EmbeddedError): EmbeddedState =>
      f.step === "passkey"
        ? { step: "passkey", frameUrl: f.frameUrl ?? "", expiresAt: f.expiresAt, busy: false, ...(error ? { error } : {}) }
        : f.step === "code"
        ? { step: "code", email: f.email, expiresAt: f.expiresAt, busy: false, ...(error ? { error } : {}) }
        : { step: "second_factor", email: f.email, methods: f.methods ?? [], smsSent: f.smsSent ?? false, busy: false, ...(error ? { error } : {}) };
    const loadFlow = async (): Promise<Flow | null> => {
      const f = (await storage.get(FLOW)) as Flow | null | undefined;
      return f && typeof f.flowId === "string" && typeof f.verifier === "string" ? f : null;
    };
    const forget = () => {
      stopListening();
      return storage.remove(FLOW);
    };

    // F099.25 — the passkey frame's answer. Only BID's own origin, only this message type, only OUR flow:
    // any other window can post to the popup, and must never be able to complete a login.
    const bidOrigin = new URL(issuer).origin;
    const messages = opts.messages ?? (typeof (globalThis as { addEventListener?: unknown }).addEventListener === "function" ? (globalThis as unknown as Window) : undefined);
    let listener: ((e: MessageEvent) => void) | null = null;
    function stopListening() {
      if (listener) messages?.removeEventListener("message", listener as EventListener);
      listener = null;
    }
    function listen(f: Flow) {
      stopListening();
      listener = (e: MessageEvent) => {
        const d = e.data as { type?: unknown; flow_id?: unknown; ok?: unknown; error?: unknown } | null;
        if (e.origin !== bidOrigin || !d || d.type !== "bid-embedded-passkey" || d.flow_id !== f.flowId) return;
        void onPasskey(f, d.ok === true, d.error);
      };
      messages?.addEventListener("message", listener as EventListener);
    }
    async function onPasskey(f: Flow, ok: boolean, error: unknown): Promise<EmbeddedState> {
      if (!ok) {
        // cancelled: the frame's button is ready again — no error to show.
        if (error === "cancelled") return set(fromFlow(f));
        return set(fromFlow(f, { kind: "passkey", reason: error === "not_found" ? "not_found" : "failed" }));
      }
      stopListening();
      busy();
      const r = await post("/passkey/complete", { flow_id: f.flowId });
      return r.ok ? next(r.body, f) : failed(f, r.error);
    }

    /** One call to /embedded/*: the body on 200, or the contract's error as data. */
    async function post(path: string, body: Record<string, unknown>): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; error: EmbeddedError }> {
      let res: Response;
      try {
        res = await call(`${issuer}/embedded${path}`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });
      } catch (e) {
        return { ok: false, error: { kind: "unavailable", message: e instanceof Error ? e.message : String(e) } };
      }
      const json = ((await readJson(res).catch(() => ({}))) ?? {}) as Record<string, unknown>;
      if (res.ok) return { ok: true, body: json };
      const num = (v: unknown) => (typeof v === "number" ? v : undefined);
      const code = typeof json.error === "string" ? json.error : "";
      if (res.status === 400 && code === "invalid_code") return { ok: false, error: { kind: "invalid_code", ...(num(json.attempts_left) !== undefined ? { attemptsLeft: num(json.attempts_left) } : {}) } };
      if (res.status === 400 && code === "expired") return { ok: false, error: { kind: "expired" } };
      if (res.status === 400) return { ok: false, error: { kind: "invalid_request" } };
      if (res.status === 403 && code === "client_not_embedded") return { ok: false, error: { kind: "not_embedded" } };
      // A BID without the /embedded endpoints (not deployed there yet) cannot do this login either: fall back, never «no connection».
      if (res.status === 404 || res.status === 405) return { ok: false, error: { kind: "not_embedded" } };
      if (res.status === 429) return { ok: false, error: { kind: code === "locked" ? "locked" : "too_many_requests", ...(num(json.retry_after) !== undefined ? { retryAfter: num(json.retry_after) } : {}) } };
      return { ok: false, error: { kind: "unavailable", message: `BID answered ${res.status}${code ? ` (${code})` : ""}` } };
    }

    /** A step failed: expired and locked end the flow (back to email); anything else stays where it is. */
    async function failed(f: Flow | null, error: EmbeddedError): Promise<EmbeddedState> {
      if (error.kind === "expired" || error.kind === "locked") {
        await forget();
        return set({ step: "email", busy: false, error });
      }
      return set(f ? fromFlow(f, error) : { step: "email", busy: false, error });
    }

    /** The authorization code from BID, swapped exactly as after the login window — the same Session. */
    async function done(code: string, f: Flow): Promise<EmbeddedState> {
      const r = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: identity.getRedirectURL(), client_id: opts.clientId, code_verifier: f.verifier }).catch(
        (e: unknown) => ({ ok: false as const, status: 0, error: "unavailable", description: e instanceof Error ? e.message : String(e) }),
      );
      if (!r.ok) return failed(f, { kind: "unavailable", message: `BID refused the code (HTTP ${r.status}): ${r.error} ${r.description}`.trim() });
      ticket = null;
      await save(r.body, null);
      await forget();
      const session = await api.session();
      if (!session) return failed(null, { kind: "unavailable", message: "logged in, but BID refused the session right after" });
      return set({ step: "signed_in", session, busy: false });
    }

    async function next(body: Record<string, unknown>, f: Flow): Promise<EmbeddedState> {
      if (body.next === "done" && typeof body.code === "string") return done(body.code, f);
      if (body.next === "second_factor") {
        const methods = (Array.isArray(body.methods) ? body.methods : []).filter((m): m is "totp" | "sms" => m === "totp" || m === "sms");
        const g: Flow = { ...f, step: "second_factor", methods, smsSent: false };
        await storage.set(FLOW, g);
        return set(fromFlow(g));
      }
      return failed(f, { kind: "unavailable", message: "BID's answer names no next step" });
    }

    const busy = () => set({ ...state, busy: true, error: undefined } as EmbeddedState);

    return {
      state: () => state,
      subscribe(fn) {
        subs.add(fn);
        return () => subs.delete(fn);
      },
      async resume() {
        const f = await loadFlow();
        if (!f) return set({ step: "email", busy: false });
        if (f.expiresAt <= now()) {
          await forget();
          return set({ step: "email", busy: false, error: { kind: "expired" } });
        }
        if (f.step === "passkey") listen(f);
        return set(fromFlow(f));
      },
      async start(email) {
        stopListening();
        busy();
        const verifier = randomString(64);
        const r = await post("/start", { client_id: opts.clientId, email, code_challenge: await s256(verifier), code_challenge_method: "S256" });
        if (!r.ok) return failed(null, r.error);
        const flowId = r.body.flow_id;
        if (typeof flowId !== "string") return failed(null, { kind: "unavailable", message: "BID's answer has no flow_id" });
        const expiresIn = typeof r.body.expires_in === "number" ? r.body.expires_in : 600;
        const f: Flow = { flowId, verifier, email, expiresAt: now() + expiresIn * 1000, step: "code" };
        await storage.set(FLOW, f);
        return set(fromFlow(f));
      },
      async passkeyStart() {
        stopListening();
        busy();
        const verifier = randomString(64);
        const r = await post("/passkey/start", { client_id: opts.clientId, code_challenge: await s256(verifier), code_challenge_method: "S256" });
        if (!r.ok) return failed(null, r.error);
        const { flow_id: flowId, frame_url: frameUrl } = r.body;
        if (typeof flowId !== "string" || typeof frameUrl !== "string") return failed(null, { kind: "unavailable", message: "BID's answer has no flow_id/frame_url" });
        // The frame must be BID's own page — never show (and grant the passkey permission to) anything else.
        if (new URL(frameUrl, issuer).origin !== bidOrigin) return failed(null, { kind: "unavailable", message: "BID's frame_url is not on BID's origin" });
        const expiresIn = typeof r.body.expires_in === "number" ? r.body.expires_in : 600;
        const f: Flow = { flowId, verifier, email: "", expiresAt: now() + expiresIn * 1000, step: "passkey", frameUrl: new URL(frameUrl, issuer).toString() };
        await storage.set(FLOW, f);
        listen(f);
        return set(fromFlow(f));
      },
      async verify(code) {
        const f = await loadFlow();
        if (!f) return failed(null, { kind: "expired" });
        busy();
        const r = await post("/verify", { flow_id: f.flowId, code });
        return r.ok ? next(r.body, f) : failed(f, r.error);
      },
      async sendSms() {
        const f = await loadFlow();
        if (!f) return failed(null, { kind: "expired" });
        busy();
        const r = await post("/second-factor/sms", { flow_id: f.flowId });
        if (!r.ok) return failed(f, r.error);
        const g: Flow = { ...f, smsSent: true };
        await storage.set(FLOW, g);
        return set(fromFlow(g));
      },
      async verifySecondFactor(method, code) {
        const f = await loadFlow();
        if (!f) return failed(null, { kind: "expired" });
        busy();
        const r = await post("/second-factor", { flow_id: f.flowId, method, code });
        return r.ok ? next(r.body, f) : failed(f, r.error);
      },
      async resend() {
        const f = await loadFlow();
        const email = f?.email ?? ("email" in state ? state.email : undefined);
        if (!email) return set({ step: "email", busy: false });
        return this.start(email);
      },
      async restart() {
        await forget();
        return set({ step: "email", busy: false });
      },
    };
  }

  return api;
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

/**
 * At most 200 characters of a response body for an error message, with every
 * long token-like run (a code, a token, a JWT) replaced by «…» — an error that
 * lands in a log must not carry a credential.
 */
export function excerpt(text: string): string {
  const scrubbed = text.replace(/[A-Za-z0-9._~+/=-]{20,}/g, "…").replace(/\s+/g, " ").trim();
  return scrubbed.length > 200 ? `${scrubbed.slice(0, 200)}…` : scrubbed;
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

// ── login from the BACKGROUND (trail 12/10, Christian's first real login) ──
// Chrome closes an extension's popup the moment it loses focus — and the login
// window takes focus. A login run in the popup therefore dies between BID's
// answer and storing the tokens: BID says yes, nothing is saved, the button
// still says «Log ind». The background service worker does not die with the
// popup, so it runs the login; the popup only asks, and then reads the session
// from the storage both share.

/** The message the popup sends and serveLogin answers. */
export const LOGIN_MESSAGE = "broberg-web-clipper:login";

/** The slice of chrome.runtime this uses — injectable for tests and Firefox's browser.runtime. */
export interface RuntimeApi {
  sendMessage(message: unknown): Promise<unknown>;
  onMessage: { addListener(fn: (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean | void): void };
}

type LoginReply = { ok: true } | { ok: false; kind: "login"; reason: BidLoginError["reason"]; message: string } | { ok: false; kind: "unavailable"; message: string; status: number | null };

/** In the background script: run logins the popup asks for. Use the SAME createBidAuth options as the popup. */
export function serveLogin(auth: BidAuth, runtime: RuntimeApi = chromeRuntime()): void {
  runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if ((message as { type?: unknown } | null)?.type !== LOGIN_MESSAGE) return; // not ours — let other listeners answer
    auth.login().then(
      (): void => sendResponse({ ok: true } satisfies LoginReply),
      (e: unknown): void => {
        if (e instanceof BidLoginError) sendResponse({ ok: false, kind: "login", reason: e.reason, message: e.message } satisfies LoginReply);
        else sendResponse({ ok: false, kind: "unavailable", message: e instanceof Error ? e.message : String(e), status: e instanceof BidUnavailableError ? e.status : null } satisfies LoginReply);
      },
    );
    return true; // the answer comes later
  });
}

/**
 * In the popup: the same BidAuth, except login() is run by the background
 * (serveLogin). If the popup is closed while the login window is open, the
 * login still completes — the next popup finds the session in storage.
 */
export function popupAuth(auth: BidAuth, runtime: RuntimeApi = chromeRuntime()): BidAuth {
  return {
    async login() {
      const r = (await runtime.sendMessage({ type: LOGIN_MESSAGE })) as LoginReply | undefined;
      if (!r) throw new BidUnavailableError("the background did not answer the login — is serveLogin(auth) running in the background script?", null);
      if (!r.ok) throw r.kind === "login" ? new BidLoginError(r.reason, r.message) : new BidUnavailableError(r.message, r.status);
      const session = await auth.session();
      if (!session) throw new BidLoginError("token_refused", "the background logged in, but no session is stored — do popup and background use the same clientId?");
      return session;
    },
    session: (options) => auth.session(options),
    logout: () => auth.logout(),
    // The embedded login runs in the popup itself (no window takes focus); its flow survives a closed popup in storage.
    ...(auth.embedded ? { embedded: () => auth.embedded!() } : {}),
  };
}

type ChromeLike = {
  runtime?: RuntimeApi;
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
function chromeRuntime(): RuntimeApi {
  const rt = ext().runtime;
  if (!rt) throw new Error("web-clipper/auth: no chrome.runtime — run this inside the extension, or pass `runtime`");
  return rt;
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
