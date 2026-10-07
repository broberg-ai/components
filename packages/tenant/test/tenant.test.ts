// F029.8 — @broberg/tenant core. The same suite runs against three stores
// shaped like the fleet's real isolation models (F029.7): a shared DB with a
// tenant_id column, a DB per tenant (trail/Scout), and Scout's units — where a
// user belongs to a UNIT and the store derives the organisation membership.
import { describe, expect, test, vi } from "vitest";
import {
  acceptInvite,
  createInvite,
  createPolicy,
  hashInviteToken,
  InviteRefused,
  memoryTenantStore,
  resolveActiveTenant,
  revokeInvite,
  TenantChoiceRequired,
  TenantForbidden,
  TenantNoMembership,
  TenantNotFound,
  TenantNotMember,
  TenantSuspended,
  type Membership,
  type MembershipGrant,
  type StoredInvite,
  type Tenant,
  type TenantStore,
} from "../src/index";

const A: Tenant = { id: "t-a", slug: "alpha", name: "Alpha" };
const B: Tenant = { id: "t-b", slug: "beta", name: "Beta" };
const S: Tenant = { id: "t-s", slug: "sleepy", name: "Sleepy", status: "suspended" };
const ROLES = ["member", "admin"] as const;

/** Store 2: one «database» per tenant, plus a control table of tenants. */
function perTenantDbStore(seed: { tenants: Tenant[]; memberships: Membership[] }): TenantStore {
  const control = new Map(seed.tenants.map((t) => [t.id, t]));
  const dbs = new Map<string, { members: Map<string, string>; invites: StoredInvite[] }>(
    seed.tenants.map((t) => [t.id, { members: new Map(), invites: [] }]),
  );
  for (const m of seed.memberships) dbs.get(m.tenantId)!.members.set(m.userId, m.role);
  return {
    async tenantById(id) {
      return control.get(id) ?? null;
    },
    async tenantBySlug(slug) {
      return [...control.values()].find((t) => t.slug === slug) ?? null;
    },
    async membershipsOf(userId) {
      const out: Membership[] = [];
      for (const [tenantId, db] of dbs) {
        const role = db.members.get(userId);
        if (role) out.push({ userId, tenantId, role });
      }
      return out;
    },
    async addMembership(m) {
      const db = dbs.get(m.tenantId)!;
      if (!db.members.has(m.userId)) db.members.set(m.userId, m.role);
    },
    async saveInvite(i) {
      const list = dbs.get(i.tenantId)!.invites;
      const at = list.findIndex((x) => x.id === i.id);
      if (at >= 0) list[at] = { ...i };
      else list.push({ ...i });
    },
    async inviteByTokenHash(h) {
      for (const db of dbs.values()) {
        const hit = db.invites.find((i) => i.tokenHash === h);
        if (hit) return { ...hit };
      }
      return null;
    },
    async markInviteUsed(id, at, userId) {
      for (const db of dbs.values()) {
        const i = db.invites.find((x) => x.id === id);
        if (i) {
          if (i.usedAt !== undefined) return false;
          i.usedAt = at;
          i.usedBy = userId;
          return true;
        }
      }
      return false;
    },
  };
}

/**
 * Store 3: Scout's shape — memberships are per UNIT, and a user is a member of
 * the organisation if she is a member of any of its units. The package never
 * learns that units exist.
 */
function unitStore(seed: { tenants: Tenant[]; memberships: Membership[] }): TenantStore {
  const base = memoryTenantStore({ tenants: seed.tenants });
  const units = seed.tenants.map((t) => ({ unitId: `u-${t.id}`, orgId: t.id }));
  const unitMembers: { userId: string; unitId: string; role: string }[] = seed.memberships.map((m) => ({
    userId: m.userId,
    unitId: `u-${m.tenantId}`,
    role: m.role,
  }));
  return {
    ...base,
    async membershipsOf(userId) {
      const byOrg = new Map<string, string>();
      for (const um of unitMembers.filter((x) => x.userId === userId)) {
        const org = units.find((u) => u.unitId === um.unitId)!.orgId;
        if (!byOrg.has(org)) byOrg.set(org, um.role);
      }
      return [...byOrg].map(([tenantId, role]) => ({ userId, tenantId, role }));
    },
    async addMembership(m) {
      // F029.12: a scoped invitation names the unit; without one, the org's root unit.
      const unitId = m.scope ?? `u-${m.tenantId}`;
      if (!units.some((u) => u.unitId === unitId)) units.push({ unitId, orgId: m.tenantId });
      if (!unitMembers.some((x) => x.userId === m.userId && x.unitId === unitId)) unitMembers.push({ userId: m.userId, unitId, role: m.role });
    },
    unitMembers,
  } as TenantStore & { unitMembers: typeof unitMembers };
}

const STORES: [string, (seed: { tenants: Tenant[]; memberships: Membership[] }) => TenantStore][] = [
  ["shared DB + tenant_id", (s) => memoryTenantStore(s)],
  ["DB per tenant", perTenantDbStore],
  ["Scout units (derived org membership)", unitStore],
];

describe.each(STORES)("resolveActiveTenant — %s", (_name, make) => {
  const seed = () => ({
    tenants: [A, B, S],
    memberships: [
      { userId: "u1", tenantId: A.id, role: "member" },
      { userId: "u2", tenantId: A.id, role: "admin" },
      { userId: "u2", tenantId: B.id, role: "member" },
      { userId: "u3", tenantId: S.id, role: "member" },
    ],
  });

  test("REQUESTED is strict: a member of A asking for B is refused; asking for A gets A", async () => {
    const store = make(seed());
    await expect(resolveActiveTenant({ store, userId: "u1", requested: "beta" })).rejects.toBeInstanceOf(TenantNotMember);
    await expect(resolveActiveTenant({ store, userId: "u1", requested: "nope" })).rejects.toBeInstanceOf(TenantNotFound);
    await expect(resolveActiveTenant({ store, userId: "u3", requested: "sleepy" })).rejects.toBeInstanceOf(TenantSuspended);
    const r = await resolveActiveTenant({ store, userId: "u1", requested: "alpha" });
    expect([r.tenant.slug, r.membership.role, r.fellBack]).toEqual(["alpha", "member", false]);
  });

  test("a REQUESTED tenant wins over a preference, and a bad request never falls back to the preference", async () => {
    const store = make(seed());
    expect((await resolveActiveTenant({ store, userId: "u2", requested: "beta", preferred: "alpha" })).tenant.slug).toBe("beta");
    await expect(resolveActiveTenant({ store, userId: "u1", requested: "beta", preferred: "alpha" })).rejects.toBeInstanceOf(TenantNotMember);
  });

  test("PREFERRED that went stale falls back to the user's OWN membership, and says so", async () => {
    const store = make(seed());
    expect(await resolveActiveTenant({ store, userId: "u1", preferred: "beta" })).toMatchObject({ tenant: { slug: "alpha" }, fellBack: true, reason: "not_member" });
    expect(await resolveActiveTenant({ store, userId: "u1", preferred: "gone" })).toMatchObject({ tenant: { slug: "alpha" }, fellBack: true, reason: "not_found" });
    // negative control: a usable preference is not a fallback
    expect(await resolveActiveTenant({ store, userId: "u1", preferred: "alpha" })).toMatchObject({ tenant: { slug: "alpha" }, fellBack: false });
  });

  test("several memberships and nothing to choose by → refused, never «the first row»; pickDefault decides", async () => {
    const store = make(seed());
    await expect(resolveActiveTenant({ store, userId: "u2" })).rejects.toBeInstanceOf(TenantChoiceRequired);
    const r = await resolveActiveTenant({ store, userId: "u2", pickDefault: (u) => u.find((x) => x.tenant.slug === "beta") });
    expect(r.tenant.slug).toBe("beta");
  });

  test("pickDefault cannot smuggle in a tenant the user is not a member of", async () => {
    const store = make(seed());
    await expect(resolveActiveTenant({ store, userId: "u1", pickDefault: () => ({ tenant: B, membership: { userId: "u1", tenantId: B.id, role: "admin" } }) })).rejects.toBeInstanceOf(TenantChoiceRequired);
  });

  test("a suspended tenant is only called suspended to its MEMBERS — to anyone else it is not_member", async () => {
    const store = make(seed());
    await expect(resolveActiveTenant({ store, userId: "u1", requested: "sleepy" })).rejects.toBeInstanceOf(TenantNotMember);
    await expect(resolveActiveTenant({ store, userId: "u3", requested: "sleepy" })).rejects.toBeInstanceOf(TenantSuspended);
  });

  test("no usable membership (only a suspended tenant) → TenantNoMembership", async () => {
    const store = make(seed());
    await expect(resolveActiveTenant({ store, userId: "u3" })).rejects.toBeInstanceOf(TenantNoMembership);
    await expect(resolveActiveTenant({ store, userId: "nobody" })).rejects.toBeInstanceOf(TenantNoMembership);
  });
});

describe.each(STORES)("invitations — %s", (_name, make) => {
  const fresh = () => make({ tenants: [A, B, S], memberships: [{ userId: "boss", tenantId: A.id, role: "admin" }] });
  const T0 = 1_800_000_000_000;

  test("the token is never stored — only its SHA-256 — and the invite reads back with exactly the fields given", async () => {
    const store = fresh();
    const { invite, token } = await createInvite({ store, tenantId: A.id, email: "  Ny@Example.DK ", role: "member", invitableRoles: ROLES, invitedBy: "boss", now: T0 });
    const back = await store.inviteByTokenHash(await hashInviteToken(token));
    expect(back).toEqual(invite);
    expect(JSON.stringify(back).includes(token)).toBe(false);
    expect([back!.email, back!.expiresAt - back!.createdAt]).toEqual(["ny@example.dk", 7 * 24 * 60 * 60 * 1000]);
  });

  test("accept by the right user → membership read back; a second user with the same token → used", async () => {
    const store = fresh();
    const { token } = await createInvite({ store, tenantId: A.id, email: "ny@example.dk", role: "member", invitableRoles: ROLES, now: T0 });
    const m = await acceptInvite({ store, token, user: { id: "ny", email: "NY@example.dk" }, invitableRoles: ROLES, now: T0 + 1 });
    expect(m).toEqual({ userId: "ny", tenantId: A.id, role: "member" });
    expect(await store.membershipsOf("ny")).toEqual([{ userId: "ny", tenantId: A.id, role: "member" }]);
    await expect(acceptInvite({ store, token, user: { id: "other", email: "ny@example.dk" }, invitableRoles: ROLES, now: T0 + 2 })).rejects.toMatchObject({ reason: "used" });
    expect(await store.membershipsOf("other")).toEqual([]);
  });

  test("accepting again as the SAME user is safe: same membership, no duplicate", async () => {
    const store = fresh();
    const { token } = await createInvite({ store, tenantId: A.id, email: "ny@example.dk", role: "member", invitableRoles: ROLES, now: T0 });
    await acceptInvite({ store, token, user: { id: "ny", email: "ny@example.dk" }, invitableRoles: ROLES, now: T0 + 1 });
    await acceptInvite({ store, token, user: { id: "ny", email: "ny@example.dk" }, invitableRoles: ROLES, now: T0 + 2 });
    expect((await store.membershipsOf("ny")).length).toBe(1);
  });

  test("expired, wrong email, unknown token → named refusals and no membership", async () => {
    const store = fresh();
    const { token } = await createInvite({ store, tenantId: A.id, email: "ny@example.dk", role: "member", invitableRoles: ROLES, ttlMs: 1000, now: T0 });
    await expect(acceptInvite({ store, token, user: { id: "x", email: "someone@else.dk" }, invitableRoles: ROLES, now: T0 })).rejects.toMatchObject({ reason: "email_mismatch" });
    await expect(acceptInvite({ store, token, user: { id: "ny", email: "ny@example.dk" }, invitableRoles: ROLES, now: T0 + 1000 })).rejects.toMatchObject({ reason: "expired" });
    await expect(acceptInvite({ store, token: "not-a-token", user: { id: "ny", email: "ny@example.dk" }, invitableRoles: ROLES, now: T0 })).rejects.toMatchObject({ reason: "not_found" });
    expect(await store.membershipsOf("ny")).toEqual([]);
    expect(await store.membershipsOf("x")).toEqual([]);
  });

  test("an invitation can never grant a role outside invitableRoles — at create AND at accept", async () => {
    const store = fresh();
    await expect(createInvite({ store, tenantId: A.id, email: "a@b.dk", role: "owner", invitableRoles: ROLES, now: T0 })).rejects.toMatchObject({ reason: "role_not_invitable" });
    // a stored role that was tampered with is refused on accept
    const { invite, token } = await createInvite({ store, tenantId: A.id, email: "a@b.dk", role: "member", invitableRoles: ROLES, now: T0 });
    await store.saveInvite({ ...invite, role: "owner" });
    await expect(acceptInvite({ store, token, user: { id: "a", email: "a@b.dk" }, invitableRoles: ROLES, now: T0 + 1 })).rejects.toBeInstanceOf(InviteRefused);
    expect(await store.membershipsOf("a")).toEqual([]);
  });

  test("a revoked invitation is refused and grants nothing", async () => {
    const store = fresh();
    const { invite, token } = await createInvite({ store, tenantId: A.id, email: "r@x.dk", role: "member", invitableRoles: ROLES, now: T0 });
    await revokeInvite({ store, invite, now: T0 + 1 });
    await expect(acceptInvite({ store, token, user: { id: "r", email: "r@x.dk" }, invitableRoles: ROLES, now: T0 + 2 })).rejects.toMatchObject({ reason: "revoked" });
    expect(await store.membershipsOf("r")).toEqual([]);
  });

  test("an invitation to a suspended tenant cannot be created", async () => {
    await expect(createInvite({ store: fresh(), tenantId: S.id, email: "a@b.dk", role: "member", invitableRoles: ROLES, now: T0 })).rejects.toBeInstanceOf(TenantSuspended);
  });
});

test("two racing accepts by different users: exactly one becomes a member", async () => {
  const inner = memoryTenantStore({ tenants: [A] });
  const { token } = await createInvite({ store: inner, tenantId: A.id, email: "x@y.dk", role: "member", invitableRoles: ROLES });
  // A real race: neither accept may go on until BOTH have read the invite as unused,
  // so single use rests on markInviteUsed's atomicity and nothing else.
  let reads = 0;
  let release!: () => void;
  const bothRead = new Promise<void>((r) => (release = r));
  const store: TenantStore = {
    ...inner,
    async inviteByTokenHash(h) {
      const got = await inner.inviteByTokenHash(h);
      if (++reads === 2) release();
      if (reads <= 2) await bothRead;
      return got;
    },
  };
  const results = await Promise.allSettled([
    acceptInvite({ store, token, user: { id: "x1", email: "x@y.dk" }, invitableRoles: ROLES }),
    acceptInvite({ store, token, user: { id: "x2", email: "x@y.dk" }, invitableRoles: ROLES }),
  ]);
  expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
  const members = [...(await store.membershipsOf("x1")), ...(await store.membershipsOf("x2"))];
  expect(members.length).toBe(1);
});

describe("createPolicy — the app's role matrix (RBAC)", () => {
  type Action = "billing" | "team:manage" | "project:create" | "project:read";
  const policy = (onDenied = vi.fn()) => ({
    onDenied,
    p: createPolicy<Action>({
      roles: { owner: ["*"], admin: ["team:manage", "project:create", "project:read"], member: ["project:read"] },
      onDenied,
    }),
  });

  test("allowed, refused, unknown role, wildcard", () => {
    const { p } = policy();
    expect([p.can("owner", "billing"), p.can("admin", "billing"), p.can("admin", "team:manage"), p.can("member", "project:read"), p.can("ghost", "project:read"), p.can("__proto__", "project:read")]).toEqual([true, false, true, true, false, false]);
  });

  test("assert throws TenantForbidden AFTER onDenied has the denial (the audit hook)", async () => {
    const { p, onDenied } = policy();
    await expect(p.assert({ role: "member" }, "team:manage", { tenantId: A.id })).rejects.toBeInstanceOf(TenantForbidden);
    expect(onDenied.mock.calls).toEqual([[{ role: "member", action: "team:manage", context: { tenantId: A.id } }]]);
    await p.assert({ role: "admin" }, "team:manage");
    expect(onDenied.mock.calls.length).toBe(1);
  });
});

// F029.12 — an invitation to a UNIT (Scout). `scope` is opaque, write-side only.
describe("invitation scope (F029.12)", () => {
  const seed = () => ({ tenants: [A, B], memberships: [{ userId: "boss", tenantId: A.id, role: "admin" }] });
  const ny = { id: "ny", email: "ny@x.dk" };

  test("stored on the invitation, read back from the store", async () => {
    const store = memoryTenantStore(seed());
    const { invite } = await createInvite({ store, tenantId: A.id, email: "ny@x.dk", role: "member", scope: "unit-klinik-a", invitableRoles: ROLES });
    expect(store.invites.get(invite.id)?.scope).toBe("unit-klinik-a");
  });

  test("accept hands scope to addMembership and returns it", async () => {
    const store = memoryTenantStore(seed());
    const { token } = await createInvite({ store, tenantId: A.id, email: "ny@x.dk", role: "member", scope: "unit-klinik-a", invitableRoles: ROLES });
    const m = await acceptInvite({ store, token, user: ny, invitableRoles: ROLES });
    expect(m).toEqual({ userId: "ny", tenantId: A.id, role: "member", scope: "unit-klinik-a" });
    expect(store.grants).toEqual([{ userId: "ny", tenantId: A.id, role: "member", scope: "unit-klinik-a" }]);
    // the read side is untouched: one org-level row, no scope
    expect(await store.membershipsOf("ny")).toEqual([{ userId: "ny", tenantId: A.id, role: "member" }]);
  });

  test("a half-finished accept is healed WITH its scope", async () => {
    const base = memoryTenantStore(seed());
    let fail = true;
    const seen: MembershipGrant[] = [];
    const store: TenantStore = {
      ...base,
      async addMembership(m) {
        seen.push(m);
        if (fail) {
          fail = false;
          throw new Error("crash after markInviteUsed");
        }
        await base.addMembership(m);
      },
    };
    const { token } = await createInvite({ store, tenantId: A.id, email: "ny@x.dk", role: "member", scope: "unit-klinik-a", invitableRoles: ROLES });
    await expect(acceptInvite({ store, token, user: ny, invitableRoles: ROLES })).rejects.toThrow("crash after markInviteUsed");
    expect(base.grants).toEqual([]);
    const again = await acceptInvite({ store, token, user: ny, invitableRoles: ROLES });
    expect(again.scope).toBe("unit-klinik-a");
    expect(seen.map((m) => m.scope)).toEqual(["unit-klinik-a", "unit-klinik-a"]);
    expect(base.grants).toEqual([{ userId: "ny", tenantId: A.id, role: "member", scope: "unit-klinik-a" }]);
  });

  test("no scope → exactly the 0.1.0 shape (no scope key anywhere)", async () => {
    const store = memoryTenantStore(seed());
    const { invite, token } = await createInvite({ store, tenantId: A.id, email: "ny@x.dk", role: "member", invitableRoles: ROLES });
    expect("scope" in store.invites.get(invite.id)!).toBe(false);
    const m = await acceptInvite({ store, token, user: ny, invitableRoles: ROLES });
    expect(m).toEqual({ userId: "ny", tenantId: A.id, role: "member" });
    expect("scope" in m).toBe(false);
    expect(store.grants).toEqual([]);
  });

  test("Scout units: two units in ONE org are still one tenant choice", async () => {
    const store = unitStore({ tenants: [A, B], memberships: [] }) as TenantStore & { unitMembers: { userId: string; unitId: string; role: string }[] };
    for (const scope of ["unit-klinik-a", "unit-klinik-b"]) {
      const { token } = await createInvite({ store, tenantId: A.id, email: "ny@x.dk", role: "member", scope, invitableRoles: ROLES });
      await acceptInvite({ store, token, user: ny, invitableRoles: ROLES });
    }
    expect(store.unitMembers.filter((u) => u.userId === "ny").map((u) => u.unitId)).toEqual(["unit-klinik-a", "unit-klinik-b"]);
    expect(await store.membershipsOf("ny")).toEqual([{ userId: "ny", tenantId: A.id, role: "member" }]);
    const active = await resolveActiveTenant({ store, userId: "ny" });
    expect(active.tenant.id).toBe(A.id);
    expect(active.membership.role).toBe("member");
  });

  test("invitableRoles still applies with a scope", async () => {
    const store = memoryTenantStore(seed());
    await expect(
      createInvite({ store, tenantId: A.id, email: "ny@x.dk", role: "owner", scope: "unit-klinik-a", invitableRoles: ROLES }),
    ).rejects.toMatchObject({ reason: "role_not_invitable" });
  });
});
