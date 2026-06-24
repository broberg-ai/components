import { describe, it, expect, vi } from "vitest";
import type { Response } from "express";
import {
  createOAuthProvider,
  createInMemoryClientStore,
  mountOAuthRouter,
  bearerAuth,
} from "../src/oauth";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";

const SECRET = "test-secret-test-secret-test-secret-0123456789";
const REDIRECT = "https://app.example/cb";

const client: OAuthClientInformationFull = {
  client_id: "client-1",
  redirect_uris: [REDIRECT],
};

const params = (over: Partial<AuthorizationParams> = {}): AuthorizationParams => ({
  redirectUri: REDIRECT,
  codeChallenge: "challenge-abc",
  scopes: ["read", "write"],
  state: "xyz",
  ...over,
});

function provider(config?: Partial<Parameters<typeof createOAuthProvider>[0]>) {
  return createOAuthProvider({
    secret: SECRET,
    issuer: "https://mcp.example",
    clients: createInMemoryClientStore([client]),
    ...config,
  });
}

/** Run authorize and pull the `code` out of the redirect URL. */
async function authorizeAndGetCode(p: ReturnType<typeof provider>, prm = params()): Promise<string> {
  const redirect = vi.fn();
  await p.authorize(client, prm, { redirect } as unknown as Response);
  const url = new URL(redirect.mock.calls[0][1] as string);
  return url.searchParams.get("code")!;
}

describe("createOAuthProvider — authorization-code flow", () => {
  it("authorize → code → exchange → verifyAccessToken round-trips identity + scopes", async () => {
    const p = provider();
    const code = await authorizeAndGetCode(p);

    // the PKCE challenge bound into the code is returned verbatim (SDK verifies it)
    expect(await p.challengeForAuthorizationCode(client, code)).toBe("challenge-abc");

    const tokens = await p.exchangeAuthorizationCode(client, code, undefined, REDIRECT);
    expect(tokens.token_type).toBe("Bearer");
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.refresh_token).toBeTruthy();

    const info = await p.verifyAccessToken(tokens.access_token);
    expect(info.clientId).toBe("client-1");
    expect(info.scopes).toEqual(["read", "write"]);
    expect(info.expiresAt).toBeTypeOf("number");
  });

  it("authorize denies (access_denied) when approve returns false, preserving state", async () => {
    const p = provider({ approve: () => false });
    const redirect = vi.fn();
    await p.authorize(client, params(), { redirect } as unknown as Response);
    const url = new URL(redirect.mock.calls[0][1] as string);
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(url.searchParams.get("state")).toBe("xyz");
    expect(url.searchParams.get("code")).toBeNull();
  });

  it("rejects an authorization code presented by a different client", async () => {
    const p = provider();
    const code = await authorizeAndGetCode(p);
    const other = { ...client, client_id: "client-2" };
    await expect(p.exchangeAuthorizationCode(other, code, undefined, REDIRECT)).rejects.toThrow(
      /another client/,
    );
  });

  it("rejects a redirect_uri that does not match the authorization request", async () => {
    const p = provider();
    const code = await authorizeAndGetCode(p);
    await expect(
      p.exchangeAuthorizationCode(client, code, undefined, "https://evil.example/cb"),
    ).rejects.toThrow(/redirect_uri/);
  });
});

describe("createOAuthProvider — refresh + verify", () => {
  it("refresh issues a new access token and allows narrowing scope", async () => {
    const p = provider();
    const code = await authorizeAndGetCode(p);
    const { refresh_token } = await p.exchangeAuthorizationCode(client, code, undefined, REDIRECT);

    const narrowed = await p.exchangeRefreshToken(client, refresh_token!, ["read"]);
    const info = await p.verifyAccessToken(narrowed.access_token);
    expect(info.scopes).toEqual(["read"]);
  });

  it("refresh rejects scope widening", async () => {
    const p = provider();
    const code = await authorizeAndGetCode(p);
    const { refresh_token } = await p.exchangeAuthorizationCode(client, code, undefined, REDIRECT);
    await expect(p.exchangeRefreshToken(client, refresh_token!, ["admin"])).rejects.toThrow(
      /widen scope/,
    );
  });

  it("verifyAccessToken rejects a refresh token used as an access token", async () => {
    const p = provider();
    const code = await authorizeAndGetCode(p);
    const { refresh_token } = await p.exchangeAuthorizationCode(client, code, undefined, REDIRECT);
    await expect(p.verifyAccessToken(refresh_token!)).rejects.toThrow(/expected a access token/);
  });

  it("verifyAccessToken rejects a garbage token", async () => {
    await expect(provider().verifyAccessToken("not.a.jwt")).rejects.toThrow(/invalid or expired/);
  });

  it("honours an isRevoked denylist", async () => {
    let revoked = false;
    const p = provider({ isRevoked: () => revoked });
    const code = await authorizeAndGetCode(p);
    const { access_token } = await p.exchangeAuthorizationCode(client, code, undefined, REDIRECT);
    expect(await p.verifyAccessToken(access_token)).toBeTruthy();
    revoked = true;
    await expect(p.verifyAccessToken(access_token)).rejects.toThrow(/revoked/);
  });

  it("revokeToken decodes the token and reports its jti + type", async () => {
    const onRevoke = vi.fn();
    const p = provider({ onRevoke });
    const code = await authorizeAndGetCode(p);
    const { access_token } = await p.exchangeAuthorizationCode(client, code, undefined, REDIRECT);
    await p.revokeToken!(client, { token: access_token });
    expect(onRevoke).toHaveBeenCalledWith(expect.any(String), "access");
  });
});

describe("createInMemoryClientStore + wiring", () => {
  it("getClient returns a seeded client; registerClient mints an id", async () => {
    const store = createInMemoryClientStore([client]);
    expect((await store.getClient("client-1"))?.client_id).toBe("client-1");
    const reg = await store.registerClient!({ redirect_uris: ["https://new.example/cb"] });
    expect(reg.client_id).toBeTruthy();
    expect((await store.getClient(reg.client_id))?.client_id).toBe(reg.client_id);
  });

  it("mountOAuthRouter installs a router via app.use; bearerAuth returns middleware", () => {
    const use = vi.fn();
    mountOAuthRouter({ use }, { provider: provider(), issuerUrl: "https://mcp.example" });
    expect(use).toHaveBeenCalledTimes(1);
    expect(typeof bearerAuth(provider(), ["read"])).toBe("function");
  });
});
