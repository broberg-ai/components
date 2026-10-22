// F007.16 — CIMD: client_id is an https URL to a metadata document claude.ai hosts.
// F007.18 — your own consent page gets { request, sub } and may be async.
//
// The new risk in F007.16 is SSRF: the server fetches a URL a stranger chose.
// Every refusal test COUNTS fetch calls, so "refused without fetching" is
// measured, not assumed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { createInMemoryClientStore, createOAuthRoutes, type OAuthWebConfig } from "../src/oauth-web";

const SECRET = "test-secret-test-secret-test-secret-0123456789";
const ISSUER = "https://club.example";
const CLAUDE_CB = "https://claude.ai/api/mcp/auth_callback";
const CIMD = "https://claude.ai/oauth/mcp-oauth-client-metadata";

const b64url = (b: Buffer) => b.toString("base64url");
function pkce() {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()) };
}
function setup(extra: Partial<OAuthWebConfig> = {}) {
  return createOAuthRoutes({
    secret: SECRET,
    issuer: ISSUER,
    resource: `${ISSUER}/mcp`,
    clients: createInMemoryClientStore(),
    authorize: () => ({ sub: "member-42", scope: "club:read" }),
    ...extra,
  });
}
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
const doc = (over: Record<string, unknown> = {}) => ({ client_id: CIMD, client_name: "Claude", redirect_uris: [CLAUDE_CB], token_endpoint_auth_method: "none", ...over });

let fetchMock: ReturnType<typeof vi.fn>;
function serve(body: unknown, init: ResponseInit = {}) {
  fetchMock = vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init }));
  vi.stubGlobal("fetch", fetchMock);
}
beforeEach(() => serve(doc()));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("CIMD metadata", () => {
  it("the AS metadata says CIMD is supported, and still offers DCR", async () => {
    const m = await (await setup().handle(new Request(`${ISSUER}/.well-known/oauth-authorization-server`)))!.json();
    expect(m.client_id_metadata_document_supported).toBe(true);
    expect(m.registration_endpoint).toBe(`${ISSUER}/register`);
  });

  it("an empty host list turns CIMD off in the metadata too", async () => {
    const m = await (await setup({ allowedClientMetadataHosts: [] }).handle(new Request(`${ISSUER}/.well-known/oauth-authorization-server`)))!.json();
    expect(m.client_id_metadata_document_supported).toBe(false);
  });
});

describe("CIMD authorize", () => {
  it("fetches the document, shows consent with its client_name, and the code redeems at /token", async () => {
    const r = setup();
    const { verifier, challenge } = pkce();
    const page = await r.handle(new Request(authUrl(CIMD, CLAUDE_CB, challenge)));
    expect(page!.status).toBe(200);
    const html = await page!.text();
    expect(html).toContain('data-testid="oauth-consent-client">Claude<');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(CIMD);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ redirect: "error" });

    const f = hiddenFields(html);
    f.set("decision", "approve");
    const back = await r.handle(new Request(`${ISSUER}/authorize`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: f.toString() }));
    expect(back!.status).toBe(302);
    const code = new URL(back!.headers.get("location")!).searchParams.get("code")!;
    const tok = await r.handle(new Request(`${ISSUER}/token`, { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: CIMD, redirect_uri: CLAUDE_CB }).toString() }));
    expect(tok!.status).toBe(200);
    expect(typeof (await tok!.json()).access_token).toBe("string");
  });

  it("a redirect_uri not in the document is refused, without a redirect", async () => {
    const res = await setup().handle(new Request(authUrl(CIMD, "https://claude.ai/other", pkce().challenge)));
    expect(res!.status).toBe(400);
    expect(res!.headers.get("location")).toBeNull();
  });

  it("a redirect_uri the document lists but the allowlist refuses is still refused", async () => {
    serve(doc({ redirect_uris: [CLAUDE_CB, "https://evil.example/steal"] }));
    const res = await setup().handle(new Request(authUrl(CIMD, "https://evil.example/steal", pkce().challenge)));
    expect(res!.status).toBe(400);
    expect(res!.headers.get("location")).toBeNull();
  });

  it("a document whose client_id is not exactly the URL is refused", async () => {
    serve(doc({ client_id: CIMD + "/" }));
    const res = await setup().handle(new Request(authUrl(CIMD, CLAUDE_CB, pkce().challenge)));
    expect(await res!.json()).toEqual({ error: "invalid_client", error_description: "client_metadata_mismatch" });
  });

  it("the token is not issued to a different client than the code was", async () => {
    const r = setup();
    const { verifier, challenge } = pkce();
    const f = hiddenFields(await (await r.handle(new Request(authUrl(CIMD, CLAUDE_CB, challenge))))!.text());
    f.set("decision", "approve");
    const back = await r.handle(new Request(`${ISSUER}/authorize`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: f.toString() }));
    const code = new URL(back!.headers.get("location")!).searchParams.get("code")!;
    const tok = await r.handle(new Request(`${ISSUER}/token`, { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: "https://claude.ai/someone-else", redirect_uri: CLAUDE_CB }).toString() }));
    expect(tok!.status).toBe(400);
  });
});

describe("CIMD SSRF guard — refused WITHOUT fetching anything else", () => {
  const reason = async (clientId: string, r = setup()) => {
    const res = await r.handle(new Request(authUrl(clientId, CLAUDE_CB, pkce().challenge)));
    expect(res!.status).toBe(400);
    return (await res!.json()).error_description;
  };

  it("a host not on the list is never fetched", async () => {
    expect(await reason("https://169.254.169.254/latest/meta-data")).toBe("client_metadata_host_not_allowed");
    expect(await reason("https://evil.example/client.json")).toBe("client_metadata_host_not_allowed");
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it("an empty host list fetches nothing", async () => {
    expect(await reason(CIMD, setup({ allowedClientMetadataHosts: [] }))).toBe("client_metadata_host_not_allowed");
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it("http is not CIMD at all — unknown client, nothing fetched", async () => {
    expect(await reason("http://claude.ai/oauth/x")).toBe("unknown client_id");
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it("a failing fetch (refused redirect, timeout, non-200) is refused", async () => {
    fetchMock = vi.fn(async () => { throw new TypeError("fetch failed: redirect mode is error"); });
    vi.stubGlobal("fetch", fetchMock);
    expect(await reason(CIMD)).toBe("client_metadata_fetch_failed");
    serve("nope", { status: 404 });
    expect(await reason(CIMD)).toBe("client_metadata_fetch_failed");
  });

  it("a streamed body over 64 KB is refused", async () => {
    serve({ ...doc(), pad: "x".repeat(70 * 1024) });
    expect(await reason(CIMD)).toBe("client_metadata_fetch_failed");
  });

  it("a declared content-length over 64 KB is refused before the body is read, even if the body is small", async () => {
    serve(doc(), { headers: { "content-type": "application/json", "content-length": String(80 * 1024) } });
    expect(await reason(CIMD)).toBe("client_metadata_fetch_failed");
  });
});

describe("CIMD cache", () => {
  it("two authorizes within the TTL fetch once", async () => {
    const r = setup({ clientMetadataCacheMs: 60_000 });
    await r.handle(new Request(authUrl(CIMD, CLAUDE_CB, pkce().challenge)));
    await r.handle(new Request(authUrl(CIMD, CLAUDE_CB, pkce().challenge)));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("after the TTL the document is fetched again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const r = setup({ clientMetadataCacheMs: 60_000 });
    await r.handle(new Request(authUrl(CIMD, CLAUDE_CB, pkce().challenge)));
    vi.setSystemTime(Date.now() + 61_000);
    await r.handle(new Request(authUrl(CIMD, CLAUDE_CB, pkce().challenge)));
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe("F007.18 — renderConsent(info, { request, sub })", () => {
  it("is awaited, and gets the incoming request and the sub from authorize", async () => {
    const seen: { sub?: string; cookie?: string | null } = {};
    const r = setup({
      renderConsent: async (info, ctx) => {
        seen.sub = ctx.sub;
        seen.cookie = ctx.request.headers.get("cookie");
        await new Promise((res) => setTimeout(res, 1));
        return `<p>hej ${ctx.sub} · ${info.clientName}</p>`;
      },
    });
    const req = new Request(authUrl(CIMD, CLAUDE_CB, pkce().challenge), { headers: { cookie: "lang=en" } });
    const res = await r.handle(req);
    expect(await res!.text()).toBe("<p>hej member-42 · Claude</p>");
    expect(seen).toEqual({ sub: "member-42", cookie: "lang=en" });
  });

  it("a synchronous one-argument renderConsent still works", async () => {
    const r = setup({ renderConsent: (info) => `<p>${info.lang}</p>` });
    expect(await (await r.handle(new Request(authUrl(CIMD, CLAUDE_CB, pkce().challenge))))!.text()).toBe("<p>da</p>");
  });

  it("a throwing renderConsent fails the request — no page, no code", async () => {
    const r = setup({ renderConsent: async () => { throw new Error("db down"); } });
    await expect(r.handle(new Request(authUrl(CIMD, CLAUDE_CB, pkce().challenge)))).rejects.toThrow("db down");
  });
});
