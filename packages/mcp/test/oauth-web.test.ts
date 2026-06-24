import { describe, it, expect } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { createOAuthRoutes, createInMemoryClientStore } from "../src/oauth-web";
import type { AuthorizeParams } from "../src/oauth-web";

const SECRET = "test-secret-test-secret-test-secret-0123456789";
const ISSUER = "https://club.example";
const RESOURCE = "https://club.example/mcp";

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function pkce() {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

/** Build routes where /authorize approves as a fixed member (the site-login stand-in). */
function routesFor(member = "member-42", capture?: (p: AuthorizeParams) => void) {
  return createOAuthRoutes({
    secret: SECRET,
    issuer: ISSUER,
    resource: RESOURCE,
    scopesSupported: ["club:read"],
    clients: createInMemoryClientStore(),
    authorize: (_req, params) => {
      capture?.(params);
      return { sub: member, scope: "club:read" };
    },
  });
}

describe("oauth-web — discovery metadata", () => {
  it("serves authorization-server metadata with S256 PKCE", async () => {
    const r = routesFor();
    const res = await r.handle(new Request(`${ISSUER}/.well-known/oauth-authorization-server`));
    const m = await res!.json();
    expect(m.issuer).toBe(ISSUER);
    expect(m.authorization_endpoint).toBe(`${ISSUER}/authorize`);
    expect(m.token_endpoint).toBe(`${ISSUER}/token`);
    expect(m.registration_endpoint).toBe(`${ISSUER}/register`);
    expect(m.code_challenge_methods_supported).toContain("S256");
  });

  it("serves protected-resource metadata (incl. the /mcp path-suffixed variant)", async () => {
    const r = routesFor();
    for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
      const res = await r.handle(new Request(`${ISSUER}${path}`));
      const m = await res!.json();
      expect(m.resource).toBe(RESOURCE);
      expect(m.authorization_servers).toEqual([ISSUER]);
    }
  });

  it("returns null for a non-OAuth path (host continues to /mcp)", async () => {
    expect(await routesFor().handle(new Request(`${ISSUER}/mcp`, { method: "POST" }))).toBeNull();
  });
});

describe("oauth-web — full claude.ai flow: DCR → authorize → token → bearer", () => {
  it("registers a client, authorizes a member, exchanges the code, and the token carries the member sub", async () => {
    const seen: AuthorizeParams[] = [];
    const r = routesFor("member-42", (p) => seen.push(p));

    // 1) Dynamic Client Registration (claude.ai self-registers).
    const reg = await r.handle(
      new Request(`${ISSUER}/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], client_name: "Claude" }),
      }),
    );
    expect(reg!.status).toBe(201);
    const client = await reg!.json();
    expect(client.client_id).toBeTruthy();

    // 2) Authorize (PKCE S256) → 302 redirect with a code.
    const { verifier, challenge } = pkce();
    const authUrl = new URL(`${ISSUER}/authorize`);
    authUrl.search = new URLSearchParams({
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: "https://claude.ai/api/mcp/auth_callback",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "xyz",
      scope: "club:read",
    }).toString();
    const authRes = await r.handle(new Request(authUrl));
    expect(authRes!.status).toBe(302);
    const loc = new URL(authRes!.headers.get("location")!);
    expect(loc.searchParams.get("state")).toBe("xyz");
    const code = loc.searchParams.get("code")!;
    expect(code).toBeTruthy();
    expect(seen[0].clientId).toBe(client.client_id); // the callback saw the request

    // 3) Token exchange (form-encoded, PKCE verifier).
    const tokRes = await r.handle(
      new Request(`${ISSUER}/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          code_verifier: verifier,
          redirect_uri: "https://claude.ai/api/mcp/auth_callback",
          client_id: client.client_id,
        }).toString(),
      }),
    );
    expect(tokRes!.status).toBe(200);
    const tokens = await tokRes!.json();
    expect(tokens.token_type).toBe("Bearer");
    expect(tokens.access_token).toBeTruthy();

    // 4) The access token verifies and carries the MEMBER (sub) — their own auth.
    const info = await r.verifyBearer(
      new Request(`${ISSUER}/mcp`, { headers: { authorization: `Bearer ${tokens.access_token}` } }),
    );
    expect(info.scopes).toEqual(["club:read"]);
    expect(info.extra?.sub).toBe("member-42");

    // 5) Refresh keeps the member binding.
    const refRes = await r.handle(
      new Request(`${ISSUER}/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: client.client_id }).toString(),
      }),
    );
    const refreshed = await refRes!.json();
    const info2 = await r.verifyBearer(new Request(`${ISSUER}/mcp`, { headers: { authorization: `Bearer ${refreshed.access_token}` } }));
    expect(info2.extra?.sub).toBe("member-42");
  });

  it("rejects a wrong PKCE verifier (invalid_grant)", async () => {
    const r = routesFor();
    const reg = await (await r.handle(new Request(`${ISSUER}/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] }) }))!)!.json();
    const { challenge } = pkce();
    const authUrl = new URL(`${ISSUER}/authorize`);
    authUrl.search = new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: "https://claude.ai/api/mcp/auth_callback", code_challenge: challenge, code_challenge_method: "S256", scope: "club:read" }).toString();
    const code = new URL((await r.handle(new Request(authUrl)))!.headers.get("location")!).searchParams.get("code")!;
    const bad = await r.handle(new Request(`${ISSUER}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: "wrong-verifier", redirect_uri: "https://claude.ai/api/mcp/auth_callback", client_id: reg.client_id }).toString() }));
    expect(bad!.status).toBe(400);
    expect((await bad!.json()).error).toBe("invalid_grant");
  });
});

describe("oauth-web — guards", () => {
  it("rejects an unknown client_id at /authorize (no open redirect)", async () => {
    const res = await routesFor().handle(new Request(`${ISSUER}/authorize?response_type=code&client_id=nope&redirect_uri=https://evil.example/cb&code_challenge=x&code_challenge_method=S256`));
    expect(res!.status).toBe(400);
  });

  it("challenge() is a 401 pointing at the protected-resource metadata", () => {
    const res = routesFor().challenge();
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("oauth-protected-resource");
  });

  it("a member login that defers returns the host's own Response (e.g. redirect to login)", async () => {
    const r = createOAuthRoutes({
      secret: SECRET, issuer: ISSUER, resource: RESOURCE, clients: createInMemoryClientStore(),
      authorize: () => ({ response: new Response(null, { status: 302, headers: { location: `${ISSUER}/login` } }) }),
    });
    const reg = await (await r.handle(new Request(`${ISSUER}/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] }) }))!)!.json();
    const authUrl = new URL(`${ISSUER}/authorize`);
    authUrl.search = new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: "https://claude.ai/api/mcp/auth_callback", code_challenge: "x".repeat(43), code_challenge_method: "S256" }).toString();
    const res = await r.handle(new Request(authUrl));
    expect(res!.status).toBe(302);
    expect(res!.headers.get("location")).toBe(`${ISSUER}/login`); // host's login page, not a code
  });
});
