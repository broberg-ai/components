// F007.14 — the attack xrt81 measured, and the three things that now stop it.
//
// Up to 0.6.0: an attacker registers their own client with their own
// redirect_uri, sends a member a link, and the member's session cookie
// (SameSite=Lax follows a click) makes the authorize callback return { sub } —
// a code went straight to the attacker. PKCE did not help: the attacker owns
// the verifier.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { createInMemoryClientStore, createOAuthRoutes } from "../src/oauth-web";

const SECRET = "test-secret-test-secret-test-secret-0123456789";
const ISSUER = "https://club.example";
const CLAUDE = "https://claude.ai/api/mcp/auth_callback";
const EVIL = "https://evil.example/steal";

const b64url = (b: Buffer) => b.toString("base64url");
function pkce() {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()) };
}

/** The member is logged in: every authorize call sees their session. `sub` can change between calls. */
function setup(opts: { sub?: () => string; allowedRedirectHosts?: string[]; consumeCode?: (jti: string, exp: number) => boolean } = {}) {
  const clients = createInMemoryClientStore();
  const r = createOAuthRoutes({
    secret: SECRET,
    issuer: ISSUER,
    resource: `${ISSUER}/mcp`,
    clients,
    allowedRedirectHosts: opts.allowedRedirectHosts,
    consumeCode: opts.consumeCode,
    authorize: () => ({ sub: opts.sub?.() ?? "member-42", scope: "club:read" }),
  });
  return { r, clients };
}
const register = (r: ReturnType<typeof setup>["r"], uris: string[], name = "Claude") =>
  r.handle(new Request(`${ISSUER}/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: uris, client_name: name }) }));

function authUrl(clientId: string, redirect: string, challenge: string) {
  const u = new URL(`${ISSUER}/authorize`);
  u.search = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: "S256", scope: "club:read", state: "s1" }).toString();
  return u;
}
const hiddenFields = (html: string) => {
  const f = new URLSearchParams();
  for (const m of html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)) f.set(m[1]!, m[2]!.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
  return f;
};
const post = (r: ReturnType<typeof setup>["r"], f: URLSearchParams) =>
  r.handle(new Request(`${ISSUER}/authorize`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: f.toString() }));

afterEach(() => vi.useRealTimers());

describe("redirect allowlist", () => {
  it("refuses an attacker's redirect at /register; allows the connector hosts and loopback", async () => {
    const { r } = setup();
    expect((await register(r, [EVIL]))!.status).toBe(400);
    expect((await register(r, ["http://claude.ai/cb"]))!.status).toBe(400); // non-loopback must be https
    expect((await register(r, [CLAUDE]))!.status).toBe(201);
    expect((await register(r, ["https://chatgpt.com/connector/oauth/x"]))!.status).toBe(201);
    expect((await register(r, ["http://localhost:6274/cb", "http://127.0.0.1:9/cb"]))!.status).toBe(201);
    expect((await register(r, [CLAUDE, EVIL]))!.status).toBe(400); // one bad uri refuses the lot
  });

  it("allowedRedirectHosts replaces the default list", async () => {
    const { r } = setup({ allowedRedirectHosts: ["connector.example"] });
    expect((await register(r, ["https://connector.example/cb"]))!.status).toBe(201);
    expect((await register(r, [CLAUDE]))!.status).toBe(400);
  });

  it("a client registered BEFORE 0.7.0 with any redirect is refused at /authorize", async () => {
    const { r, clients } = setup();
    const old = await clients.registerClient!({ redirect_uris: [EVIL], client_name: "old" } as never);
    const res = await r.handle(new Request(authUrl(old.client_id, EVIL, pkce().challenge)));
    expect(res!.status).toBe(400);
    expect(res!.headers.get("location")).toBeNull();
  });
});

describe("consent page — no code without the member pressing approve", () => {
  it("the attack: a logged-in member opening the link gets a consent page, NOT a code", async () => {
    const { r } = setup();
    const client = await (await register(r, [CLAUDE], 'Evil <script>alert(1)</script>'))!.json();
    const res = await r.handle(new Request(authUrl(client.client_id, CLAUDE, pkce().challenge)));
    expect(res!.status).toBe(200);
    expect(res!.headers.get("location")).toBeNull();
    const html = await res!.text();
    expect(html).not.toMatch(/[?&]code=/);
    expect(html).toContain("Evil &lt;script&gt;alert(1)&lt;/script&gt;"); // the name is shown, escaped
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain('data-testid="oauth-consent-redirect-host">claude.ai<');
    expect(res!.headers.get("x-frame-options")).toBe("DENY");
    expect(res!.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("approve on the POST issues the code; deny returns access_denied", async () => {
    const { r } = setup();
    const client = await (await register(r, [CLAUDE]))!.json();
    const page = await (await r.handle(new Request(authUrl(client.client_id, CLAUDE, pkce().challenge))))!.text();

    const f = hiddenFields(page);
    f.set("decision", "approve");
    const ok = await post(r, f);
    expect(ok!.status).toBe(302);
    const loc = new URL(ok!.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe(CLAUDE);
    expect(loc.searchParams.get("code")).toBeTruthy();
    expect(loc.searchParams.get("state")).toBe("s1");

    const d = hiddenFields(page);
    d.set("decision", "deny");
    const no = await post(r, d);
    expect(new URL(no!.headers.get("location")!).searchParams.get("error")).toBe("access_denied");
  });

  it("a POST without, or with a forged, consent token issues nothing", async () => {
    const { r } = setup();
    const client = await (await register(r, [CLAUDE]))!.json();
    const page = await (await r.handle(new Request(authUrl(client.client_id, CLAUDE, pkce().challenge))))!.text();
    const f = hiddenFields(page);
    f.set("decision", "approve");

    const none = new URLSearchParams(f);
    none.delete("consent_token");
    expect((await post(r, none))!.status).toBe(400);

    const forged = new URLSearchParams(f);
    const [body] = f.get("consent_token")!.split(".");
    forged.set("consent_token", `${body}.AAAA`);
    expect((await post(r, forged))!.status).toBe(400);
  });

  it("the token is bound to the member, the redirect and the PKCE challenge", async () => {
    let who = "member-42";
    const { r } = setup({ sub: () => who });
    const client = await (await register(r, [CLAUDE, "https://claude.com/cb"]))!.json();
    const page = await (await r.handle(new Request(authUrl(client.client_id, CLAUDE, pkce().challenge))))!.text();
    const f = hiddenFields(page);
    f.set("decision", "approve");

    const otherChallenge = new URLSearchParams(f);
    otherChallenge.set("code_challenge", pkce().challenge);
    expect((await post(r, otherChallenge))!.status).toBe(400);

    const otherRedirect = new URLSearchParams(f);
    otherRedirect.set("redirect_uri", "https://claude.com/cb");
    expect((await post(r, otherRedirect))!.status).toBe(400);

    who = "someone-else";
    expect((await post(r, f))!.status).toBe(400);
  });

  it("an expired consent token issues nothing", async () => {
    vi.useFakeTimers();
    const { r } = setup();
    const client = await (await register(r, [CLAUDE]))!.json();
    const page = await (await r.handle(new Request(authUrl(client.client_id, CLAUDE, pkce().challenge))))!.text();
    const f = hiddenFields(page);
    f.set("decision", "approve");
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    expect((await post(r, f))!.status).toBe(400);
  });
});

describe("single-use authorization codes", () => {
  async function codeFor(r: ReturnType<typeof setup>["r"], challenge: string) {
    const client = await (await register(r, [CLAUDE]))!.json();
    const page = await (await r.handle(new Request(authUrl(client.client_id, CLAUDE, challenge))))!.text();
    const f = hiddenFields(page);
    f.set("decision", "approve");
    const code = new URL((await post(r, f))!.headers.get("location")!).searchParams.get("code")!;
    return { code, clientId: client.client_id as string };
  }
  const redeem = (r: ReturnType<typeof setup>["r"], code: string, verifier: string, clientId: string) =>
    r.handle(new Request(`${ISSUER}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: CLAUDE, client_id: clientId }).toString() }));

  it("a code redeems once; the second attempt is invalid_grant", async () => {
    const { r } = setup();
    const { verifier, challenge } = pkce();
    const { code, clientId } = await codeFor(r, challenge);
    expect((await redeem(r, code, verifier, clientId))!.status).toBe(200);
    const again = await redeem(r, code, verifier, clientId);
    expect(again!.status).toBe(400);
    expect(await again!.json()).toEqual({ error: "invalid_grant", error_description: "authorization code already used" });
  });

  it("a wrong verifier does not burn the code for the real client", async () => {
    const { r } = setup();
    const { verifier, challenge } = pkce();
    const { code, clientId } = await codeFor(r, challenge);
    expect((await redeem(r, code, "wrong", clientId))!.status).toBe(400);
    expect((await redeem(r, code, verifier, clientId))!.status).toBe(200);
  });

  it("consumeCode is used when given (several replicas)", async () => {
    const seen: string[] = [];
    const { r } = setup({ consumeCode: (jti) => (seen.includes(jti) ? false : (seen.push(jti), true)) });
    const { verifier, challenge } = pkce();
    const { code, clientId } = await codeFor(r, challenge);
    expect((await redeem(r, code, verifier, clientId))!.status).toBe(200);
    expect(seen).toHaveLength(1);
  });
});
