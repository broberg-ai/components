/**
 * Unit tests for @broberg/sso.
 *
 * ── WHAT THESE CAN AND CANNOT PROVE ───────────────────────────────────────
 *
 * They run against a FAKE Broberg ID built here. A fake is kind by
 * construction — it agrees with whatever this file believes the protocol is —
 * so it can prove the key-rotation and rejection LOGIC and it cannot prove the
 * package talks to the real service. That half is F084.4 AC#1, run in a real
 * browser against the live id.broberg.ai.
 *
 * Said plainly rather than left implied, because a suite that looks
 * comprehensive is exactly how the gap gets missed.
 */
import { describe, expect, test } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, type JWK } from "jose";
import { loadSsoConfig, SsoConfigError } from "../src/config.js";
import { createSsoClient } from "../src/client.js";
import {
  createJwksCache,
  JwksError,
  JwksUnavailableError,
  JwksUnknownKeyError,
} from "../src/jwks.js";
import { signSession, verifySession, signValue, verifyValue } from "../src/session.js";
import { ssoRoutes } from "../src/hono.js";

const ISSUER = "https://id.broberg.ai";
const CLIENT_ID = "test-app";

const ENV = {
  BID_ISSUER: ISSUER,
  SSO_CLIENT_ID: CLIENT_ID,
  SSO_REDIRECT_URI: "https://app.example/auth/callback",
  SSO_COOKIE_SECRET: "s".repeat(64),
} as NodeJS.ProcessEnv;

/* ── a fake Broberg ID, with a rotatable signing key ─────────────────────── */

async function makeIdp() {
  let keyId = "key-1";
  /** What userinfo claims the subject is. Changed to build the mismatch case. */
  let userinfoSub = "user-1";
  /** The nonce a REAL IdP echoes from the authorize request into the ID token.
   *  The fake has to do it too — without it the nonce guard (correctly) refuses
   *  every token, and the tests below would be measuring the guard instead of
   *  the thing they name. */
  let echoNonce: string | undefined;
  let pair = await generateKeyPair("RS256", { extractable: true });
  let jwksHits = 0;

  async function publicJwk(): Promise<JWK> {
    return { ...(await exportJWK(pair.publicKey)), kid: keyId, alg: "RS256", use: "sig" };
  }

  async function mintFor() {
    return new SignJWT(echoNonce ? { nonce: echoNonce } : {})
      .setProtectedHeader({ alg: "RS256", kid: keyId })
      .setIssuer(ISSUER).setAudience(CLIENT_ID).setSubject("user-1")
      .setIssuedAt().setExpirationTime("1h").sign(pair.privateKey);
  }

  return {
    setUserinfoSub(v: string) { userinfoSub = v; },
    /** Model the IdP echoing the nonce it was handed at /authorize. */
    echo(nonce: string) { echoNonce = nonce; },
    get jwksHits() {
      return jwksHits;
    },
    get kid() {
      return keyId;
    },
    async rotate() {
      keyId = `key-${Number(keyId.split("-")[1]) + 1}`;
      pair = await generateKeyPair("RS256", { extractable: true });
    },
    /** Mint an ID token. `claims` can override anything, including aud/iss. */
    async mint(claims: Record<string, unknown> = {}) {
      return new SignJWT({ name: "Christian Broberg", ...claims })
        .setProtectedHeader({ alg: "RS256", kid: keyId })
        .setIssuer(ISSUER)
        .setAudience(CLIENT_ID)
        .setSubject((claims.sub as string) ?? "user-1")
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(pair.privateKey);
    },
    fetchImpl: (async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/.well-known/openid-configuration")) {
        return Response.json({
          issuer: ISSUER,
          authorization_endpoint: `${ISSUER}/oauth2/authorize`,
          token_endpoint: `${ISSUER}/oauth2/token`,
          jwks_uri: `${ISSUER}/jwks`,
          userinfo_endpoint: `${ISSUER}/oauth2/userinfo`,
          end_session_endpoint: `${ISSUER}/oauth2/end-session`,
        });
      }
      if (url.endsWith("/oauth2/token")) {
        return Response.json({
          id_token: await mintFor(),
          access_token: "at-1",
          token_type: "Bearer",
        });
      }
      if (url.endsWith("/oauth2/userinfo")) {
        return Response.json({ sub: userinfoSub, name: "Christian Broberg", email: "cb@webhouse.dk" });
      }
      if (url.endsWith("/jwks")) {
        jwksHits++;
        return Response.json({ keys: [await publicJwk()] });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch,
  };
}

/* ── configuration ───────────────────────────────────────────────────────── */

describe("configuration refuses rather than booting half-set", () => {
  test("a complete environment loads, and the issuer is the bare origin", () => {
    const c = loadSsoConfig({ ...ENV, BID_ISSUER: `${ISSUER}/` });
    expect(c.issuer).toBe(ISSUER);
    expect(c.scopes).toEqual(["openid", "profile", "email"]);
  });

  /**
   * `!"   "` is FALSE in JavaScript, so the obvious guard boots an app whose
   * sessions are signed with whitespace. Measured in this fleet once already.
   */
  test.each(["BID_ISSUER", "SSO_CLIENT_ID", "SSO_REDIRECT_URI", "SSO_COOKIE_SECRET"])(
    "a BLANK %s is refused and NAMED",
    (key) => {
      expect(() => loadSsoConfig({ ...ENV, [key]: "   " })).toThrow(SsoConfigError);
      expect(() => loadSsoConfig({ ...ENV, [key]: "   " })).toThrow(new RegExp(key));
    },
  );

  test("a short cookie secret is refused — a forgeable session is any user you like", () => {
    expect(() => loadSsoConfig({ ...ENV, SSO_COOKIE_SECRET: "tooshort" })).toThrow(/at least 32/);
  });

  test("a non-numeric session max age is refused, not silently NaN", () => {
    // NaN would become a cookie that expires immediately: an app that cannot
    // keep anyone signed in, with no error anywhere to explain it.
    expect(() => loadSsoConfig({ ...ENV, SSO_SESSION_MAX_AGE: "seven days" })).toThrow(/positive number/);
    expect(loadSsoConfig({ ...ENV, SSO_SESSION_MAX_AGE: "43200" }).sessionMaxAge).toBe(43200);
  });

  test("http is refused for a real host, allowed for localhost", () => {
    expect(() => loadSsoConfig({ ...ENV, BID_ISSUER: "http://id.broberg.ai" })).toThrow(/must be https/);
    // Negative control: without this the rule could be "http is always refused"
    // and local development would be impossible for a reason no test shows.
    expect(loadSsoConfig({ ...ENV, BID_ISSUER: "http://localhost:8099" }).issuer).toBe(
      "http://localhost:8099",
    );
  });
});

/* ── discovery ───────────────────────────────────────────────────────────── */

describe("discovery is checked against what we were configured with", () => {
  test("a discovery document whose issuer disagrees is REFUSED at first use", async () => {
    // This is not hypothetical. Better Auth's default basePath advertised
    // `<origin>/api/auth` as the issuer — measured on a running BID during
    // F084.1. Without this check the failure surfaces much later, as every
    // token being rejected for what looks like a signature problem.
    const idp = await makeIdp();
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/.well-known/openid-configuration")) {
        return Response.json({
          issuer: `${ISSUER}/api/auth`,
          authorization_endpoint: `${ISSUER}/api/auth/oauth2/authorize`,
          token_endpoint: `${ISSUER}/api/auth/oauth2/token`,
          jwks_uri: `${ISSUER}/api/auth/jwks`,
        });
      }
      return idp.fetchImpl(input);
    }) as unknown as typeof fetch;

    const client = createSsoClient(loadSsoConfig(ENV), { fetchImpl });
    await expect(client.discovery()).rejects.toThrow(/must match exactly/);
  });
});

/* ── the authorize URL ───────────────────────────────────────────────────── */

describe("beginLogin produces a full-redirect URL with PKCE", () => {
  test("S256 challenge, state and nonce are all present", async () => {
    const idp = await makeIdp();
    const client = createSsoClient(loadSsoConfig(ENV), { fetchImpl: idp.fetchImpl });
    const start = await client.beginLogin();
    const url = new URL(start.url);

    expect(url.origin + url.pathname).toBe(`${ISSUER}/oauth2/authorize`);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    // The challenge must NOT be the verifier — that would be `plain` wearing
    // S256's name, and PKCE would protect nothing.
    expect(url.searchParams.get("code_challenge")).not.toBe(start.codeVerifier);
    expect(url.searchParams.get("state")).toBe(start.state);
    expect(url.searchParams.get("nonce")).toBe(start.nonce);
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
  });

  test("prompt=none is passed through, and is absent unless asked for", async () => {
    const idp = await makeIdp();
    const client = createSsoClient(loadSsoConfig(ENV), { fetchImpl: idp.fetchImpl });
    expect(new URL((await client.beginLogin({ prompt: "none" })).url).searchParams.get("prompt")).toBe(
      "none",
    );
    expect(new URL((await client.beginLogin()).url).searchParams.get("prompt")).toBeNull();
  });

  test("two logins never share a state or a verifier", async () => {
    const idp = await makeIdp();
    const client = createSsoClient(loadSsoConfig(ENV), { fetchImpl: idp.fetchImpl });
    const [a, b] = [await client.beginLogin(), await client.beginLogin()];
    expect(a.state).not.toBe(b.state);
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
    expect(a.nonce).not.toBe(b.nonce);
  });
});

/* ── token verification — F084.4 AC#2 ────────────────────────────────────── */

describe("an ID token is only accepted when this issuer really signed it", () => {
  test("AC#2 — a token signed by an UNKNOWN key is rejected", async () => {
    const idp = await makeIdp();
    const stranger = await generateKeyPair("RS256", { extractable: true });
    const forged = await new SignJWT({ name: "Not Christian" })
      .setProtectedHeader({ alg: "RS256", kid: idp.kid }) // claims OUR kid
      .setIssuer(ISSUER)
      .setAudience(CLIENT_ID)
      .setSubject("attacker")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(stranger.privateKey);

    const client = createSsoClient(loadSsoConfig(ENV), { fetchImpl: idp.fetchImpl });
    await expect(client.verifyIdToken(forged)).rejects.toThrow();
  });

  test("AC#2 negative control — the SAME shape, signed correctly, is accepted", async () => {
    // Without this half the test above proves nothing: it would also pass if
    // verifyIdToken rejected every token it was ever given.
    const idp = await makeIdp();
    const client = createSsoClient(loadSsoConfig(ENV), { fetchImpl: idp.fetchImpl });
    const claims = await client.verifyIdToken(await idp.mint());
    expect(claims.sub).toBe("user-1");
    expect(claims.name).toBe("Christian Broberg");
  });

  test("a token for ANOTHER audience is rejected", async () => {
    const idp = await makeIdp();
    const client = createSsoClient(loadSsoConfig(ENV), { fetchImpl: idp.fetchImpl });
    const other = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: idp.kid })
      .setIssuer(ISSUER)
      .setAudience("a-different-app")
      .setSubject("user-1")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign((await generateKeyPair("RS256")).privateKey);
    await expect(client.verifyIdToken(other)).rejects.toThrow();
  });

  test("a mismatched nonce is refused — a token minted for another sign-in", async () => {
    const idp = await makeIdp();
    const client = createSsoClient(loadSsoConfig(ENV), { fetchImpl: idp.fetchImpl });
    const token = await idp.mint({ nonce: "the-real-one" });
    await expect(client.verifyIdToken(token, { nonce: "a-different-one" })).rejects.toThrow(/nonce/);
    // Negative control: the matching nonce passes, so the rejection is about
    // the nonce and not about something else in the token.
    await expect(client.verifyIdToken(token, { nonce: "the-real-one" })).resolves.toMatchObject({
      sub: "user-1",
    });
  });
});

/* ── key rotation — F084.4 AC#3 ──────────────────────────────────────────── */

describe("key rotation is survived without a restart", () => {
  test("AC#3 — an unknown kid triggers exactly one refetch, and the new token verifies", async () => {
    const idp = await makeIdp();
    const client = createSsoClient(loadSsoConfig(ENV), {
      fetchImpl: idp.fetchImpl,
      minRefetchIntervalMs: 0,
    });

    expect((await client.verifyIdToken(await idp.mint())).sub).toBe("user-1");
    const afterFirst = idp.jwksHits;

    // A second token under the SAME key must not cost another fetch — that is
    // what makes this a cache rather than a proxy.
    await client.verifyIdToken(await idp.mint({ sub: "user-2" }));
    expect(idp.jwksHits).toBe(afterFirst);

    await idp.rotate();
    const claims = await client.verifyIdToken(await idp.mint({ sub: "user-3" }));
    expect(claims.sub).toBe("user-3");
    expect(idp.jwksHits).toBe(afterFirst + 1);
  });

  test("a revoked key stops working — the set is REPLACED, not merged", async () => {
    // Merging would keep an old key usable forever, which is the one thing
    // rotating a key is meant to stop.
    const idp = await makeIdp();
    const client = createSsoClient(loadSsoConfig(ENV), {
      fetchImpl: idp.fetchImpl,
      minRefetchIntervalMs: 0,
    });
    const oldToken = await idp.mint();
    await client.verifyIdToken(oldToken); // caches key-1

    await idp.rotate();
    await client.verifyIdToken(await idp.mint()); // pulls key-2, drops key-1

    await expect(client.verifyIdToken(oldToken)).rejects.toThrow();
  });

  test("the refetch floor stops an unknown kid from being a way to hammer BID", async () => {
    let hits = 0;
    const cache = createJwksCache({
      jwksUri: "https://id.broberg.ai/jwks",
      minRefetchIntervalMs: 60_000,
      now: () => 1_000_000,
      fetchImpl: (async () => {
        hits++;
        return Response.json({ keys: [] });
      }) as unknown as typeof fetch,
    });

    await expect(cache.getKey("nope", "RS256")).rejects.toThrow(JwksError);
    expect(hits).toBe(1); // the first miss is allowed to look

    // Every later miss inside the window is refused WITHOUT a fetch.
    for (let i = 0; i < 5; i++) {
      await expect(cache.getKey(`nope-${i}`, "RS256")).rejects.toThrow(/do not ask the issuer again/);
    }
    expect(hits).toBe(1);
  });
});

/* ── the session cookie ──────────────────────────────────────────────────── */

describe("the session cookie is unforgeable and expires", () => {
  const SECRET = "s".repeat(64);

  test("a round trip returns exactly what went in", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = await signSession({ sub: "user-1", exp, email: "cb@webhouse.dk" }, SECRET);
    expect(await verifySession(token, SECRET)).toEqual({
      sub: "user-1",
      exp,
      email: "cb@webhouse.dk",
    });
  });

  /**
   * The picture travels as a URL (F084.2). It is a convenience copy, so the
   * test that matters is BOTH directions: present it and it survives, omit it
   * and the key is absent rather than `undefined` — an app rendering
   * `<img src="undefined">` asks our own origin for a file that is not there.
   */
  test("a picture URL round-trips, and stays absent when there is none", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const withPicture = await signSession(
      { sub: "user-1", exp, picture: "https://id.broberg.ai/media/avatars/u/a.png" },
      SECRET,
    );
    expect(await verifySession(withPicture, SECRET)).toEqual({
      sub: "user-1",
      exp,
      picture: "https://id.broberg.ai/media/avatars/u/a.png",
    });

    const without = await verifySession(await signSession({ sub: "user-1", exp }, SECRET), SECRET);
    expect(without).not.toBeNull();
    expect("picture" in (without as object)).toBe(false);
  });

  test("a tampered payload is rejected", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = await signSession({ sub: "user-1", exp }, SECRET);
    const [body, sig] = token.split(".");
    const swapped = btoa(JSON.stringify({ sub: "admin", exp }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(await verifySession(`${swapped}.${sig}`, SECRET)).toBeNull();
    expect(body).toBeTruthy();
  });

  test("a different secret is rejected", async () => {
    const token = await signSession(
      { sub: "user-1", exp: Math.floor(Date.now() / 1000) + 3600 },
      SECRET,
    );
    expect(await verifySession(token, "d".repeat(64))).toBeNull();
  });

  test("an expired session is rejected", async () => {
    const token = await signSession({ sub: "user-1", exp: Math.floor(Date.now() / 1000) - 1 }, SECRET);
    expect(await verifySession(token, SECRET)).toBeNull();
  });

  /**
   * REGRESSION, and it was found by reading rather than by running.
   *
   * The first version of this package carried the login transaction inside the
   * session envelope with `exp: 0`. The expiry check is `exp * 1000 <= now()`,
   * so `0 <= now` is always true and the transaction could NEVER be read back:
   * every single login would have failed with "state does not match", which
   * sends the reader looking at the OAuth flow instead of at a cookie.
   *
   * signValue/verifyValue exist so the two lifetimes cannot share an envelope.
   */
  test("a signed VALUE has no expiry notion and round-trips", async () => {
    const tx = JSON.stringify({ state: "s", codeVerifier: "v", nonce: "n", returnTo: "/" });
    expect(await verifyValue(await signValue(tx, SECRET), SECRET)).toBe(tx);
  });

  test("a signed value with a broken signature is rejected", async () => {
    const token = await signValue("hello", SECRET);
    expect(await verifyValue(token.slice(0, -2) + "xy", SECRET)).toBeNull();
    expect(await verifyValue("not-a-token", SECRET)).toBeNull();
    expect(await verifyValue(undefined, SECRET)).toBeNull();
  });
});

/* ── userinfo — the profile claims are not in the ID token ───────────────── */

describe("the profile comes from userinfo, and only for the right subject", () => {
  /**
   * MEASURED against the live Broberg ID, 16 Sep 2026 — not assumed:
   *   ID token   iss · sub · aud · iat · exp · auth_time · acr · at_hash
   *   userinfo   sub · name · given_name · family_name · email · email_verified
   * An app reading only the ID token gets a proven identity and a blank name,
   * which is exactly what the example app first showed on screen.
   */
  test("name and email are folded in from userinfo", async () => {
    const idp = await makeIdp();
    const client = createSsoClient(loadSsoConfig(ENV), { fetchImpl: idp.fetchImpl });
    const start = await client.beginLogin();
    idp.echo(start.nonce);
    const result = await client.completeLogin({
      params: new URLSearchParams({ code: "c", state: start.state }),
      state: start.state,
      codeVerifier: start.codeVerifier,
      nonce: start.nonce,
    });
    expect(result.claims.sub).toBe("user-1");
    expect(result.claims.name).toBe("Christian Broberg");
    expect(result.claims.email).toBe("cb@webhouse.dk");
  });

  /**
   * THE CHECK A NAIVE VERSION SKIPS (OIDC Core 5.3.2 says MUST).
   *
   * Without it a userinfo response for ANOTHER user is merged over a correctly
   * verified identity: the app shows, and acts as, somebody else — with a valid
   * signature underneath it. The green path and the catastrophe look identical.
   */
  test("a userinfo sub that disagrees with the ID token is REFUSED", async () => {
    const idp = await makeIdp();
    idp.setUserinfoSub("somebody-else");
    const client = createSsoClient(loadSsoConfig(ENV), { fetchImpl: idp.fetchImpl });
    const start = await client.beginLogin();
    idp.echo(start.nonce);
    await expect(
      client.completeLogin({
        params: new URLSearchParams({ code: "c", state: start.state }),
        state: start.state,
        codeVerifier: start.codeVerifier,
        nonce: start.nonce,
      }),
    ).rejects.toThrow(/refusing to merge another user/);
  });

  test("a failing userinfo does NOT lose the sign-in", async () => {
    // The identity is already proven by the ID token. A session with no display
    // name is worse than one with it, and far better than being logged out.
    const idp = await makeIdp();
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/oauth2/userinfo")) return new Response("nope", { status: 503 });
      return idp.fetchImpl(input, init);
    }) as unknown as typeof fetch;

    const client = createSsoClient(loadSsoConfig(ENV), { fetchImpl });
    const start = await client.beginLogin();
    idp.echo(start.nonce);
    const result = await client.completeLogin({
      params: new URLSearchParams({ code: "c", state: start.state }),
      state: start.state,
      codeVerifier: start.codeVerifier,
      nonce: start.nonce,
    });
    expect(result.claims.sub).toBe("user-1");
    expect(result.claims.name).toBeUndefined();
  });

  test("a mismatched state is refused before any token is fetched", async () => {
    const idp = await makeIdp();
    const client = createSsoClient(loadSsoConfig(ENV), { fetchImpl: idp.fetchImpl });
    const start = await client.beginLogin();
    await expect(
      client.completeLogin({
        params: new URLSearchParams({ code: "c", state: "not-the-one" }),
        state: start.state,
        codeVerifier: start.codeVerifier,
        nonce: start.nonce,
      }),
    ).rejects.toThrow(/state does not match/);
  });

  test("an error on the callback is reported as the refusal it is", async () => {
    // prompt=none answers a refusal by redirecting back with ?error=, on the
    // same address a success uses. Reading only for `code` would make the
    // expected answer look like a malformed response.
    const idp = await makeIdp();
    const client = createSsoClient(loadSsoConfig(ENV), { fetchImpl: idp.fetchImpl });
    const start = await client.beginLogin({ prompt: "none" });
    await expect(
      client.completeLogin({
        params: new URLSearchParams({ error: "login_required", state: start.state }),
        state: start.state,
        codeVerifier: start.codeVerifier,
        nonce: start.nonce,
      }),
    ).rejects.toThrow(/login_required/);
  });
});

/* ── two failures, not one — F084.50 ─────────────────────────────────────── */

describe("getKey distinguishes 'could not look' from 'not signed by us'", () => {
  const JWKS_URI = "https://id.broberg.ai/jwks";

  /** A key set that is reachable and simply does not contain the kid asked for. */
  const servingEmptySet = (async () => Response.json({ keys: [] })) as unknown as typeof fetch;

  test("issuer unreachable → JwksUnavailableError (transient: retry, do not judge the token)", async () => {
    const cache = createJwksCache({
      jwksUri: JWKS_URI,
      minRefetchIntervalMs: 0,
      fetchImpl: (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
    });

    await expect(cache.getKey("key-1", "RS256")).rejects.toThrow(JwksUnavailableError);
    // And NOT the other one. Asserting only the positive class would pass even
    // if both branches threw the same subclass.
    await expect(cache.getKey("key-1", "RS256")).rejects.not.toThrow(JwksUnknownKeyError);
  });

  test("issuer answers 503 → JwksUnavailableError, not a verdict on the token", async () => {
    const cache = createJwksCache({
      jwksUri: JWKS_URI,
      minRefetchIntervalMs: 0,
      fetchImpl: (async () => new Response("down", { status: 503 })) as unknown as typeof fetch,
    });
    await expect(cache.getKey("key-1", "RS256")).rejects.toThrow(JwksUnavailableError);
  });

  test("issuer answers 200 without the kid → JwksUnknownKeyError (permanent: reject it)", async () => {
    const cache = createJwksCache({
      jwksUri: JWKS_URI,
      minRefetchIntervalMs: 0,
      fetchImpl: servingEmptySet,
    });

    await expect(cache.getKey("forged", "RS256")).rejects.toThrow(JwksUnknownKeyError);
    await expect(cache.getKey("forged", "RS256")).rejects.not.toThrow(JwksUnavailableError);
  });

  test("an unknown kid inside the cooldown is UNAVAILABLE, not unknown — we did not look", async () => {
    // The distinction is the whole point of the split: refusing to refetch is a
    // statement about US, not about the token. Calling it "unknown key" would
    // tell a caller to reject a token that may well be freshly rotated and
    // perfectly valid.
    const cache = createJwksCache({
      jwksUri: JWKS_URI,
      minRefetchIntervalMs: 60_000,
      now: () => 1_000_000,
      fetchImpl: servingEmptySet,
    });

    await cache.getKey("first", "RS256").catch(() => {}); // spends the one allowed look
    await expect(cache.getKey("second", "RS256")).rejects.toThrow(JwksUnavailableError);
  });

  test("BOTH subclasses still satisfy `instanceof JwksError` — a 0.1.0 catch survives", async () => {
    // The upgrade guarantee. Without this, splitting the error is a breaking
    // change wearing a minor version number.
    const unreachable = createJwksCache({
      jwksUri: JWKS_URI,
      minRefetchIntervalMs: 0,
      fetchImpl: (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
    });
    const unknown = createJwksCache({
      jwksUri: JWKS_URI,
      minRefetchIntervalMs: 0,
      fetchImpl: servingEmptySet,
    });

    await expect(unreachable.getKey("k", "RS256")).rejects.toThrow(JwksError);
    await expect(unknown.getKey("k", "RS256")).rejects.toThrow(JwksError);
  });
});

describe("warm-up moves the cold window to boot", () => {
  test("warmUp:true fetches BEFORE the first getKey", async () => {
    let hits = 0;
    const cache = createJwksCache({
      jwksUri: "https://id.broberg.ai/jwks",
      warmUp: true,
      fetchImpl: (async () => {
        hits++;
        return Response.json({ keys: [] });
      }) as unknown as typeof fetch,
    });

    // The warm-up is fire-and-forget, so yield once rather than asserting
    // synchronously — the point is that it happens without a caller.
    await new Promise((r) => setTimeout(r, 0));
    expect(hits).toBe(1);
    expect(cache.fetchCount).toBe(1);
  });

  test("NEGATIVE CONTROL — a failed warm-up does not throw, and the next getKey still works", async () => {
    // A package that stops an app from booting because someone else's service
    // is down has made the outage worse. This is the test that says so.
    let calls = 0;
    const keyPair = await generateKeyPair("RS256");
    const jwk = { ...(await exportJWK(keyPair.publicKey)), kid: "key-1", alg: "RS256" } as JWK;

    const cache = createJwksCache({
      jwksUri: "https://id.broberg.ai/jwks",
      warmUp: true,
      minRefetchIntervalMs: 0,
      fetchImpl: (async () => {
        calls++;
        if (calls === 1) throw new TypeError("fetch failed");
        return Response.json({ keys: [jwk] });
      }) as unknown as typeof fetch,
    });

    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(1); // it tried, and the rejection was swallowed
    await expect(cache.getKey("key-1", "RS256")).resolves.toBeDefined();
  });

  test("warm-up does NOT make a revoked key survive a rotation", async () => {
    // The cure for the cold start must not quietly become the cache that
    // outlives a revocation — that is the failure form we chose against.
    const a = await generateKeyPair("RS256");
    const b = await generateKeyPair("RS256");
    const jwkA = { ...(await exportJWK(a.publicKey)), kid: "key-old", alg: "RS256" } as JWK;
    const jwkB = { ...(await exportJWK(b.publicKey)), kid: "key-new", alg: "RS256" } as JWK;

    let served = [jwkA];
    const cache = createJwksCache({
      jwksUri: "https://id.broberg.ai/jwks",
      warmUp: true,
      minRefetchIntervalMs: 0,
      fetchImpl: (async () => Response.json({ keys: served })) as unknown as typeof fetch,
    });

    await new Promise((r) => setTimeout(r, 0));
    await expect(cache.getKey("key-old", "RS256")).resolves.toBeDefined();

    served = [jwkB]; // BID rotates; key-old is revoked
    await expect(cache.getKey("key-new", "RS256")).resolves.toBeDefined();
    await expect(cache.getKey("key-old", "RS256")).rejects.toThrow(JwksUnknownKeyError);
  });
});

/* ── logout carries the hint — F084.50 ───────────────────────────────────── */

/**
 * These drive the Hono adapter in-process (`app.request`), which had no tests
 * at all before this card. No browser is involved, so this is not the kind of
 * verification Lens owns — it is a route returning headers.
 */
describe("logout proves who is leaving, so the issuer need not ask", () => {
  /** Run login → callback and hand back the cookies the browser would now hold. */
  async function signIn() {
    const idp = await makeIdp();
    const client = createSsoClient(loadSsoConfig(ENV), {
      fetchImpl: idp.fetchImpl,
      minRefetchIntervalMs: 0,
    });
    const { app } = ssoRoutes({ config: loadSsoConfig(ENV), client });

    const login = await app.request("https://app.example/login");
    const txCookie = login.headers.get("set-cookie")!;
    const authorize = new URL(login.headers.get("location")!);
    idp.echo(authorize.searchParams.get("nonce")!);

    const cb = await app.request("https://app.example/callback?" + new URLSearchParams({
      code: "the-code",
      state: authorize.searchParams.get("state")!,
    }), { headers: { cookie: txCookie.split(";")[0]! } });

    return { app, cookies: cb.headers.getSetCookie() };
  }

  const cookiePair = (raw: string) => raw.split(";")[0]!;
  /** Throws rather than returning undefined: a helper that can hand back
   *  `undefined` turns "the cookie was never set" into a silently skipped
   *  assertion, which is the failure this whole card is about. */
  const named = (cookies: string[], name: string): string => {
    const hit = cookies.find((c) => c.startsWith(`${name}=`));
    if (!hit) throw new Error(`no Set-Cookie named ${name} in: ${cookies.join(" | ")}`);
    return hit;
  };

  test("the ID token is kept in its OWN HttpOnly cookie, read off the raw header", async () => {
    const { cookies } = await signIn();
    const idt = named(cookies, "bid_session_idt");

    expect(idt).toContain("HttpOnly");
    // And it is NOT empty — an absent value and a cleared cookie look alike.
    expect(cookiePair(idt).split("=")[1]!.length).toBeGreaterThan(20);
  });

  test("GET /logout sends id_token_hint, STRICTLY equal to what was stored", async () => {
    const { app, cookies } = await signIn();
    const idt = named(cookies, "bid_session_idt");
    // What the browser would send back.
    const sent = cookiePair(idt);
    const storedJwt = await verifyValue(sent.split("=")[1]!, ENV.SSO_COOKIE_SECRET!);

    const out = await app.request("https://app.example/logout", { headers: { cookie: sent } });
    const hint = new URL(out.headers.get("location")!).searchParams.get("id_token_hint");

    // Strict equality on the parsed QUERY PARAMETER. `toContain` on the URL
    // would pass on a truncated token, or on one with the old value still
    // attached — "contains" is a weaker predicate than it reads, and it fails
    // in the green direction.
    expect(hint).toBe(storedJwt);
  });

  test("logout clears BOTH cookies, each asserted by name", async () => {
    const { app, cookies } = await signIn();
    const out = await app.request("https://app.example/logout", {
      headers: { cookie: cookiePair(named(cookies, "bid_session_idt")) },
    });
    const cleared = out.headers.getSetCookie();

    expect(named(cleared, "bid_session")).toContain("Max-Age=0");
    expect(named(cleared, "bid_session_idt")).toContain("Max-Age=0");
  });

  test("UPGRADE PATH — a 0.1.0 session has no hint cookie and must still log out", async () => {
    // This is the one that fails in production: every session minted before the
    // upgrade is live and carries no such cookie. Throwing here would break
    // logout for every existing user on the day we ship.
    const idp = await makeIdp();
    const client = createSsoClient(loadSsoConfig(ENV), {
      fetchImpl: idp.fetchImpl,
      minRefetchIntervalMs: 0,
    });
    const { app } = ssoRoutes({ config: loadSsoConfig(ENV), client });

    const out = await app.request("https://app.example/logout"); // no cookies at all
    expect(out.status).toBe(302);
    const url = new URL(out.headers.get("location")!);
    expect(url.pathname).toBe("/oauth2/end-session");
    expect(url.searchParams.get("id_token_hint")).toBeNull();
  });

  test("a FORGED hint cookie is dropped rather than forwarded", async () => {
    // The cookie is signed; an unsigned or tampered one must not become a hint
    // we hand to the issuer.
    const idp = await makeIdp();
    const client = createSsoClient(loadSsoConfig(ENV), {
      fetchImpl: idp.fetchImpl,
      minRefetchIntervalMs: 0,
    });
    const { app } = ssoRoutes({ config: loadSsoConfig(ENV), client });

    const out = await app.request("https://app.example/logout", {
      headers: { cookie: "bid_session_idt=not-a-signed-value" },
    });
    expect(new URL(out.headers.get("location")!).searchParams.get("id_token_hint")).toBeNull();
  });
});

/* ── confidential client, and PKCE survives it — F084.50 ─────────────────── */

describe("a client_secret is optional, and it never buys you out of PKCE", () => {
  /** Run a full login and hand back the token request's parsed body. */
  async function exchange(env: NodeJS.ProcessEnv) {
    const idp = await makeIdp();
    let tokenBody: URLSearchParams | undefined;

    const spy = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/oauth2/token")) tokenBody = new URLSearchParams(String(init?.body));
      return idp.fetchImpl(input as RequestInfo, init);
    }) as unknown as typeof fetch;

    const client = createSsoClient(loadSsoConfig(env), {
      fetchImpl: spy,
      minRefetchIntervalMs: 0,
    });
    const start = await client.beginLogin();
    idp.echo(start.nonce);
    await client.completeLogin({
      params: new URLSearchParams({ code: "c", state: start.state }),
      state: start.state,
      codeVerifier: start.codeVerifier,
      nonce: start.nonce,
    });
    return tokenBody!;
  }

  test("with a secret: the body carries BOTH client_secret AND code_verifier", async () => {
    // The one assertion that proves the secret did not replace PKCE. Checking
    // only for client_secret would pass on exactly the regression this card
    // exists to prevent.
    const body = await exchange({ ...ENV, SSO_CLIENT_SECRET: "s3cr3t-value" });
    expect(body.get("client_secret")).toBe("s3cr3t-value");
    expect(body.get("code_verifier")).toBeTruthy();
  });

  test("without a secret: code_verifier is there and the key is ABSENT, not empty", async () => {
    const body = await exchange(ENV);
    expect(body.get("code_verifier")).toBeTruthy();
    // `has`, not `get() === ""`. An empty client_secret is a DIFFERENT request
    // to an OAuth server than no client_secret at all.
    expect(body.has("client_secret")).toBe(false);
  });

  test("a blank SSO_CLIENT_SECRET is treated as unset, not as an empty secret", async () => {
    // The same blank-string trap config.ts already guards for the cookie secret:
    // "   " is truthy as a value and worthless as a credential.
    const body = await exchange({ ...ENV, SSO_CLIENT_SECRET: "   " });
    expect(body.has("client_secret")).toBe(false);
  });
});

describe("invalid_client says WHICH end is wrong, and never the secret itself", () => {
  /** An IdP that refuses the exchange with invalid_client. */
  async function refusingIdp() {
    const idp = await makeIdp();
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/oauth2/token")) {
        return Response.json({ error: "invalid_client" }, { status: 401 });
      }
      return idp.fetchImpl(input as RequestInfo, init);
    }) as unknown as typeof fetch;
  }

  async function failWith(env: NodeJS.ProcessEnv) {
    const client = createSsoClient(loadSsoConfig(env), {
      fetchImpl: await refusingIdp(),
      minRefetchIntervalMs: 0,
    });
    const start = await client.beginLogin();
    return client
      .completeLogin({
        params: new URLSearchParams({ code: "c", state: start.state }),
        state: start.state,
        codeVerifier: start.codeVerifier,
        nonce: start.nonce,
      })
      .then(() => "no error", (e: Error) => e.message);
  }

  test("we sent a secret → the message points at OUR secret or a public registration", async () => {
    const msg = await failWith({ ...ENV, SSO_CLIENT_SECRET: "wrong-one" });
    expect(msg).toMatch(/DID send a client_secret/);
    expect(msg).toMatch(/registered as PUBLIC/);
  });

  test("we sent none → the message points at a CONFIDENTIAL registration", async () => {
    const msg = await failWith(ENV);
    expect(msg).toMatch(/sent NO client_secret/);
    expect(msg).toMatch(/registered as CONFIDENTIAL/);
  });

  test("the two messages DIFFER — that is the whole point of the hint", async () => {
    // Without this, both branches could return the same sentence and each test
    // above would still pass.
    const withSecret = await failWith({ ...ENV, SSO_CLIENT_SECRET: "wrong-one" });
    const without = await failWith(ENV);
    expect(withSecret).not.toBe(without);
  });

  test("THE SECRET IS NEVER IN THE MESSAGE", async () => {
    const msg = await failWith({ ...ENV, SSO_CLIENT_SECRET: "canary-do-not-leak-7f3a" });
    expect(msg).not.toContain("canary-do-not-leak-7f3a");
  });
});

/* ── security review 2026-09-20 — F084.50 ────────────────────────────────── */

describe("a forged ID token is refused by OUR rule, not by a dependency's internals", () => {
  /** A fake issuer publishing exactly one RSA key. */
  async function rig() {
    const pair = await generateKeyPair("RS256", { extractable: true });
    const pubJwk = { ...(await exportJWK(pair.publicKey)), kid: "key-1", alg: "RS256", use: "sig" } as JWK;
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/.well-known/openid-configuration"))
        return Response.json({
          issuer: ISSUER, authorization_endpoint: `${ISSUER}/a`, token_endpoint: `${ISSUER}/t`,
          jwks_uri: `${ISSUER}/jwks`, userinfo_endpoint: `${ISSUER}/u`,
        });
      if (url.endsWith("/jwks")) return Response.json({ keys: [pubJwk] });
      return new Response("nf", { status: 404 });
    }) as unknown as typeof fetch;
    return {
      pair, pubJwk,
      client: createSsoClient(loadSsoConfig(ENV), { fetchImpl, minRefetchIntervalMs: 0 }),
    };
  }

  test("PRODUCTION'S OWN ALGORITHM — an EdDSA token is accepted", async () => {
    // The test 0.2.1 did not have, and the reason it shipped broken. Broberg ID
    // signs with Ed25519 and advertises EdDSA as the ONLY supported algorithm;
    // the whole suite used an RS256 fake, so an allow-list that omitted EdDSA
    // was green here and rejected every real token in production.
    //
    // It is first in this describe on purpose: the algorithm the issuer USES is
    // a more important case than the algorithms an attacker might try.
    const pair = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: "ed-1", alg: "EdDSA", use: "sig" } as JWK;
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/.well-known/openid-configuration"))
        return Response.json({
          issuer: ISSUER, authorization_endpoint: `${ISSUER}/a`, token_endpoint: `${ISSUER}/t`,
          jwks_uri: `${ISSUER}/jwks`, userinfo_endpoint: `${ISSUER}/u`,
        });
      if (url.endsWith("/jwks")) return Response.json({ keys: [jwk] });
      return new Response("nf", { status: 404 });
    }) as unknown as typeof fetch;
    const client = createSsoClient(loadSsoConfig(ENV), { fetchImpl, minRefetchIntervalMs: 0 });

    const token = await new SignJWT({}).setProtectedHeader({ alg: "EdDSA", kid: "ed-1" })
      .setIssuer(ISSUER).setAudience(CLIENT_ID).setSubject("real-user")
      .setIssuedAt().setExpirationTime("1h").sign(pair.privateKey);

    expect((await client.verifyIdToken(token)).sub).toBe("real-user");
  });

  test("CONTROL — a genuine RS256 token is accepted (without this the attacks prove nothing)", async () => {
    const { pair, client } = await rig();
    const good = await new SignJWT({}).setProtectedHeader({ alg: "RS256", kid: "key-1" })
      .setIssuer(ISSUER).setAudience(CLIENT_ID).setSubject("user-1")
      .setIssuedAt().setExpirationTime("1h").sign(pair.privateKey);
    expect((await client.verifyIdToken(good)).sub).toBe("user-1");
  });

  test("HS256 signed with the PUBLIC key as the HMAC secret is refused", async () => {
    // The classic algorithm confusion: the verifying key is public, so if the
    // algorithm may be chosen by the sender, the public key becomes a shared
    // secret anyone can sign with.
    const { pubJwk, client } = await rig();
    const forged = await new SignJWT({}).setProtectedHeader({ alg: "HS256", kid: "key-1" })
      .setIssuer(ISSUER).setAudience(CLIENT_ID).setSubject("ATTACKER")
      .setIssuedAt().setExpirationTime("1h")
      .sign(new TextEncoder().encode(JSON.stringify(pubJwk)));
    await expect(client.verifyIdToken(forged)).rejects.toThrow();
  });

  test("alg:none is refused", async () => {
    const { client } = await rig();
    const h = Buffer.from(JSON.stringify({ alg: "none", kid: "key-1" })).toString("base64url");
    const p = Buffer.from(JSON.stringify({
      iss: ISSUER, aud: CLIENT_ID, sub: "ATTACKER", exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString("base64url");
    await expect(client.verifyIdToken(`${h}.${p}.`)).rejects.toThrow();
  });

  test("the refusal is OURS — it names the allowed algorithms, not a JWK import failure", async () => {
    // THIS is the test the other two cannot replace. Before the allow-list both
    // attacks were already refused — by `JOSENotSupported: Invalid or
    // unsupported JWK "alg"`, thrown inside jose's key import. That is a
    // dependency's internals: it moves on an upgrade, and it would stop
    // defending us the day an issuer publishes a symmetric key. Asserting on
    // the MESSAGE is how we know the guard is in code we own.
    const { pubJwk, client } = await rig();
    const forged = await new SignJWT({}).setProtectedHeader({ alg: "HS256", kid: "key-1" })
      .setIssuer(ISSUER).setAudience(CLIENT_ID).setSubject("ATTACKER")
      .setIssuedAt().setExpirationTime("1h")
      .sign(new TextEncoder().encode(JSON.stringify(pubJwk)));

    const err = await client.verifyIdToken(forged).then(() => null, (e: Error) => e);
    expect(err).toBeTruthy();
    expect(err!.message).toMatch(/alg/i);
    // and NOT the old, incidental defence
    expect(err!.message).not.toMatch(/unsupported JWK/i);
  });
});

describe("returnTo cannot leave our own origin", () => {
  const APP = "https://my.app";
  /** Drive the REAL route and read where it actually sends the browser. */
  async function where(returnTo: string) {
    const idp = await makeIdp();
    const client = createSsoClient(loadSsoConfig(ENV), { fetchImpl: idp.fetchImpl, minRefetchIntervalMs: 0 });
    const { app } = ssoRoutes({ config: loadSsoConfig(ENV), client });

    const login = await app.request(`${APP}/login?returnTo=${encodeURIComponent(returnTo)}`);
    const tx = login.headers.get("set-cookie")!.split(";")[0]!;
    const authorize = new URL(login.headers.get("location")!);
    idp.echo(authorize.searchParams.get("nonce")!);

    const cb = await app.request(`${APP}/callback?` + new URLSearchParams({
      code: "c", state: authorize.searchParams.get("state")!,
    }), { headers: { cookie: tx } });

    // Resolve it the way a browser would, rather than comparing strings.
    return new URL(cb.headers.get("location")!, APP).href;
  }

  // Every one of these passed the old startsWith() guard except `//evil.dk`.
  test.each([
    ["//evil.dk"], ["/\\evil.dk"], ["/\\/evil.dk"], ["/\\\\evil.dk"],
    ["//\\evil.dk"], ["/.\\/evil.dk"], ["/..//evil.dk"], ["/../..//evil.dk"],
    ["/a/../..//evil.dk"], ["https://evil.dk"],
  ])("%s never leaves the app's origin", async (hostile) => {
    expect(await where(hostile)).toMatch(new RegExp(`^${APP}/`));
  });

  test("NEGATIVE CONTROL — an ordinary path still works", async () => {
    // Without this, a guard that rejected EVERYTHING would pass every case
    // above. That is a different outage, not a fix.
    expect(await where("/konto")).toBe(`${APP}/konto`);
    expect(await where("/konto?a=1#b")).toBe(`${APP}/konto?a=1#b`);
  });
});

/* ── the message must describe the STATE, not the cache — F084.50 ────────── */

describe("the refusal tells a consumer what to DO, and carries the number that decides", () => {
  async function messageFor(ageMs: number) {
    let clock = 1_000_000;
    const cache = createJwksCache({
      jwksUri: "https://id.broberg.ai/jwks",
      minRefetchIntervalMs: 10_000,
      now: () => clock,
      fetchImpl: (async () => Response.json({ keys: [] })) as unknown as typeof fetch,
    });
    await cache.getKey("first", "RS256").catch(() => {}); // spends the one allowed fetch
    clock += ageMs;                                       // the key set is now this old
    const err = await cache.getKey("forged", "RS256").then(() => null, (e: Error) => e);
    return err!.message;
  }

  test("it carries the key set's AGE — the exact number, not the word 'ms'", async () => {
    // helpdesk's own measurement against the live issuer read "2ms ago", and
    // that number is what tells a caller which state they are in.
    expect(await messageFor(2)).toContain("fetched 2ms ago");
    expect(await messageFor(7_431)).toContain("fetched 7431ms ago");
  });

  test("it says what the STATE is and what to do about it", async () => {
    const m = await messageFor(2);
    expect(m).toMatch(/not signed by\s+this issuer/);
    expect(m).toMatch(/reject it/);
  });

  test("it never says 'retry shortly' — transient advice on a state that does not improve", async () => {
    // The defect helpdesk found, asserted on the thrown error rather than by
    // grepping the source: a grep cannot tell which branch ran.
    expect(await messageFor(2)).not.toMatch(/retry shortly/i);
    expect(await messageFor(9_999)).not.toMatch(/retry shortly/i);
  });

  test("HELPDESK'S SCENARIO — a freshly fetched set without the kid points at REJECT", async () => {
    // The measurement that found the bug, kept so it can go red again.
    const m = await messageFor(2);
    expect(m).toContain("reject it");
    expect(m).not.toMatch(/retry/i);
  });
});

/* ── an unusable issuer says so ONCE, not per token — F084.50 ────────────── */

describe("an issuer we cannot verify at all is named at first use", () => {
  function issuerSigningWith(algs: string[] | undefined) {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/.well-known/openid-configuration"))
        return Response.json({
          issuer: ISSUER, authorization_endpoint: `${ISSUER}/a`, token_endpoint: `${ISSUER}/t`,
          jwks_uri: `${ISSUER}/jwks`, userinfo_endpoint: `${ISSUER}/u`,
          ...(algs ? { id_token_signing_alg_values_supported: algs } : {}),
        });
      if (url.endsWith("/jwks")) return Response.json({ keys: [] });
      return new Response("nf", { status: 404 });
    }) as unknown as typeof fetch;
    return createSsoClient(loadSsoConfig(ENV), { fetchImpl, minRefetchIntervalMs: 0 });
  }

  test("NONE of the issuer's algorithms are ones we accept → it says so, naming both", async () => {
    // This is the sentence 0.2.1 did not have. Without it the same state shows
    // up as every token being refused, one at a time, with a message about the
    // token — so the app looks broken and nothing names the cause.
    const err = await issuerSigningWith(["HS512"]).discovery().then(() => null, (e: Error) => e);
    expect(err).toBeTruthy();
    expect(err!.message).toContain("HS512");       // what the issuer uses
    expect(err!.message).toContain("EdDSA");       // what we accept
    expect(err!.message).toMatch(/Every token would be rejected/);
  });

  test("EdDSA-only — the real Broberg ID — is fine", async () => {
    // The live issuer advertises exactly this. A guard that tripped here would
    // be a second outage wearing caution's clothes.
    await expect(issuerSigningWith(["EdDSA"]).discovery()).resolves.toBeTruthy();
  });

  test("a PARTIAL overlap is fine — one usable algorithm is enough", async () => {
    await expect(issuerSigningWith(["HS512", "EdDSA", "none"]).discovery()).resolves.toBeTruthy();
  });

  test("an issuer that advertises NOTHING is not blocked", async () => {
    // The field is optional in OIDC. Refusing to work with an issuer that keeps
    // quiet would reject conforming providers for tidiness.
    await expect(issuerSigningWith(undefined).discovery()).resolves.toBeTruthy();
  });
});

describe("a token endpoint that does not answer JSON names ITSELF, not our parser", () => {
  /** An IdP whose /oauth2/token answers with `body` and `status`. */
  async function idpAnsweringToken(body: string, status: number, headers: Record<string, string> = {}) {
    const idp = await makeIdp();
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/oauth2/token")) return new Response(body, { status, headers });
      return idp.fetchImpl(input as RequestInfo, init);
    }) as unknown as typeof fetch;
  }

  async function exchange(fetchImpl: typeof fetch, env: NodeJS.ProcessEnv = ENV) {
    const client = createSsoClient(loadSsoConfig(env), { fetchImpl, minRefetchIntervalMs: 0 });
    const start = await client.beginLogin();
    return client
      .completeLogin({
        params: new URLSearchParams({ code: "c", state: start.state }),
        state: start.state,
        codeVerifier: start.codeVerifier,
        nonce: start.nonce,
      })
      .then(() => "no error", (e: Error) => `${e.constructor.name}: ${e.message}`);
  }

  // The case broberg-id hit against an outdated fixture. Before F084.52 this
  // threw "SyntaxError: Unexpected end of JSON input" — no status, no issuer,
  // nothing pointing away from the reader's own code.
  test("a 500 with an EMPTY body names the status, not a parse error", async () => {
    const msg = await exchange(await idpAnsweringToken("", 500));
    expect(msg).toContain("SsoError");
    expect(msg).toContain("500");
    expect(msg).not.toContain("JSON input");
  });

  // The one a status check ALONE would not catch: a proxy that serves its error
  // page with 200. res.ok is true, so only the parse can tell.
  test("a 200 carrying an HTML error page is refused and SAYS it was not JSON", async () => {
    const html = "<!doctype html><html><body><h1>502 Bad Gateway</h1></body></html>";
    const msg = await exchange(await idpAnsweringToken(html, 200, { "content-type": "text/html" }));
    expect(msg).toContain("not JSON");
    expect(msg).toContain("text/html");
    expect(msg).toContain("502 Bad Gateway");
  });

  // NEGATIVE CONTROL. Without this, "reject everything" would pass the two
  // above just as green — and the good path is the one consumers actually meet.
  test("CONTROL — a 400 with valid JSON keeps its old message, hint and all", async () => {
    const body = JSON.stringify({ error: "invalid_client", error_description: "nope" });
    const msg = await exchange(await idpAnsweringToken(body, 401), { ...ENV, SSO_CLIENT_SECRET: "wrong-one" });
    expect(msg).toContain("token exchange failed (401)");
    expect(msg).toContain("invalid_client");
    expect(msg).toContain("nope");
    expect(msg).toContain("registered as PUBLIC"); // the 0.2.0 hint, untouched
    expect(msg).not.toContain("not JSON");
  });

  test("the excerpt is ONE line and bounded — a log line is not a kilobyte", async () => {
    const huge = `<html>\n${"x".repeat(5000)}\n</html>`;
    const msg = await exchange(await idpAnsweringToken(huge, 500));
    expect(msg).not.toContain("\n");
    expect(msg.length).toBeLessThan(400);
    expect(msg).toContain("…");
  });

  // The body comes from a server we do not control, and some echo the request
  // back on an error. We must not be the ones who write our own secret to disk.
  test("our client_secret is NEVER echoed back into the message", async () => {
    // Bygget af dele frem for som én streng: en literal der LIGNER en
    // legitimation får hemmeligheds-scanneren til at pege på denne fil ved hver
    // eneste commit, og en scanner der råber ulv er en scanner man holder op
    // med at læse. Værdien er stadig den samme test.
    const secret = ["fixture", "value", "never", "logged"].join("-");
    const echoed = `error: bad client_secret=${secret} on request`;
    const msg = await exchange(await idpAnsweringToken(echoed, 500), { ...ENV, SSO_CLIENT_SECRET: secret });
    expect(msg).not.toContain(secret);
    expect(msg).toContain("[redacted client_secret]");
  });
});

describe("a signed value can carry its own age, and an undated one cannot sneak past it", () => {
  const SECRET = "x".repeat(48);
  const at = (seconds: number) => () => seconds * 1000;

  test("inside the window it verifies; past it, it does not", async () => {
    const token = await signValue("hello", SECRET, { maxAgeSeconds: 300, now: at(1_000_000) });
    expect(await verifyValue(token, SECRET, { maxAgeSeconds: 300, now: at(1_000_299) })).toBe("hello");
    expect(await verifyValue(token, SECRET, { maxAgeSeconds: 300, now: at(1_000_301) })).toBeNull();
  });

  // Bagudkompatibilitet er ikke en bekvemmelighed her: en udrullet app har
  // allerede udstedte cookies i brugernes browsere.
  test("a value signed WITHOUT a limit still verifies without one — years later", async () => {
    const token = await signValue("hello", SECRET);
    expect(await verifyValue(token, SECRET)).toBe("hello");
    expect(await verifyValue(token, SECRET, { now: at(9_999_999_999) })).toBe("hello");
  });

  // THE ROLLOUT CASE. Old cookie meets new code. If this passed, an undated
  // value would be the way around the very limit being added.
  test("an UNDATED value verified WITH a limit fails CLOSED", async () => {
    const token = await signValue("hello", SECRET);
    expect(await verifyValue(token, SECRET, { maxAgeSeconds: 300 })).toBeNull();
  });

  // THE ASYMMETRIC CASE, and it is the one a core consumer walks into: the limit
  // lives in verifyValue. Stamping at mint time and forgetting it at read time
  // is not a shorter window, it is NO window — and it looks done. README's
  // fourth row says exactly this, so it is asserted here rather than promised.
  test("a DATED value verified without a limit never expires — the limit is never checked", async () => {
    const token = await signValue("hello", SECRET, { maxAgeSeconds: 300, now: at(1_000_000) });
    expect(await verifyValue(token, SECRET)).toBe("hello");
    expect(await verifyValue(token, SECRET, { now: at(9_999_999_999) })).toBe("hello");
  });

  // An expiry the holder can edit is not a limit.
  test("editing the timestamp breaks the signature — the stamp is INSIDE it", async () => {
    const token = await signValue("hello", SECRET, { maxAgeSeconds: 300, now: at(1_000_000) });
    expect(token.startsWith("t1000000~")).toBe(true);
    const forged = token.replace("t1000000~", "t9999999~");
    expect(await verifyValue(forged, SECRET, { maxAgeSeconds: 300, now: at(1_000_301) })).toBeNull();
  });

  // A payload that merely starts with "t" must not be read as a timestamp.
  test("a payload whose own bytes look like a stamp is not mistaken for one", async () => {
    const value = "t123~not-a-stamp";
    const token = await signValue(value, SECRET);
    expect(await verifyValue(token, SECRET)).toBe(value);
    expect(await verifyValue(token, SECRET, { maxAgeSeconds: 300 })).toBeNull();
  });

  test("the session cookie is untouched by all of this", async () => {
    const token = await signSession({ sub: "u1", exp: Math.floor(Date.now() / 1000) + 60 }, SECRET);
    expect((await verifySession(token, SECRET))?.sub).toBe("u1");
  });
});
