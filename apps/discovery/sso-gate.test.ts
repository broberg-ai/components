import { describe, expect, it } from "vitest";
// F038.23 — people sign in with Broberg ID; only allowlisted subjects get in.
// Env BEFORE importing the server: the sso adapter is configured at module load.
process.env.ENROLL_DB_URL = ":memory:";
process.env.BID_ISSUER = "https://id.broberg.ai";
process.env.SSO_CLIENT_ID = "discovery";
process.env.SSO_REDIRECT_URI = "https://discovery.broberg.ai/auth/callback";
process.env.SSO_COOKIE_SECRET = "s".repeat(64);
process.env.DISCOVERY_ALLOWED_SUBS = "owner-sub-1, owner-sub-2";

const { app } = await import("./server");
const { signSession } = await import("@broberg/sso");

const cookieFor = async (sub: string) => `bid_session=${await signSession({ sub, exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000) }, process.env.SSO_COOKIE_SECRET!)}`;

describe("F038.23 — Broberg ID login on Discovery", () => {
  it("a browser without a login is sent to /auth/login, keeping where it was going", async () => {
    const res = await app.request("/api/packages?x=1", { headers: { accept: "text/html" } });
    expect([res.status, res.headers.get("location")]).toEqual([302, "/auth/login?returnTo=%2Fapi%2Fpackages%3Fx%3D1"]);
  });
  it("a machine without a login still gets the JSON 401, not a redirect", async () => {
    const res = await app.request("/api/packages", { headers: { accept: "application/json" } });
    expect(res.status).toBe(401);
  });
  it("an allowlisted Broberg ID subject gets in", async () => {
    const res = await app.request("/api/packages", { headers: { cookie: await cookieFor("owner-sub-2") } });
    expect(res.status).toBe(200);
  });
  it("a Broberg ID account NOT on the list is refused with 403 — an account alone is not access", async () => {
    const res = await app.request("/api/packages", { headers: { cookie: await cookieFor("someone-else") } });
    expect(res.status).toBe(403);
  });
  it("a forged cookie (wrong secret) is no login at all", async () => {
    const forged = `bid_session=${await signSession({ sub: "owner-sub-1", exp: Math.floor(Date.now() / 1000) + 3600 }, "x".repeat(64))}`;
    const res = await app.request("/api/packages", { headers: { cookie: forged, accept: "application/json" } });
    expect(res.status).toBe(401);
  });
});
