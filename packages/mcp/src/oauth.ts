// @broberg/mcp/oauth — OAuth 2.1 (PKCE) for EXPRESS apps (musicquiz/dns-mcp shape).
//
// The SDK ships the endpoints (`mcpAuthRouter` — /authorize, /token, /register,
// /revoke, /.well-known/*); this module ships a ready-made `OAuthServerProvider`
// impl over the shared {@link createOAuthCore} (stateless HS256 tokens, PKCE,
// refresh). Express-coupled (the SDK's `authorize` takes an express `Response`),
// so it's a SUB-ENTRY — install `express` + `jose` (optional peers).
//
// On Hono / Bun / Next, use `@broberg/mcp/oauth-web` instead (framework-free).

import { createOAuthCore } from "./oauth-core";
import type { OAuthCoreConfig } from "./oauth-core";
import type { Response as ExpressResponse, RequestHandler } from "express";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { InvalidGrantError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type {
  OAuthServerProvider,
  AuthorizationParams,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
  OAuthTokenRevocationRequest,
} from "@modelcontextprotocol/sdk/shared/auth.js";

type MaybePromise<T> = T | Promise<T>;

export interface OAuthProviderConfig extends OAuthCoreConfig {
  /**
   * Decide whether to auto-approve an authorization request. Default: approve
   * (MCP first-party clients). Return false to deny with `access_denied`. For a
   * real consent screen / member login, render it on your own `authorize` route
   * (or use `@broberg/mcp/oauth-web`, which has a first-class authorize callback).
   */
  approve?: (client: OAuthClientInformationFull, params: AuthorizationParams) => MaybePromise<boolean>;
}

/**
 * Build a stateless OAuth 2.1 provider for Express. Mount it with
 * {@link mountOAuthRouter} and protect your MCP route with {@link bearerAuth}.
 */
export function createOAuthProvider(config: OAuthProviderConfig): OAuthServerProvider {
  const core = createOAuthCore(config);

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
      const code = await core.signCode({
        clientId: client.client_id,
        scope: (params.scopes ?? []).join(" "),
        codeChallenge: params.codeChallenge,
        redirectUri: params.redirectUri,
      });
      redirect.searchParams.set("code", code);
      if (params.state) redirect.searchParams.set("state", params.state);
      res.redirect(302, redirect.toString());
    },

    // The SDK's token handler calls this, then verifies code_verifier against
    // the returned challenge itself (S256) — we only faithfully return it.
    async challengeForAuthorizationCode(_client, authorizationCode) {
      const claims = await core.readCode(authorizationCode);
      return claims.code_challenge ?? "";
    },

    async exchangeAuthorizationCode(client, authorizationCode, _codeVerifier, redirectUri) {
      const claims = await core.readCode(authorizationCode);
      if (claims.client_id !== client.client_id) {
        throw new InvalidGrantError("authorization code was issued to another client");
      }
      if (redirectUri !== undefined && claims.redirect_uri !== redirectUri) {
        throw new InvalidGrantError("redirect_uri does not match the authorization request");
      }
      return core.issueTokens(client.client_id, claims.scope, claims.sub);
    },

    async exchangeRefreshToken(client, refreshToken, scopes): Promise<OAuthTokens> {
      return core.refresh(refreshToken, client.client_id, scopes);
    },

    async verifyAccessToken(token): Promise<AuthInfo> {
      return core.verifyAccess(token);
    },

    async revokeToken(_client, request: OAuthTokenRevocationRequest) {
      await core.revoke(request.token);
    },
  };
}

export { createInMemoryClientStore } from "./oauth-core";

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
 * given provider. Protect your MCP route with it (same provider as verifier).
 */
export function bearerAuth(
  provider: OAuthServerProvider,
  requiredScopes?: string[],
): RequestHandler {
  return requireBearerAuth({ verifier: provider, requiredScopes });
}
