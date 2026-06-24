// Framework-free OAuth 2.1 core — the stateless HS256 token crypto (auth code /
// access / refresh) + PKCE verification + the clients store, with NO express
// and NO Web/Node HTTP coupling. Both the Express provider (./oauth) and the
// Web-standard routes (./oauth-web) compose these building blocks, so the token
// logic lives in exactly one place.

import { randomUUID, createHash, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import {
  InvalidGrantError,
  InvalidScopeError,
  InvalidTokenError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

export type TokenType = "code" | "access" | "refresh";
export type MaybePromise<T> = T | Promise<T>;

export interface OAuthCoreConfig {
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
  /** Optional denylist check by `jti` — stateless tokens are otherwise un-revocable. */
  isRevoked?: (jti: string) => MaybePromise<boolean>;
  /** Record a `jti` in your denylist on revocation. */
  onRevoke?: (jti: string, type: TokenType) => MaybePromise<void>;
}

interface TokenClaims {
  typ: TokenType;
  client_id: string;
  scope: string;
  /** The resource owner — the END USER (member) this token acts for, bound at /authorize.
   *  This is what makes it the MEMBER's own auth: tools scope to `sub`, not the OAuth client. */
  sub?: string;
  /** only on `code` */
  code_challenge?: string;
  /** only on `code` */
  redirect_uri?: string;
}

export type CodeClaims = TokenClaims & { jti: string; exp: number };

const DEFAULTS = { access: 3600, refresh: 2_592_000, code: 600 } as const;

export interface OAuthCore {
  config: OAuthCoreConfig;
  /** Sign a short-lived authorization code binding the PKCE challenge + redirect_uri + the member `sub`. */
  signCode(input: {
    clientId: string;
    scope: string;
    /** The member/end-user this code (and the tokens it mints) act for. */
    sub?: string;
    codeChallenge?: string;
    redirectUri?: string;
  }): Promise<string>;
  /** Verify + decode an authorization code (signature, type, revocation). */
  readCode(code: string): Promise<CodeClaims>;
  /** Verify + decode a refresh token. */
  readRefresh(refreshToken: string): Promise<CodeClaims>;
  /** PKCE S256: does base64url(sha256(verifier)) match the bound challenge? */
  verifyPkce(verifier: string, challenge?: string): boolean;
  /** Mint a fresh access + refresh token pair for a client, optionally bound to a member `sub`. */
  issueTokens(clientId: string, scope: string, sub?: string): Promise<OAuthTokens>;
  /** Refresh exchange with scope-narrowing enforcement. */
  refresh(refreshToken: string, clientId: string, scopes?: string[]): Promise<OAuthTokens>;
  /** Verify an access token → AuthInfo (throws InvalidTokenError on failure). */
  verifyAccess(token: string): Promise<AuthInfo>;
  /** Best-effort revoke: decode any token kind and call onRevoke(jti, type). */
  revoke(token: string): Promise<void>;
}

export function createOAuthCore(config: OAuthCoreConfig): OAuthCore {
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

  async function verify(token: string, typ: TokenType): Promise<CodeClaims> {
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
    return payload as unknown as CodeClaims;
  }

  async function issueTokens(clientId: string, scope: string, sub?: string): Promise<OAuthTokens> {
    const access_token = await sign({ typ: "access", client_id: clientId, scope, sub }, ttl.access);
    const refresh_token = await sign({ typ: "refresh", client_id: clientId, scope, sub }, ttl.refresh);
    return {
      access_token,
      token_type: "Bearer",
      expires_in: ttl.access,
      scope: scope || undefined,
      refresh_token,
    };
  }

  return {
    config,

    signCode: ({ clientId, scope, sub, codeChallenge, redirectUri }) =>
      sign(
        { typ: "code", client_id: clientId, scope, sub, code_challenge: codeChallenge, redirect_uri: redirectUri },
        ttl.code,
      ),

    readCode: (code) => verify(code, "code"),
    readRefresh: (refreshToken) => verify(refreshToken, "refresh"),

    verifyPkce(verifier, challenge) {
      if (!challenge) return false; // PKCE is mandatory — no challenge means reject
      const computed = base64url(createHash("sha256").update(verifier).digest());
      return constantTimeEqual(computed, challenge);
    },

    issueTokens,

    async refresh(refreshToken, clientId, scopes) {
      const claims = await verify(refreshToken, "refresh");
      if (claims.client_id !== clientId) {
        throw new InvalidGrantError("refresh token was issued to another client");
      }
      const granted = claims.scope ? claims.scope.split(" ") : [];
      let scope = claims.scope;
      if (scopes && scopes.length > 0) {
        const widened = scopes.filter((s) => !granted.includes(s));
        if (widened.length > 0) throw new InvalidScopeError(`cannot widen scope: ${widened.join(", ")}`);
        scope = scopes.join(" ");
      }
      return issueTokens(clientId, scope, claims.sub);
    },

    async verifyAccess(token): Promise<AuthInfo> {
      const claims = await verify(token, "access");
      return {
        token,
        clientId: claims.client_id,
        scopes: claims.scope ? claims.scope.split(" ") : [],
        expiresAt: claims.exp,
        extra: claims.sub ? { sub: claims.sub } : undefined,
      };
    },

    async revoke(token) {
      if (!config.onRevoke) return;
      for (const typ of ["access", "refresh", "code"] as const) {
        try {
          const claims = await verify(token, typ);
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
 * registration — fine for single-process servers and tests. A server that
 * restarts (any Fly redeploy) LOSES its registered clients, so claude.ai's
 * stored client_id breaks — back the store with your DB (Drizzle/libSQL/…) for
 * a durable remote connector.
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

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
