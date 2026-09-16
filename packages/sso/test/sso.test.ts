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
import { createJwksCache, JwksError } from "../src/jwks.js";
import { signSession, verifySession, signValue, verifyValue } from "../src/session.js";

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
      await expect(cache.getKey(`nope-${i}`, "RS256")).rejects.toThrow(/Refusing to refetch/);
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
