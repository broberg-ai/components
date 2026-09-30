/**
 * components-F084.51 — a consumer can see WHICH claims were signed.
 *
 * The login result used to be one merged object: the verified ID token with
 * the userinfo response spread OVER it. A consumer gating on
 * `email_verified === true` could not tell that the value came from an
 * unsigned HTTP response rather than the signed token — and on BID it always
 * does: measured by broberg-id on 20 Sep 2026 against the real service, the ID
 * token carries acr · at_hash · aud · auth_time · exp · iat · iss · nonce · sid
 * · sub, and email + email_verified exist ONLY in /oauth2/userinfo.
 *
 * The fake below serves exactly that shape by default, and each case changes
 * one thing. Every direction is asserted: a marker that always says the same
 * thing proves nothing.
 */
import { describe, expect, test } from "vitest";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { loadSsoConfig } from "../src/config.js";
import { createSsoClient } from "../src/client.js";

const ISSUER = "https://id.broberg.ai";
const CLIENT_ID = "test-app";
const ENV = {
  BID_ISSUER: ISSUER,
  SSO_CLIENT_ID: CLIENT_ID,
  SSO_REDIRECT_URI: "https://app.example/auth/callback",
  SSO_COOKIE_SECRET: "s".repeat(64),
} as NodeJS.ProcessEnv;

/** A fake issuer: `tokenClaims` go into the signed ID token, `userinfo` is served unsigned. */
async function login(tokenClaims: Record<string, unknown>, userinfo: Record<string, unknown> | null) {
  const pair = await generateKeyPair("RS256", { extractable: true });
  let nonce: string | undefined;
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith("/.well-known/openid-configuration")) {
      return Response.json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/oauth2/authorize`,
        token_endpoint: `${ISSUER}/oauth2/token`,
        jwks_uri: `${ISSUER}/jwks`,
        userinfo_endpoint: `${ISSUER}/oauth2/userinfo`,
      });
    }
    if (url.endsWith("/jwks")) {
      return Response.json({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" }] });
    }
    if (url.endsWith("/oauth2/token")) {
      const idToken = await new SignJWT({ ...(nonce ? { nonce } : {}), sid: "s-1", ...tokenClaims })
        .setProtectedHeader({ alg: "RS256", kid: "k1" })
        .setIssuer(ISSUER).setAudience(CLIENT_ID).setSubject("user-1")
        .setIssuedAt().setExpirationTime("1h").sign(pair.privateKey);
      return Response.json({ id_token: idToken, access_token: "at-1", token_type: "Bearer" });
    }
    if (url.endsWith("/oauth2/userinfo")) {
      return userinfo ? Response.json({ sub: "user-1", ...userinfo }) : new Response("nope", { status: 503 });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;

  const client = createSsoClient(loadSsoConfig(ENV), { fetchImpl });
  const start = await client.beginLogin();
  nonce = start.nonce;
  return client.completeLogin({
    params: new URLSearchParams({ code: "c", state: start.state }),
    state: start.state,
    codeVerifier: start.codeVerifier,
    nonce: start.nonce,
  });
}

/** BID's measured userinfo body (20 Sep 2026), minus sub. */
const BID_USERINFO = { name: "Christian Broberg", email: "cb@webhouse.dk", email_verified: true };

describe("which claims were signed — unverifiedClaims", () => {
  test("THE MEASURED BID SHAPE: email + email_verified only in userinfo → both are marked unsigned", async () => {
    const r = await login({}, BID_USERINFO);
    expect(r.claims.email_verified).toBe(true); // the value still arrives …
    expect(r.unverifiedClaims).toEqual(["email", "email_verified", "name"]); // … and says where from
  });

  test("the other direction: a token that CARRIES email_verified does not mark it unsigned", async () => {
    const r = await login({ email: "cb@webhouse.dk", email_verified: true }, BID_USERINFO);
    expect(r.unverifiedClaims).toEqual(["name"]);
    expect(r.unverifiedClaims).not.toContain("email_verified");
  });

  test("the signed token WINS when the two sources disagree", async () => {
    const r = await login({ email: "a@x.dk", email_verified: true }, { email: "b@y.dk", email_verified: false });
    expect(r.claims.email).toBe("a@x.dk");
    expect(r.claims.email_verified).toBe(true);
    expect(r.unverifiedClaims).toEqual([]);
  });

  test("name and picture still come in from userinfo — flagged, not dropped", async () => {
    const r = await login({}, { name: "Christian Broberg", picture: "https://x/p.png" });
    expect(r.claims.name).toBe("Christian Broberg");
    expect(r.claims.picture).toBe("https://x/p.png");
    expect(r.unverifiedClaims).toEqual(["name", "picture"]);
  });

  test("no userinfo answer → nothing unsigned was merged, and the list says so", async () => {
    const r = await login({}, null);
    expect(r.unverifiedClaims).toEqual([]);
    expect(r.claims.email).toBeUndefined();
  });

  test("sub is never listed: it is the signed one, and userinfo's must match it", async () => {
    const r = await login({}, BID_USERINFO);
    expect(r.unverifiedClaims).not.toContain("sub");
    expect(r.claims.sub).toBe("user-1");
  });
});
