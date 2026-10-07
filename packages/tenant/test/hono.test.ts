// F029.9 — @broberg/tenant/hono: JSON refusals, never redirects; RBAC per route;
// invitations end to end through the routes, read back from the store.
import { describe, expect, test, vi } from "vitest";
import { Hono } from "hono";
import { createPolicy, memoryTenantStore, type Tenant } from "../src/index";
import { getTenant, requireCapability, tenantMiddleware, tenantRoutes, type TenantUser } from "../src/hono";

const A: Tenant = { id: "t-a", slug: "alpha", name: "Alpha" };
const B: Tenant = { id: "t-b", slug: "beta", name: "Beta" };
const S: Tenant = { id: "t-s", slug: "sleepy", name: "Sleepy", status: "suspended" };
const USERS: Record<string, TenantUser> = {
  boss: { id: "boss", email: "boss@x.dk" },
  mem: { id: "mem", email: "mem@x.dk" },
  ny: { id: "ny", email: "ny@x.dk" },
  ny2: { id: "ny2", email: "ny@x.dk" },
  sus: { id: "sus", email: "sus@x.dk" },
};
type Action = "team:manage" | "project:read";

function setup() {
  const store = memoryTenantStore({
    tenants: [A, B, S],
    memberships: [
      { userId: "boss", tenantId: A.id, role: "admin" },
      { userId: "mem", tenantId: A.id, role: "member" },
      { userId: "sus", tenantId: S.id, role: "member" },
    ],
  });
  const onDenied = vi.fn();
  const policy = createPolicy<Action>({ roles: { admin: ["*"], member: ["project:read"] }, onDenied });
  const sent: { to: string; token: string; role: string }[] = [];
  const user = (c: { req: { header(n: string): string | undefined } }) => USERS[c.req.header("x-user") ?? ""] ?? null;
  const cookieSet: string[] = [];
  const app = new Hono();
  app.use(
    "/t/:tenant/*",
    tenantMiddleware({ store, user, requested: (c) => c.req.param("tenant"), preferred: (c) => c.req.header("x-pref") }),
  );
  app.get("/t/:tenant/whoami", (c) => c.json({ tenant: getTenant(c)!.tenant.slug, role: getTenant(c)!.membership.role }));
  app.get("/t/:tenant/team", requireCapability(policy, "team:manage"), (c) => c.json({ ok: true }));
  app.route(
    "/t/:tenant/api",
    tenantRoutes({ store, user, invitableRoles: ["member", "admin"], invite: { policy, action: "team:manage", deliverInvite: async (m) => void sent.push(m) } }),
  );
  // a route that only knows the preference (e.g. the app's home)
  app.use("/home/*", tenantMiddleware({ store, user, preferred: (c) => c.req.header("x-pref"), onFellBack: () => void cookieSet.push("cleared") }));
  app.get("/home/x", (c) => c.json({ tenant: getTenant(c)!.tenant.slug, fellBack: getTenant(c)!.fellBack }));
  app.route("/me", tenantRoutes({ store, user, invitableRoles: ["member", "admin"] }));
  const req = (path: string, as?: string, init: RequestInit = {}, extra: Record<string, string> = {}) =>
    app.request(path, { ...init, headers: { ...(as ? { "x-user": as } : {}), "content-type": "application/json", ...extra } });
  return { store, app, req, onDenied, sent, cookieSet };
}

const body = async (r: Response) => [r.status, r.headers.get("location"), await r.json()];

describe("tenantMiddleware — JSON, never a redirect", () => {
  test("no user → 401; my tenant → set on the context", async () => {
    const t = setup();
    expect(await body(await t.req("/t/alpha/whoami"))).toEqual([401, null, { error: "unauthenticated" }]);
    expect(await body(await t.req("/t/alpha/whoami", "mem"))).toEqual([200, null, { tenant: "alpha", role: "member" }]);
  });

  test("a tenant that exists but is not mine and one that does not exist give the SAME 404 (no slug enumeration)", async () => {
    const t = setup();
    const notMine = await body(await t.req("/t/beta/whoami", "mem"));
    const missing = await body(await t.req("/t/nope/whoami", "mem"));
    expect(notMine).toEqual([404, null, { error: "tenant_not_found" }]);
    expect(missing).toEqual(notMine);
    // a suspended tenant is a plain 404 to a non-member, and 403 only to its member
    expect(await body(await t.req("/t/sleepy/whoami", "mem"))).toEqual([404, null, { error: "tenant_not_found" }]);
    expect(await body(await t.req("/t/sleepy/whoami", "sus"))).toEqual([403, null, { error: "tenant_suspended" }]);
  });

  test("a stale preference falls back to my own tenant and the app is told (onFellBack)", async () => {
    const t = setup();
    expect(await body(await t.req("/home/x", "mem", {}, { "x-pref": "beta" }))).toEqual([200, null, { tenant: "alpha", fellBack: true }]);
    expect(t.cookieSet).toEqual(["cleared"]);
  });
});

describe("requireCapability — RBAC per route", () => {
  test("member denied → 403 JSON after the audit hook; admin allowed", async () => {
    const t = setup();
    expect(await body(await t.req("/t/alpha/team", "mem"))).toEqual([403, null, { error: "forbidden", action: "team:manage" }]);
    expect(t.onDenied.mock.calls).toEqual([[{ role: "member", action: "team:manage", context: { tenantId: A.id, userId: "mem" } }]]);
    expect(await body(await t.req("/t/alpha/team", "boss"))).toEqual([200, null, { ok: true }]);
  });

  test("without tenantMiddleware in front, the route is refused, never opened", async () => {
    const policy = createPolicy<Action>({ roles: { admin: ["*"] } });
    const app = new Hono();
    app.get("/naked", requireCapability(policy, "team:manage"), (c) => c.json({ ok: true }));
    const r = await app.request("/naked");
    expect([r.status, await r.json()]).toEqual([500, { error: "no_tenant_context" }]);
  });
});

describe("tenantRoutes — invitations end to end, read back from the store", () => {
  test("admin invites → the link is delivered, the response carries NO token; the invitee accepts → member", async () => {
    const t = setup();
    const r = await t.req("/t/alpha/api/invites", "boss", { method: "POST", body: JSON.stringify({ email: "Ny@X.dk", role: "member" }) });
    const created = await r.json();
    expect(r.status).toBe(201);
    expect(Object.keys(created)).toEqual(["inviteId"]);
    expect(t.sent.map((s) => [s.to, s.role])).toEqual([["ny@x.dk", "member"]]);
    const token = t.sent[0]!.token;
    expect(JSON.stringify(created).includes(token)).toBe(false);

    const acc = await t.req("/me/invites/accept", "ny", { method: "POST", body: JSON.stringify({ token }) });
    expect(await body(acc)).toEqual([200, null, { tenant: { id: A.id, slug: "alpha", name: "Alpha" }, role: "member" }]);
    expect(await t.store.membershipsOf("ny")).toEqual([{ userId: "ny", tenantId: A.id, role: "member" }]);
    expect(await body(await t.req("/me/memberships", "ny"))).toEqual([200, null, [{ tenant: { id: A.id, slug: "alpha", name: "Alpha" }, role: "member" }]]);
  });

  test("a member may not invite (403, nothing delivered); an admin may not invite as owner (403)", async () => {
    const t = setup();
    expect((await t.req("/t/alpha/api/invites", "mem", { method: "POST", body: JSON.stringify({ email: "a@b.dk", role: "member" }) })).status).toBe(403);
    expect(await body(await t.req("/t/alpha/api/invites", "boss", { method: "POST", body: JSON.stringify({ email: "a@b.dk", role: "owner" }) }))).toEqual([
      403,
      null,
      { error: "invite_role_not_invitable" },
    ]);
    expect(t.sent).toEqual([]);
  });

  test("accept refusals are JSON with the reason: wrong email 403, second use 409, garbage 404, no user 401", async () => {
    const t = setup();
    await t.req("/t/alpha/api/invites", "boss", { method: "POST", body: JSON.stringify({ email: "ny@x.dk", role: "member" }) });
    const token = t.sent[0]!.token;
    expect(await body(await t.req("/me/invites/accept", "mem", { method: "POST", body: JSON.stringify({ token }) }))).toEqual([403, null, { error: "invite_email_mismatch" }]);
    await t.req("/me/invites/accept", "ny", { method: "POST", body: JSON.stringify({ token }) });
    // another account with the same email, after the invite was used → 409
    expect(await body(await t.req("/me/invites/accept", "ny2", { method: "POST", body: JSON.stringify({ token }) }))).toEqual([409, null, { error: "invite_used" }]);
    expect(await t.store.membershipsOf("ny2")).toEqual([]);
    expect(await body(await t.req("/me/invites/accept", "ny", { method: "POST", body: JSON.stringify({ token: "garbage" }) }))).toEqual([404, null, { error: "invite_not_found" }]);
    expect((await t.req("/me/invites/accept", undefined, { method: "POST", body: JSON.stringify({ token }) })).status).toBe(401);
    expect(await t.store.membershipsOf("mem")).toEqual([{ userId: "mem", tenantId: A.id, role: "member" }]);
  });

  test("without deliverInvite the invite route does not exist (a token never goes back to the browser)", async () => {
    const t = setup();
    expect((await t.req("/me/invites", "boss", { method: "POST", body: JSON.stringify({ email: "a@b.dk", role: "member" }) })).status).toBe(404);
  });

  test("a write from another site (even a sibling subdomain) → 403 cross_site, nothing created; same-origin passes", async () => {
    const t = setup();
    for (const site of ["cross-site", "same-site"]) {
      const r = await t.req("/t/alpha/api/invites", "boss", { method: "POST", body: JSON.stringify({ email: "a@b.dk", role: "member" }) }, { "sec-fetch-site": site });
      expect([r.status, await r.json()]).toEqual([403, { error: "cross_site" }]);
    }
    expect(t.sent).toEqual([]);
    const ok = await t.req("/t/alpha/api/invites", "boss", { method: "POST", body: JSON.stringify({ email: "a@b.dk", role: "member" }) }, { "sec-fetch-site": "same-origin" });
    expect([ok.status, t.sent.length]).toEqual([201, 1]);
  });

  test("every answer is no-store", async () => {
    const t = setup();
    expect((await t.req("/me/memberships", "mem")).headers.get("cache-control")).toBe("no-store");
  });
});
