// components-F084.181 — login without a client_secret: the app proves itself at
// BID's token endpoint with its Fly identity (BID F084.180).
import { afterEach, describe, expect, test, vi } from "vitest";

const flyCalls: string[] = [];
let flyAnswer: () => Promise<string> = async () => "fly.oidc.token";
vi.mock("../src/fetch-ticket.js", async (orig) => ({
  ...(await orig<typeof import("../src/fetch-ticket.js")>()),
  flyOidcOverSocket: (aud: string) => {
    flyCalls.push(aud);
    return flyAnswer();
  },
}));

const { loadSsoConfig, SsoConfigError } = await import("../src/config.js");
const { createSsoClient, FLY_CLIENT_ASSERTION_TYPE } = await import("../src/client.js");
const { ssoRoutes } = await import("../src/hono.js");

const ISSUER = "https://id.broberg.ai";
const TOKEN_ENDPOINT = `${ISSUER}/oauth2/token`;
const ENV = {
  BID_ISSUER: ISSUER,
  SSO_CLIENT_ID: "app",
  SSO_REDIRECT_URI: "https://app.example/auth/callback",
  SSO_COOKIE_SECRET: "s".repeat(64),
} as NodeJS.ProcessEnv;

/** A fake BID that records every token request and refuses it (the body is what we measure). */
function fakeBid() {
  const tokenBodies: URLSearchParams[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith("/.well-known/openid-configuration")) {
      return Response.json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/oauth2/authorize`,
        token_endpoint: TOKEN_ENDPOINT,
        jwks_uri: `${ISSUER}/jwks`,
        end_session_endpoint: `${ISSUER}/oauth2/end-session`,
      });
    }
    if (url === TOKEN_ENDPOINT) {
      tokenBodies.push(new URLSearchParams(String(init?.body)));
      return Response.json({ error: "invalid_grant" }, { status: 400 });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, tokenBodies };
}

async function loginOnce(env: NodeJS.ProcessEnv, opts: { flyOidc?: (aud: string) => Promise<string> } = {}) {
  const bid = fakeBid();
  const client = createSsoClient(loadSsoConfig(env), { fetchImpl: bid.fetchImpl, minRefetchIntervalMs: 0, ...opts });
  const start = await client.beginLogin();
  const err = await client
    .completeLogin({ params: new URLSearchParams({ code: "c", state: start.state }), state: start.state, codeVerifier: start.codeVerifier, nonce: start.nonce })
    .then(() => null, (e: Error) => e);
  return { bid, err };
}

afterEach(() => {
  flyCalls.length = 0;
  flyAnswer = async () => "fly.oidc.token";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("core: clientAuth \"fly\"", () => {
  test("the token request carries the Fly assertion and NO client_secret — even with a secret configured", async () => {
    const auds: string[] = [];
    const { bid } = await loginOnce(
      { ...ENV, SSO_CLIENT_AUTH: "fly", SSO_CLIENT_SECRET: "s3cr3t-value" },
      { flyOidc: async (aud) => (auds.push(aud), "fly.oidc.token") },
    );
    const body = bid.tokenBodies[0]!;
    expect(body.get("client_assertion_type")).toBe(FLY_CLIENT_ASSERTION_TYPE);
    expect(FLY_CLIENT_ASSERTION_TYPE).toBe("urn:broberg:params:oauth:client-assertion-type:fly-oidc");
    expect(body.get("client_assertion")).toBe("fly.oidc.token");
    expect(body.has("client_secret")).toBe(false);
    expect(body.get("code_verifier")).toBeTruthy();
    // aud is the TOKEN ENDPOINT, never the issuer — so a ticket token cannot be replayed as a login proof.
    expect(auds).toEqual([TOKEN_ENDPOINT]);
  });

  test("negative control: without clientAuth the request is the 0.20.0 one — client_secret, no assertion", async () => {
    let asked = false;
    const { bid } = await loginOnce({ ...ENV, SSO_CLIENT_SECRET: "s3cr3t-value" }, { flyOidc: async () => ((asked = true), "x") });
    const body = bid.tokenBodies[0]!;
    expect(body.get("client_secret")).toBe("s3cr3t-value");
    expect(body.has("client_assertion")).toBe(false);
    expect(body.has("client_assertion_type")).toBe(false);
    expect(asked).toBe(false);
  });

  test("a failed Fly token fails the login with a named cause — the token endpoint is never called with a secret", async () => {
    const { bid, err } = await loginOnce(
      { ...ENV, SSO_CLIENT_AUTH: "fly", SSO_CLIENT_SECRET: "s3cr3t-value" },
      { flyOidc: async () => { throw new Error("Fly OIDC socket: ENOENT"); } },
    );
    expect(err?.name).toBe("SsoError");
    expect(err?.message).toBe(`fly client assertion unavailable: could not get a Fly OIDC token for ${TOKEN_ENDPOINT} — Fly OIDC socket: ENOENT`);
    expect(bid.tokenBodies).toEqual([]);
  });

  test("refresh uses the same proof", async () => {
    const bid = fakeBid();
    const client = createSsoClient(loadSsoConfig({ ...ENV, SSO_CLIENT_AUTH: "fly" }), { fetchImpl: bid.fetchImpl, minRefetchIntervalMs: 0, flyOidc: async () => "fly.oidc.token" });
    await client.refreshTokens("rt").catch(() => {});
    expect(bid.tokenBodies[0]!.get("client_assertion")).toBe("fly.oidc.token");
    expect(bid.tokenBodies[0]!.has("client_secret")).toBe(false);
  });

  test("SSO_CLIENT_AUTH accepts only secret | fly", () => {
    expect(() => loadSsoConfig({ ...ENV, SSO_CLIENT_AUTH: "flyio" })).toThrow(SsoConfigError);
    expect(loadSsoConfig({ ...ENV, SSO_CLIENT_AUTH: "fly" }).clientAuth).toBe("fly");
    expect(loadSsoConfig(ENV).clientAuth).toBeUndefined();
  });
});

describe("Hono: ssoRoutes({ clientAuth: \"fly\" })", () => {
  async function callback(routeOpts: { clientAuth?: "secret" | "fly" }, env: NodeJS.ProcessEnv) {
    const bid = fakeBid();
    vi.stubGlobal("fetch", bid.fetchImpl);
    const logged: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void logged.push(a.map(String).join(" ")));
    const { app } = ssoRoutes({ config: loadSsoConfig(env), ...routeOpts });
    const login = await app.request("https://app.example/login");
    const tx = login.headers.get("set-cookie")!.split(";")[0]!;
    const state = new URL(login.headers.get("location")!).searchParams.get("state")!;
    const cb = await app.request(`https://app.example/callback?code=c&state=${state}`, { headers: { cookie: tx } });
    return { bid, cb, logged };
  }

  test("the option reaches the token request", async () => {
    const { bid } = await callback({ clientAuth: "fly" }, { ...ENV, SSO_CLIENT_SECRET: "s3cr3t-value" });
    expect(flyCalls).toEqual([TOKEN_ENDPOINT]);
    expect(bid.tokenBodies[0]!.get("client_assertion")).toBe("fly.oidc.token");
    expect(bid.tokenBodies[0]!.has("client_secret")).toBe(false);
  });

  test("negative control: without the option the route sends the secret", async () => {
    const { bid } = await callback({}, { ...ENV, SSO_CLIENT_SECRET: "s3cr3t-value" });
    expect(flyCalls).toEqual([]);
    expect(bid.tokenBodies[0]!.get("client_secret")).toBe("s3cr3t-value");
  });

  test("Fly down: one answer to the browser, the cause in the log, no secret sent", async () => {
    flyAnswer = async () => { throw new Error("Fly OIDC answered 503"); };
    const { bid, cb, logged } = await callback({ clientAuth: "fly" }, { ...ENV, SSO_CLIENT_SECRET: "s3cr3t-value" });
    // ssoRoutes lets a failed exchange reach the app's error handler (as for any
    // token-exchange failure since 0.1): Hono's default answers one generic 500
    // and logs the error — with its named cause.
    expect(cb.status).toBe(500);
    expect(await cb.text()).toBe("Internal Server Error");
    expect(bid.tokenBodies).toEqual([]);
    expect(logged.some((l) => l.includes("fly client assertion unavailable") && l.includes("Fly OIDC answered 503"))).toBe(true);
  });
});
