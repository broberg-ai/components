// F007.19 — a loopback redirect may carry any port (RFC 8252 §7.3). Reported by buddy
// (#51731): Claude Code's CIMD document lists http://localhost/callback with NO port and
// then sends http://localhost:<random>/callback, so the exact match refused every login.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { createInMemoryClientStore, createOAuthRoutes } from "../src/oauth-web";

const ISSUER = "https://mail.example";
const CC = "https://claude.ai/oauth/claude-code-client-metadata";
const pkce = () => b64(createHash("sha256").update(b64(randomBytes(32))).digest());
const b64 = (b: Buffer) => b.toString("base64url");
const setup = () => createOAuthRoutes({ secret: "test-secret-test-secret-test-secret-0123456789", issuer: ISSUER, resource: `${ISSUER}/mcp`, clients: createInMemoryClientStore(), authorize: () => ({ sub: "u1" }) });
const authorize = async (redirect: string) => {
  const u = new URL(`${ISSUER}/authorize`);
  u.search = new URLSearchParams({ response_type: "code", client_id: CC, redirect_uri: redirect, code_challenge: pkce(), code_challenge_method: "S256", state: "s1" }).toString();
  const res = (await setup().handle(new Request(u)))!;
  return { status: res.status, body: res.status === 400 ? await res.json() : null };
};
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ client_id: CC, client_name: "Claude Code", redirect_uris: ["http://localhost/callback", "http://127.0.0.1/callback"], token_endpoint_auth_method: "none" }), { status: 200, headers: { "content-type": "application/json" } })));
});
afterEach(() => vi.unstubAllGlobals());

describe("loopback redirect with a port the client did not list (F007.19)", () => {
  it("http://localhost:53412/callback is accepted for a registered http://localhost/callback", async () => {
    expect((await authorize("http://localhost:53412/callback")).status).not.toBe(400);
  });
  it("http://127.0.0.1:61000/callback is accepted for a registered http://127.0.0.1/callback", async () => {
    expect((await authorize("http://127.0.0.1:61000/callback")).status).not.toBe(400);
  });
  it("a different PATH on the loopback is still refused", async () => {
    expect((await authorize("http://localhost:53412/evil")).body?.error_description).toBe("redirect_uri not registered for this client");
  });
  it("a non-loopback host is still refused", async () => {
    expect((await authorize("https://evil.com/callback")).status).toBe(400);
  });
  it("https on the loopback is not the registered http one", async () => {
    expect((await authorize("https://localhost:53412/callback")).status).toBe(400);
  });
  it("a query string the client did not register is refused", async () => {
    expect((await authorize("http://localhost:53412/callback?x=1")).status).toBe(400);
  });
});
