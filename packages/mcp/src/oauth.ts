// @broberg/mcp/oauth — OAuth 2.1 (PKCE) for the broberg.ai MCP toolkit.
//
// "A provider, not a server": the SDK ships the endpoints (`mcpAuthRouter` —
// /authorize, /token, /register, /revoke, /.well-known/*). This module ships a
// ready-made `OAuthServerProvider` impl with STATELESS HS256 tokens (auth code,
// access, refresh), so PKCE + refresh work end-to-end without a token database.
//
// Express-coupled (the SDK's `authorize` takes an express `Response`), so this
// lives in a SUB-ENTRY — `import { createOAuthProvider } from "@broberg/mcp/oauth"`
// — keeping the core entry free of express/jose. Install `express` + `jose`
// alongside @broberg/mcp to use it (optional peer deps).

import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { Response as ExpressResponse, RequestHandler } from "express";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import {
  InvalidGrantError,
  InvalidScopeError,
  InvalidTokenError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type {
  OAuthServerProvider,
  AuthorizationParams,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
  OAuthTokenRevocationRequest,
} from "@modelcontextprotocol/sdk/shared/auth.js";

type MaybePromise<T> = T | Promise<T>;
type TokenType = "code" | "access" | "refresh";

export interface OAuthProviderConfig {
  /** HMAC secret for signing the stateless tokens. Use ≥32 random bytes (`openssl rand -hex 32`). */
  secret: string;
  /** The issuer (`iss`) — your MCP server's OAuth issuer URL. */
  issuer: string;
  /** Registered-clients store. Use {@link createInMemoryClientStore} for a default with DCR. */
  clients: OAuthRegisteredClientsStore;
  /** Access-token TTL in seconds (default 3600 = 1h). */
  accessTokenTtl?: number;
  /** Refresh-token TTL in seconds (default 2592000 = 30d). */
  refreshTokenTtl?: number;
  /** Authorization-code TTL in seconds (default 600 = 10m). */
  authCodeTtl?: number;
  /**
   * Decide whether to auto-approve an authorization request. Default: approve
   * (MCP first-party clients). Return false to deny with `access_denied`. For a
   * real consent screen, implement `authorize` on your own provider instead.
   */
  approve?: (client: OAuthClientInformationFull, params: AuthorizationParams) => MaybePromise<boolean>;
  /** Optional denylist check by `jti` — stateless tokens are otherwise un-revocable. */
  isRevoked?: (jti: string) => MaybePromise<boolean>;
  /** Record a `jti` in your denylist on revocation. */
  onRevoke?: (jti: string, type: TokenType) => MaybePromise<void>;
}

interface TokenClaims {
  typ: TokenType;
  client_id: string;
  scope: string;
  /** only on `code` */
  code_challenge?: string;
  /** only on `code` */
  redirect_uri?: string;
}

const DEFAULTS = { access: 3600, refresh: 2_592_000, code: 600 } as const;

/**
 * Build a stateless OAuth 2.1 provider. Mount it with {@link mountOAuthRouter}
 * and protect your MCP route with {@link bearerAuth} (same provider as verifier).
 */
export function createOAuthProvider(config: OAuthProviderConfig): OAuthServerProvider {
  const key = new TextEncoder().encode(config.secret);
  const ttl = {
    access: config.accessTokenTtl ?? DEFAULTS.access,
    refresh: config.refreshTokenTtl ?? DEFAULTS.refresh,
    code: config.authCodeTtl ?? DEFAULTS.code,
  };

  async function sign(claims: TokenClaims, seconds: number): Promise<string> {
    return new SignJWT({ ...claims })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(config.issuer)
      .setIssuedAt()
      .setJti(randomUUID())
      .setExpirationTime(`${seconds}s`)
      .sign(key);
  }

  async function verify(token: string, typ: TokenType): Promise<TokenClaims & { jti: string; exp: number }> {
    let payload: Record<string, unknown>;
    try {
      ({ payload } = await jwtVerify(token, key, { issuer: config.issuer, algorithms: ["HS256"] }));
    } catch {
      throw typ === "access"
        ? new InvalidTokenError("token is invalid or expired")
        : new InvalidGrantError(`${typ} is invalid or expired`);
    }
    if (payload.typ !== typ) {
      const msg = `expected a ${typ} token`;
      throw typ === "access" ? new InvalidTokenError(msg) : new InvalidGrantError(msg);
    }
    if (config.isRevoked && payload.jti && (await config.isRevoked(payload.jti as string))) {
      throw typ === "access" ? new InvalidTokenError("token revoked") : new InvalidGrantError(`${typ} revoked`);
    }
    return payload as unknown as TokenClaims & { jti: string; exp: number };
  }

  async function issueTokens(clientId: string, scope: string): Promise<OAuthTokens> {
    const access_token = await sign({ typ: "access", client_id: clientId, scope }, ttl.access);
    const refresh_token = await sign({ typ: "refresh", client_id: clientId, scope }, ttl.refresh);
    return {
      access_token,
      token_type: "Bearer",
      expires_in: ttl.access,
      scope: scope || undefined,
      refresh_token,
    };
  }

  return {
    get clientsStore() {
      return config.clients;
    },

    async authorize(client, params, res: ExpressResponse) {
      const redirect = new URL(params.redirectUri);
      const approved = config.approve ? await config.approve(client, params) : true;
      if (!approved) {
        redirect.searchParams.set("error", "access_denied");
        if (params.state) redirect.searchParams.set("state", params.state);
        res.redirect(302, redirect.toString());
        return;
      }
      const code = await sign(
        {
          typ: "code",
          client_id: client.client_id,
          scope: (params.scopes ?? []).join(" "),
          code_challenge: params.codeChallenge,
          redirect_uri: params.redirectUri,
        },
        ttl.code,
      );
      redirect.searchParams.set("code", code);
      if (params.state) redirect.searchParams.set("state", params.state);
      res.redirect(302, redirect.toString());
    },

    // The SDK's token handler calls this, then verifies code_verifier against
    // the returned challenge itself (S256) — we only faithfully return it.
    async challengeForAuthorizationCode(_client, authorizationCode) {
      const claims = await verify(authorizationCode, "code");
      return claims.code_challenge ?? "";
    },

    async exchangeAuthorizationCode(client, authorizationCode, _codeVerifier, redirectUri) {
      const claims = await verify(authorizationCode, "code");
      if (claims.client_id !== client.client_id) {
        throw new InvalidGrantError("authorization code was issued to another client");
      }
      if (redirectUri !== undefined && claims.redirect_uri !== redirectUri) {
        throw new InvalidGrantError("redirect_uri does not match the authorization request");
      }
      return issueTokens(client.client_id, claims.scope);
    },

    async exchangeRefreshToken(client, refreshToken, scopes) {
      const claims = await verify(refreshToken, "refresh");
      if (claims.client_id !== client.client_id) {
        throw new InvalidGrantError("refresh token was issued to another client");
      }
      const granted = claims.scope ? claims.scope.split(" ") : [];
      let scope = claims.scope;
      if (scopes && scopes.length > 0) {
        const widened = scopes.filter((s) => !granted.includes(s));
        if (widened.length > 0) {
          throw new InvalidScopeError(`cannot widen scope: ${widened.join(", ")}`);
        }
        scope = scopes.join(" ");
      }
      return issueTokens(client.client_id, scope);
    },

    async verifyAccessToken(token): Promise<AuthInfo> {
      const claims = await verify(token, "access");
      return {
        token,
        clientId: claims.client_id,
        scopes: claims.scope ? claims.scope.split(" ") : [],
        expiresAt: claims.exp,
      };
    },

    async revokeToken(_client, request: OAuthTokenRevocationRequest) {
      if (!config.onRevoke) return;
      // Best-effort: decode without enforcing a type so either token kind revokes.
      for (const typ of ["access", "refresh", "code"] as const) {
        try {
          const claims = await verify(request.token, typ);
          await config.onRevoke(claims.jti, typ);
          return;
        } catch {
          /* try the next type */
        }
      }
    },
  };
}

/**
 * An in-memory {@link OAuthRegisteredClientsStore} with dynamic client
 * registration — fine for single-process servers and tests. Multi-replica
 * deployments should back the store with shared storage instead.
 */
export function createInMemoryClientStore(
  seed: OAuthClientInformationFull[] = [],
): OAuthRegisteredClientsStore {
  const map = new Map(seed.map((c) => [c.client_id, c]));
  return {
    getClient: (id) => map.get(id),
    registerClient: (client) => {
      const full: OAuthClientInformationFull = {
        ...client,
        client_id: randomUUID(),
        client_id_issued_at: Math.floor(Date.now() / 1000),
      };
      map.set(full.client_id, full);
      return full;
    },
  };
}

export interface MountOAuthRouterOptions {
  provider: OAuthServerProvider;
  /** The authorization server issuer URL (https, no query/fragment). */
  issuerUrl: string | URL;
  baseUrl?: string | URL;
  scopesSupported?: string[];
  serviceDocumentationUrl?: string | URL;
  resourceName?: string;
}

/**
 * Mount the SDK's standard MCP auth endpoints (`/authorize`, `/token`,
 * `/register`, `/revoke`, `/.well-known/*`) on an Express app. Thin wrapper over
 * `mcpAuthRouter` — must be installed at the application root.
 */
export function mountOAuthRouter(
  app: { use: (handler: unknown) => unknown },
  opts: MountOAuthRouterOptions,
): void {
  const url = (u?: string | URL) => (u === undefined ? undefined : new URL(String(u)));
  app.use(
    mcpAuthRouter({
      provider: opts.provider,
      issuerUrl: new URL(String(opts.issuerUrl)),
      baseUrl: url(opts.baseUrl),
      scopesSupported: opts.scopesSupported,
      serviceDocumentationUrl: url(opts.serviceDocumentationUrl),
      resourceName: opts.resourceName,
    }),
  );
}

/**
 * Express middleware that requires a valid Bearer access token, verified by the
 * given provider. Protect your MCP route with it. Re-exported from the SDK so a
 * consumer wires the SAME provider as both authorizer and verifier.
 */
export function bearerAuth(
  provider: OAuthServerProvider,
  requiredScopes?: string[],
): RequestHandler {
  return requireBearerAuth({ verifier: provider, requiredScopes });
}
