// @broberg/mcp/oauth-web — framework-FREE OAuth 2.1 (PKCE + DCR) for Stack-B.
//
// The SDK's mcpAuthRouter is Express-only; this is the Web-standard equivalent
// (`Request => Response`) so the OAuth endpoints mount in Hono / Bun / Next /
// Deno — no express. It implements exactly what claude.ai's remote connector
// needs to discover + connect: the two `.well-known` metadata docs, Dynamic
// Client Registration (/register), the PKCE authorize + token endpoints, and a
// 401/WWW-Authenticate challenge to bootstrap discovery on the /mcp route.
//
// The /authorize step delegates to YOUR member login (the `authorize` callback),
// so the issued token carries the MEMBER's id (`sub`) — it's the member's own
// auth, not a shared key. Needs `jose` (peer); no express.
//
// ── THREE THINGS THAT ONLY BITE THE CONSUMER WHO FALLS IN THEM ──────────────
// Filed by pitch-vault (F007.13) after getting all three right without being
// able to say why so precisely. The package behaves correctly in every case
// below; what was missing was the sentence that tells you so before you lose
// an afternoon.
//
// 1. THE METADATA ADDRESS CARRIES THE RESOURCE'S PATH ON THE END (RFC 9728).
//    `challenge()` emits `/.well-known/oauth-protected-resource<mcpPath>`, and
//    `handle()` answers both the bare and the suffixed form. But if you mount
//    the routes INDIVIDUALLY instead of routing through `handle()`, you must
//    match `/.well-known/oauth-protected-resource/**` — not just the bare
//    segment. Next's App Router is the trap: a static segment directory does
//    NOT match a path tail, so the bare path 200s, the suffixed one 404s, and
//    your 401 sends the client to an address that does not exist. The symptom
//    is "the connector just will not connect" — nothing points at this.
//
// 2. `isRevoked`/`onRevoke` ARE YOURS, AND THIS PACKAGE KEEPS NO STATE.
//    A database lookup on every call is the intended use, not a detour around
//    a missing cache. It is the only way the answer can be right across
//    replicas — an in-process set is correct until the second instance starts.
//    (Same shape as `createInMemoryClientStore`, which is for tests and demos:
//    persist your clients, or a deploy logs every connector out and it looks
//    like "it worked yesterday".)
//
// 3. A `jti` AND A CONNECTION ARE TWO DIFFERENT REVOCATIONS.
//    A jti on a denylist kills ONE token. A revoked connection must also cover
//    the NEXT token the connector mints with its refresh. Cover only the first
//    and your "Disconnect" button appears to work while access continues until
//    the token expires on its own.

// ── F007.14 — CONSENT, REDIRECT ALLOWLIST, SINGLE-USE CODES (0.7.0) ─────────
// Up to 0.6.0 this module issued an authorization code the moment the
// `authorize` callback returned `{ sub }`, and /register took ANY redirect_uri.
// The callback reads a session cookie, and SameSite=Lax sends that cookie on a
// top-level click — so one link carrying an attacker's own client and redirect
// minted a token for a logged-in member who saw nothing. PKCE does not help:
// the attacker owns the client, so they own the verifier. Measured at xrt81
// (#1635): a 30-day club:read token from one click.
//
// Now: (1) redirect URIs must be on `allowedRedirectHosts` (secure default:
// the claude/chatgpt connector hosts + loopback), at /register AND /authorize;
// (2) an approval renders a CONSENT PAGE — the code is only issued on a POST
// carrying a signed, short-lived, request-bound token; (3) a code can be
// redeemed once.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createOAuthCore, type OAuthCoreConfig, type OAuthCore } from "./oauth-core";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

type MaybePromise<T> = T | Promise<T>;

/** The validated authorization-request parameters handed to your `authorize` callback. */
export interface AuthorizeParams {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope: string[];
  state?: string;
  resource?: string;
}

/**
 * What your `authorize` callback returns:
 *  - `{ sub, scope? }` — APPROVED, bound to this member (the token acts for `sub`).
 *  - `{ deny }` — refuse (redirects back with `error=access_denied`).
 *  - `{ response }` — you take over (e.g. a 302 to your login page, or a consent screen).
 */
export type AuthorizeDecision =
  | { sub: string; scope?: string }
  | { deny: string }
  | { response: Response };

export interface OAuthWebConfig extends OAuthCoreConfig {
  /** The MCP endpoint these tokens are FOR (the protected resource), e.g. "https://club.example/mcp". */
  resource: string;
  /** Scopes advertised in the metadata. */
  scopesSupported?: string[];
  /**
   * The authorize decision — plug in YOUR member login here. Read the member's
   * site session from `req`; if not logged in, return `{ response }` = a 302 to
   * your login page (with a return-to back to this authorize URL). Once logged
   * in, return `{ sub: memberId, scope }` so the token acts for that member.
   */
  authorize: (req: Request, params: AuthorizeParams) => MaybePromise<AuthorizeDecision>;
  /** Endpoint paths (relative to the issuer origin). Defaults shown. */
  paths?: { authorize?: string; token?: string; register?: string; revoke?: string };
  /**
   * F007.14 — hosts a redirect_uri may point at. Checked at /register AND at
   * /authorize. Default {@link DEFAULT_REDIRECT_HOSTS} (claude.ai, claude.com,
   * chatgpt.com, chat.openai.com). Loopback (localhost, 127.0.0.1, [::1]) is
   * always allowed; every other host must be https.
   */
  allowedRedirectHosts?: string[];
  /** F007.14 — language of the built-in consent page. Default "da". */
  consentLang?: "da" | "en";
  /**
   * F007.14 — your own consent page. Must render a POST form to `info.action`
   * containing every `info.fields` entry as a hidden input, plus a submit named
   * `decision` with value `approve` or `deny`. The package sets the framing
   * headers; return the full HTML document.
   */
  renderConsent?: (info: ConsentInfo) => string;
  /**
   * F007.14 — mark an authorization code used. Return true the FIRST time a
   * `jti` is seen, false after. Default: in-memory (correct for one instance);
   * pass a database-backed one when you run several replicas.
   */
  consumeCode?: (jti: string, expiresAt: number) => MaybePromise<boolean>;
}

/** What the consent page shows. All strings are raw; escape them when rendering. */
export interface ConsentInfo {
  clientName: string;
  redirectHost: string;
  scopes: string[];
  action: string;
  fields: Record<string, string>;
  lang: "da" | "en";
}

/** Connector hosts allowed by default (F007.14). Loopback is always allowed in addition. */
export const DEFAULT_REDIRECT_HOSTS: readonly string[] = ["claude.ai", "claude.com", "chatgpt.com", "chat.openai.com"];
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const CONSENT_TTL_MS = 5 * 60 * 1000;

export interface OAuthRoutes {
  /** Route any OAuth request (metadata / register / authorize / token / revoke); returns null if not an OAuth path. */
  handle(req: Request): Promise<Response | null>;
  /** Verify a Bearer access token → AuthInfo (with `extra.sub` = member). Throws on invalid. */
  verifyBearer(req: Request): Promise<AuthInfo>;
  /** A 401 + WWW-Authenticate (pointing at the protected-resource metadata) to gate the /mcp route. */
  challenge(): Response;
  /** The underlying token core, for advanced use. */
  core: OAuthCore;
}

const JSON_HEADERS = { "content-type": "application/json" } as const;

export function createOAuthRoutes(config: OAuthWebConfig): OAuthRoutes {
  const core = createOAuthCore(config);
  const allowedHosts = config.allowedRedirectHosts ?? DEFAULT_REDIRECT_HOSTS;
  const redirectAllowed = (uri: string): boolean => {
    let u: URL;
    try {
      u = new URL(uri);
    } catch {
      return false;
    }
    if (LOOPBACK.has(u.hostname)) return u.protocol === "http:" || u.protocol === "https:";
    return u.protocol === "https:" && allowedHosts.includes(u.hostname);
  };

  // Single-use codes. In-memory default: correct for one instance; consumers
  // with replicas pass consumeCode backed by their database.
  const usedCodes = new Map<string, number>();
  const consumeCode =
    config.consumeCode ??
    ((jti: string, expiresAt: number) => {
      const now = Date.now();
      for (const [k, exp] of usedCodes) if (exp < now) usedCodes.delete(k);
      if (usedCodes.has(jti)) return false;
      usedCodes.set(jti, expiresAt);
      return true;
    });

  // The consent token binds the approval to THIS request: who, which client,
  // which redirect, which PKCE challenge, until when. HMAC with the same secret
  // that signs the tokens.
  const consentKey = createHmac("sha256", config.secret).update("broberg-mcp-consent-v1").digest();
  const consentPayload = (b: { sub: string; clientId: string; redirectUri: string; codeChallenge: string; exp: number; n: string }) =>
    JSON.stringify([b.sub, b.clientId, b.redirectUri, b.codeChallenge, b.exp, b.n]);
  const signConsent = (b: Parameters<typeof consentPayload>[0]) => {
    const body = Buffer.from(consentPayload(b)).toString("base64url");
    const mac = createHmac("sha256", consentKey).update(body).digest("base64url");
    return `${body}.${mac}`;
  };
  const readConsent = (token: string): { sub: string; clientId: string; redirectUri: string; codeChallenge: string; exp: number } | null => {
    const [body, mac] = token.split(".");
    if (!body || !mac) return null;
    const want = createHmac("sha256", consentKey).update(body).digest();
    const got = Buffer.from(mac, "base64url");
    if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
    try {
      const [sub, clientId, redirectUri, codeChallenge, exp] = JSON.parse(Buffer.from(body, "base64url").toString()) as [string, string, string, string, number];
      return { sub, clientId, redirectUri, codeChallenge, exp };
    } catch {
      return null;
    }
  };
  const issuer = trimSlash(config.issuer);
  const paths = {
    authorize: config.paths?.authorize ?? "/authorize",
    token: config.paths?.token ?? "/token",
    register: config.paths?.register ?? "/register",
    revoke: config.paths?.revoke ?? "/revoke",
  };
  const mcpPath = new URL(config.resource).pathname; // e.g. "/mcp"
  const PRM_PATH = "/.well-known/oauth-protected-resource";
  const AS_PATH = "/.well-known/oauth-authorization-server";
  const prmUrl = `${issuer}${PRM_PATH}${mcpPath === "/" ? "" : mcpPath}`;

  const asMetadata = () => ({
    issuer,
    authorization_endpoint: issuer + paths.authorize,
    token_endpoint: issuer + paths.token,
    registration_endpoint: issuer + paths.register,
    revocation_endpoint: issuer + paths.revoke,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    ...(config.scopesSupported ? { scopes_supported: config.scopesSupported } : {}),
  });

  const prMetadata = () => ({
    resource: config.resource,
    authorization_servers: [issuer],
    bearer_methods_supported: ["header"],
    ...(config.scopesSupported ? { scopes_supported: config.scopesSupported } : {}),
  });

  async function handleRegister(req: Request): Promise<Response> {
    if (!config.clients.registerClient) {
      return json(400, { error: "invalid_request", error_description: "dynamic client registration unsupported" });
    }
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json(400, { error: "invalid_client_metadata", error_description: "body is not JSON" });
    }
    if (!Array.isArray(body.redirect_uris) || body.redirect_uris.length === 0) {
      return json(400, { error: "invalid_redirect_uri", error_description: "redirect_uris is required" });
    }
    const refused = body.redirect_uris.find((u) => typeof u !== "string" || !redirectAllowed(u));
    if (refused !== undefined) {
      return json(400, {
        error: "invalid_redirect_uri",
        error_description: `redirect_uri not allowed: ${String(refused)} (allowed hosts: ${allowedHosts.join(", ")} + loopback)`,
      });
    }
    const registered = await config.clients.registerClient(
      body as unknown as Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">,
    );
    return json(201, registered);
  }

  async function handleAuthorize(req: Request): Promise<Response> {
    const isPost = req.method.toUpperCase() === "POST";
    // A POST is the consent decision; its parameters come from the form body.
    // The original request (with its cookies) still goes to your callback.
    const q = isPost ? new URLSearchParams(await req.clone().text()) : new URL(req.url).searchParams;
    const clientId = q.get("client_id") ?? "";
    const redirectUri = q.get("redirect_uri") ?? "";
    const client = clientId ? await config.clients.getClient(clientId) : undefined;

    // Validate client + redirect_uri BEFORE any redirect (open-redirect guard).
    if (!client) return json(400, { error: "invalid_client", error_description: "unknown client_id" });
    if (!redirectUri || !client.redirect_uris.includes(redirectUri)) {
      return json(400, { error: "invalid_request", error_description: "redirect_uri not registered for this client" });
    }
    // Defence in depth: a client registered before 0.7.0 may carry any redirect.
    if (!redirectAllowed(redirectUri)) {
      return json(400, { error: "invalid_request", error_description: "redirect_uri host is not allowed" });
    }
    const state = q.get("state") ?? undefined;
    const back = new URL(redirectUri);

    if (q.get("response_type") !== "code") {
      return redirectErr(back, "unsupported_response_type", state);
    }
    const codeChallenge = q.get("code_challenge") ?? "";
    if (q.get("code_challenge_method") !== "S256" || !codeChallenge) {
      return redirectErr(back, "invalid_request", state); // PKCE S256 mandatory
    }

    const params: AuthorizeParams = {
      clientId,
      redirectUri,
      codeChallenge,
      codeChallengeMethod: "S256",
      scope: (q.get("scope") ?? "").split(/\s+/).filter(Boolean),
      state,
      resource: q.get("resource") ?? undefined,
    };

    const decision = await config.authorize(req, params);
    if ("response" in decision) return decision.response; // host took over (login page, etc.)
    if ("deny" in decision) return redirectErr(back, "access_denied", state);

    if (!isPost) {
      // F007.14 — approval by the callback is NOT consent. Show what is being
      // granted, to whom, and issue nothing until the member presses approve.
      const token = signConsent({
        sub: decision.sub,
        clientId,
        redirectUri,
        codeChallenge,
        exp: Date.now() + CONSENT_TTL_MS,
        n: randomBytes(9).toString("base64url"),
      });
      const fields: Record<string, string> = {
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        scope: params.scope.join(" "),
        consent_token: token,
      };
      if (state) fields.state = state;
      if (params.resource) fields.resource = params.resource;
      const info: ConsentInfo = {
        clientName: typeof client.client_name === "string" && client.client_name ? client.client_name : clientId,
        redirectHost: back.host,
        scopes: (decision.scope ?? params.scope.join(" ")).split(/\s+/).filter(Boolean),
        action: issuer + paths.authorize,
        fields,
        lang: config.consentLang ?? "da",
      };
      return consentResponse((config.renderConsent ?? renderConsentPage)(info));
    }

    // POST: the decision. The token must be ours, unexpired, and bound to the
    // same member, client, redirect and PKCE challenge as this request.
    const consent = readConsent(q.get("consent_token") ?? "");
    if (
      !consent ||
      consent.exp < Date.now() ||
      consent.sub !== decision.sub ||
      consent.clientId !== clientId ||
      consent.redirectUri !== redirectUri ||
      consent.codeChallenge !== codeChallenge
    ) {
      return json(400, { error: "invalid_request", error_description: "consent token missing, expired or not for this request" });
    }
    if (q.get("decision") !== "approve") return redirectErr(back, "access_denied", state);

    const code = await core.signCode({
      clientId,
      sub: decision.sub,
      scope: decision.scope ?? params.scope.join(" "),
      codeChallenge,
      redirectUri,
    });
    back.searchParams.set("code", code);
    if (state) back.searchParams.set("state", state);
    return redirect(back.toString());
  }

  async function handleToken(req: Request): Promise<Response> {
    const form = new URLSearchParams(await req.text());
    const grantType = form.get("grant_type");
    try {
      if (grantType === "authorization_code") {
        const code = form.get("code") ?? "";
        const verifier = form.get("code_verifier") ?? "";
        const redirectUri = form.get("redirect_uri") ?? undefined;
        const clientId = form.get("client_id") ?? "";
        const claims = await core.readCode(code);
        if (!core.verifyPkce(verifier, claims.code_challenge)) {
          return json(400, { error: "invalid_grant", error_description: "PKCE verification failed" });
        }
        if (claims.client_id !== clientId) {
          return json(400, { error: "invalid_grant", error_description: "code was issued to another client" });
        }
        if (redirectUri !== undefined && claims.redirect_uri !== redirectUri) {
          return json(400, { error: "invalid_grant", error_description: "redirect_uri mismatch" });
        }
        // F007.14 — a code is redeemed once. Checked AFTER PKCE, so a guess with
        // the wrong verifier cannot burn the legitimate client's code.
        if (!(await consumeCode(claims.jti, claims.exp * 1000))) {
          return json(400, { error: "invalid_grant", error_description: "authorization code already used" });
        }
        const tokens = await core.issueTokens(claims.client_id, claims.scope, claims.sub);
        return json(200, tokens);
      }
      if (grantType === "refresh_token") {
        const refreshToken = form.get("refresh_token") ?? "";
        const clientId = form.get("client_id") ?? "";
        const scopeParam = form.get("scope");
        const scopes = scopeParam ? scopeParam.split(/\s+/).filter(Boolean) : undefined;
        const tokens = await core.refresh(refreshToken, clientId, scopes);
        return json(200, tokens);
      }
      return json(400, { error: "unsupported_grant_type" });
    } catch (err) {
      return json(400, { error: errorCode(err), error_description: errorMessage(err) });
    }
  }

  async function handleRevoke(req: Request): Promise<Response> {
    const form = new URLSearchParams(await req.text());
    const token = form.get("token") ?? "";
    if (token) await core.revoke(token);
    return new Response(null, { status: 200 }); // RFC 7009: always 200
  }

  return {
    core,

    challenge() {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...JSON_HEADERS, "www-authenticate": `Bearer resource_metadata="${prmUrl}"` },
      });
    },

    async verifyBearer(req) {
      const auth = req.headers.get("authorization") ?? "";
      const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
      if (!m) throw new Error("missing bearer token");
      return core.verifyAccess(m[1]);
    },

    async handle(req) {
      const url = new URL(req.url);
      const path = url.pathname;
      const method = req.method.toUpperCase();

      if (method === "GET" && path === AS_PATH) return json(200, asMetadata());
      if (method === "GET" && path.startsWith(PRM_PATH)) return json(200, prMetadata());
      if (method === "POST" && path === paths.register) return handleRegister(req);
      if (path === paths.authorize) return handleAuthorize(req); // GET (and POST tolerated)
      if (method === "POST" && path === paths.token) return handleToken(req);
      if (method === "POST" && path === paths.revoke) return handleRevoke(req);
      return null; // not an OAuth route — let the host continue (to /mcp etc.)
    },
  };
}

const CONSENT_TEXT = {
  da: { title: "Giv adgang?", body: "vil have adgang til din konto", scopes: "Adgang", redirect: "Du sendes videre til", approve: "Godkend", deny: "Afvis" },
  en: { title: "Allow access?", body: "wants to access your account", scopes: "Access", redirect: "You will be sent to", approve: "Allow", deny: "Deny" },
} as const;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** The built-in consent page (F007.14). Plain HTML, no script. */
export function renderConsentPage(info: ConsentInfo): string {
  const t = CONSENT_TEXT[info.lang];
  const hidden = Object.entries(info.fields)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join("");
  const scopes = info.scopes.length ? `<p>${t.scopes}: <code>${info.scopes.map(esc).join(" ")}</code></p>` : "";
  return `<!doctype html><html lang="${info.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t.title}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:420px;margin:12vh auto;padding:0 16px}h1{font-size:20px}code{font-size:13px}.row{display:flex;gap:8px;margin-top:20px}button{flex:1;padding:10px;font:inherit;font-weight:600;border-radius:8px;border:1px solid #888;cursor:pointer}</style></head>
<body><h1>${t.title}</h1><p><strong data-testid="oauth-consent-client">${esc(info.clientName)}</strong> ${t.body}.</p>${scopes}
<p>${t.redirect} <strong data-testid="oauth-consent-redirect-host">${esc(info.redirectHost)}</strong>.</p>
<form method="post" action="${esc(info.action)}">${hidden}<div class="row">
<button type="submit" name="decision" value="deny" data-testid="oauth-consent-deny">${t.deny}</button>
<button type="submit" name="decision" value="approve" data-testid="oauth-consent-approve">${t.approve}</button>
</div></form></body></html>`;
}

function consentResponse(html: string): Response {
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-frame-options": "DENY",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https: http://localhost:* http://127.0.0.1:*; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
    },
  });
}

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

function redirectErr(base: URL, error: string, state?: string): Response {
  base.searchParams.set("error", error);
  if (state) base.searchParams.set("state", state);
  return redirect(base.toString());
}

function trimSlash(u: string): string {
  return u.replace(/\/+$/, "");
}

function errorCode(err: unknown): string {
  const c = (err as { errorCode?: string })?.errorCode;
  return typeof c === "string" ? c : "invalid_grant";
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export { createInMemoryClientStore } from "./oauth-core";
