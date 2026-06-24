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
}

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
    const registered = await config.clients.registerClient(
      body as unknown as Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">,
    );
    return json(201, registered);
  }

  async function handleAuthorize(req: Request): Promise<Response> {
    const q = new URL(req.url).searchParams;
    const clientId = q.get("client_id") ?? "";
    const redirectUri = q.get("redirect_uri") ?? "";
    const client = clientId ? await config.clients.getClient(clientId) : undefined;

    // Validate client + redirect_uri BEFORE any redirect (open-redirect guard).
    if (!client) return json(400, { error: "invalid_client", error_description: "unknown client_id" });
    if (!redirectUri || !client.redirect_uris.includes(redirectUri)) {
      return json(400, { error: "invalid_request", error_description: "redirect_uri not registered for this client" });
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
