// @broberg/tenant — organisations, memberships, invitations and role checks,
// the same way in every app (F029).
//
// THE SURVEY THAT SHAPED THIS (F029.7, six apps read at named commits): the
// tenant / membership / invitation shape repeats in five or six of them, and
// choosing the active organisation is where the bugs are — four of six fall
// back to «the first membership» or «the first site» without saying so. What
// does NOT repeat is how tenant data is isolated (a shared DB with tenant_id,
// a DB per organisation, a directory per site). So this package owns the rules
// and never the storage: the app implements `TenantStore` against its own
// database, whatever shape that is.
//
// Organisations and memberships never live in Broberg ID (D-5345a2): BID says
// who the user is, the app says which organisations she belongs to.

// ── Types ──────────────────────────────────────────────────────────────────

export interface Tenant {
  id: string;
  /** Unique and immutable — the thing a URL or header names. */
  slug: string;
  name: string;
  /** Absent means active. A suspended tenant is refused everywhere. */
  status?: "active" | "suspended";
}

/**
 * A user's membership of ONE tenant. `role` is the app's own vocabulary
 * (owner/admin/member, owner/operator/viewer …) — the package never defines it.
 * An app whose members belong to sub-units (Scout's units, cms' sites) derives
 * this organisation-level membership in its store.
 */
export interface Membership {
  userId: string;
  tenantId: string;
  role: string;
}

/**
 * What accepting an invitation WRITES: a Membership plus the invitation's
 * `scope`, when it had one. `scope` is opaque to the package — Scout puts a
 * unit id there. It exists only on the write side: `membershipsOf` keeps
 * returning ONE organisation-level Membership per tenant, so a user in two
 * units of one org is still one tenant choice with one role.
 */
export interface MembershipGrant extends Membership {
  scope?: string;
}

/** An invitation as stored. The token itself is NEVER stored — only its hash. */
export interface StoredInvite {
  id: string;
  tenantId: string;
  /** Lower-cased and trimmed. */
  email: string;
  role: string;
  /** Opaque to the package; carried into addMembership on accept. */
  scope?: string;
  tokenHash: string;
  invitedBy?: string;
  createdAt: number;
  expiresAt: number;
  usedAt?: number;
  usedBy?: string;
  revokedAt?: number;
}

/**
 * Where tenant data lives — implemented by the app against its own database.
 * The package calls only these; it never opens a tenant database itself.
 */
export interface TenantStore {
  tenantById(id: string): Promise<Tenant | null>;
  tenantBySlug(slug: string): Promise<Tenant | null>;
  /**
   * Every membership the user has, across tenants — ONE organisation-level row
   * per tenant, never one per scope (derive it, as Scout does from units).
   */
  membershipsOf(userId: string): Promise<Membership[]>;
  /**
   * Idempotent: adding an existing (userId, tenantId) must not duplicate it —
   * keyed (userId, tenantId, scope) when the grant carries a scope. A grant
   * with a scope must also leave the user a member of the tenant as a whole.
   */
  addMembership(m: MembershipGrant): Promise<void>;
  /** Insert, or replace the invite with the same id. */
  saveInvite(invite: StoredInvite): Promise<void>;
  inviteByTokenHash(tokenHash: string): Promise<StoredInvite | null>;
  /**
   * Mark the invite used — ATOMICALLY: return true only for the call that
   * changed it from unused, false when it was already used. This is what makes
   * an invitation single-use when two requests race.
   */
  markInviteUsed(id: string, at: number, userId: string): Promise<boolean>;
}

// ── Errors ─────────────────────────────────────────────────────────────────

/** Base class. Every refusal in this package is one of these, never a null. */
export class TenantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantError";
  }
}

export class TenantNotFound extends TenantError {
  constructor(readonly slug: string) {
    super(`No tenant "${slug}".`);
    this.name = "TenantNotFound";
  }
}

export class TenantNotMember extends TenantError {
  constructor(readonly slug: string) {
    super(`The user is not a member of "${slug}".`);
    this.name = "TenantNotMember";
  }
}

export class TenantSuspended extends TenantError {
  constructor(readonly slug: string) {
    super(`Tenant "${slug}" is suspended.`);
    this.name = "TenantSuspended";
  }
}

/** The user has no usable membership at all. */
export class TenantNoMembership extends TenantError {
  constructor() {
    super("The user has no active membership of any tenant.");
    this.name = "TenantNoMembership";
  }
}

/**
 * Several memberships, no request, no usable preference, and no rule from the
 * app for choosing. Refused rather than picking «the first row» — the bug the
 * survey found in four apps. The app supplies `pickDefault` to decide.
 */
export class TenantChoiceRequired extends TenantError {
  constructor(readonly count: number) {
    super(`The user is a member of ${count} tenants and nothing says which one — pass pickDefault.`);
    this.name = "TenantChoiceRequired";
  }
}

export type InviteRefusal = "not_found" | "expired" | "revoked" | "used" | "email_mismatch" | "role_not_invitable";

export class InviteRefused extends TenantError {
  constructor(readonly reason: InviteRefusal) {
    super(`Invitation refused: ${reason}.`);
    this.name = "InviteRefused";
  }
}

export class TenantForbidden extends TenantError {
  constructor(
    readonly role: string,
    readonly action: string,
  ) {
    super(`Role "${role}" may not "${action}".`);
    this.name = "TenantForbidden";
  }
}

// ── Choosing the active tenant ─────────────────────────────────────────────

export type FallbackReason = "not_found" | "not_member" | "suspended";

export interface ActiveTenant {
  tenant: Tenant;
  membership: Membership;
  /**
   * True when a STORED preference could not be used and another of the user's
   * own memberships was chosen. The app should clear the stale preference, and
   * the UI should say which tenant is active.
   */
  fellBack: boolean;
  reason?: FallbackReason;
}

export interface ResolveInput {
  store: TenantStore;
  userId: string;
  /**
   * An explicit choice for THIS request (path slug, header). STRICT: if the
   * user cannot use it, the call throws — otherwise an answer would be shown
   * under the wrong tenant's name.
   */
  requested?: string | null;
  /**
   * A standing preference (cookie, a stored «active tenant»). It goes stale
   * for innocent reasons — a revoked membership, a deleted tenant — and a hard
   * refusal there would lock the user out of her own system. So it falls back,
   * but only to one of the user's OWN memberships, and says so (trail's
   * pattern, F029 #1976).
   */
  preferred?: string | null;
  /**
   * The app's rule for choosing among several usable memberships when there is
   * no request and no usable preference (e.g. the most recently used). Without
   * it, one membership is chosen and several are refused (TenantChoiceRequired).
   */
  pickDefault?: (usable: { tenant: Tenant; membership: Membership }[]) => { tenant: Tenant; membership: Membership } | undefined;
}

type Usable = { tenant: Tenant; membership: Membership };

async function memberships(store: TenantStore, userId: string): Promise<{ all: Membership[]; usable: Usable[] }> {
  const all = await store.membershipsOf(userId);
  const usable: Usable[] = [];
  for (const m of all) {
    const tenant = await store.tenantById(m.tenantId);
    if (tenant && tenant.status !== "suspended") usable.push({ tenant, membership: m });
  }
  return { all, usable };
}

/**
 * Why `slug` cannot be used by this user. «Suspended» is only said to a
 * MEMBER of that tenant — to anyone else a suspended tenant is simply one they
 * are not a member of, so its existence is not revealed.
 */
async function check(store: TenantStore, slug: string, m: { all: Membership[]; usable: Usable[] }): Promise<{ ok: Usable } | { why: FallbackReason }> {
  const tenant = await store.tenantBySlug(slug);
  if (!tenant) return { why: "not_found" };
  const isMember = m.all.some((x) => x.tenantId === tenant.id);
  if (!isMember) return { why: "not_member" };
  if (tenant.status === "suspended") return { why: "suspended" };
  const hit = m.usable.find((u) => u.tenant.id === tenant.id);
  return hit ? { ok: hit } : { why: "not_member" };
}

/**
 * The tenant this request acts in. Never returns a tenant outside the user's
 * own memberships, in any mode.
 */
export async function resolveActiveTenant(input: ResolveInput): Promise<ActiveTenant> {
  const { store, userId } = input;
  const ms = await memberships(store, userId);
  const usable = ms.usable;

  if (input.requested) {
    const r = await check(store, input.requested, ms);
    if ("ok" in r) return { ...r.ok, fellBack: false };
    if (r.why === "not_found") throw new TenantNotFound(input.requested);
    if (r.why === "suspended") throw new TenantSuspended(input.requested);
    throw new TenantNotMember(input.requested);
  }

  let reason: FallbackReason | undefined;
  if (input.preferred) {
    const r = await check(store, input.preferred, ms);
    if ("ok" in r) return { ...r.ok, fellBack: false };
    reason = r.why;
  }

  if (usable.length === 0) throw new TenantNoMembership();
  const chosen = input.pickDefault ? input.pickDefault(usable) : usable.length === 1 ? usable[0] : undefined;
  // The app's rule may only choose among the user's own memberships.
  if (!chosen || !usable.some((u) => u.tenant.id === chosen.tenant.id && u.membership.userId === userId)) {
    throw new TenantChoiceRequired(usable.length);
  }
  return { tenant: chosen.tenant, membership: chosen.membership, fellBack: reason !== undefined, ...(reason ? { reason } : {}) };
}

// ── Invitations ────────────────────────────────────────────────────────────

const DAY = 24 * 60 * 60 * 1000;
export const DEFAULT_INVITE_TTL_MS = 7 * DAY;

const normEmail = (e: string) => e.trim().toLowerCase();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** SHA-256 of the token, hex. The only form a token is ever stored in. */
export async function hashInviteToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface CreateInviteInput {
  store: TenantStore;
  tenantId: string;
  email: string;
  role: string;
  /**
   * Opaque — a unit, a site, whatever level below the organisation the app
   * has. The package stores it and hands it to addMembership on accept; it
   * never checks it. Whether the INVITER may grant this scope is the app's
   * check, made before calling createInvite (the /hono route asks
   * `authorizeScope`).
   */
  scope?: string;
  /**
   * The roles an invitation may grant. A role outside it is refused — an
   * invitation can never be the way to become owner or platform admin unless
   * the app says so (helpdesk's rule).
   */
  invitableRoles: readonly string[];
  invitedBy?: string;
  ttlMs?: number;
  now?: number;
}

/**
 * Create an invitation. Returns the token ONCE — put it in the link you mail
 * (via @broberg/mail in the app). Only its hash is stored.
 */
export async function createInvite(input: CreateInviteInput): Promise<{ invite: StoredInvite; token: string }> {
  if (!input.invitableRoles.includes(input.role)) throw new InviteRefused("role_not_invitable");
  const tenant = await input.store.tenantById(input.tenantId);
  if (!tenant) throw new TenantNotFound(input.tenantId);
  if (tenant.status === "suspended") throw new TenantSuspended(tenant.slug);
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const now = input.now ?? Date.now();
  const invite: StoredInvite = {
    id: b64url(crypto.getRandomValues(new Uint8Array(12))),
    tenantId: tenant.id,
    email: normEmail(input.email),
    role: input.role,
    ...(input.scope !== undefined ? { scope: input.scope } : {}),
    tokenHash: await hashInviteToken(token),
    ...(input.invitedBy ? { invitedBy: input.invitedBy } : {}),
    createdAt: now,
    expiresAt: now + (input.ttlMs ?? DEFAULT_INVITE_TTL_MS),
  };
  await input.store.saveInvite(invite);
  return { invite, token };
}

export interface AcceptInviteInput {
  store: TenantStore;
  token: string;
  /** The SIGNED-IN user. Her email must match the invitation. */
  user: { id: string; email: string };
  /** Checked again on accept, so a tampered stored role cannot slip through. */
  invitableRoles: readonly string[];
  now?: number;
}

/**
 * Accept an invitation: one use, before it expires, by the user it was sent
 * to. Repeating the accept as the SAME user is safe and returns the same
 * membership; anyone else gets `used`.
 */
export async function acceptInvite(input: AcceptInviteInput): Promise<MembershipGrant> {
  const { store, user } = input;
  const now = input.now ?? Date.now();
  const invite = await store.inviteByTokenHash(await hashInviteToken(input.token));
  if (!invite) throw new InviteRefused("not_found");
  if (invite.revokedAt !== undefined) throw new InviteRefused("revoked");
  if (normEmail(user.email) !== invite.email) throw new InviteRefused("email_mismatch");
  if (!input.invitableRoles.includes(invite.role)) throw new InviteRefused("role_not_invitable");
  const membership: MembershipGrant = {
    userId: user.id,
    tenantId: invite.tenantId,
    role: invite.role,
    ...(invite.scope !== undefined ? { scope: invite.scope } : {}),
  };

  if (invite.usedAt !== undefined) {
    if (invite.usedBy !== user.id) throw new InviteRefused("used");
    await store.addMembership(membership); // heals a half-finished earlier accept
    return membership;
  }
  if (now >= invite.expiresAt) throw new InviteRefused("expired");
  const tenant = await store.tenantById(invite.tenantId);
  if (!tenant) throw new TenantNotFound(invite.tenantId);
  if (tenant.status === "suspended") throw new TenantSuspended(tenant.slug);

  // Claim it first, atomically: of two racing accepts exactly one gets true.
  if (!(await store.markInviteUsed(invite.id, now, user.id))) {
    const again = await store.inviteByTokenHash(invite.tokenHash);
    if (again?.usedBy !== user.id) throw new InviteRefused("used");
  }
  await store.addMembership(membership);
  return membership;
}

/**
 * Revoke an invitation that has not been used yet. Pass the stored invite (the
 * app lists its own invites); an accept after this is refused with `revoked`.
 */
export async function revokeInvite(input: { store: TenantStore; invite: StoredInvite; now?: number }): Promise<StoredInvite> {
  const revoked = { ...input.invite, revokedAt: input.now ?? Date.now() };
  await input.store.saveInvite(revoked);
  return revoked;
}

// ── Role checks (RBAC) ─────────────────────────────────────────────────────

export interface PolicyConfig<Action extends string> {
  /** role → the actions it may do. `"*"` grants every action. Unknown roles may do nothing. */
  roles: Record<string, readonly (Action | "*")[]>;
  /** Called on every refusal from `assert` — the place for an audit row. */
  onDenied?: (denial: { role: string; action: Action; context?: unknown }) => void | Promise<void>;
}

export interface Policy<Action extends string> {
  can(role: string, action: Action): boolean;
  /** Throws TenantForbidden (after onDenied) when the membership's role may not. */
  assert(membership: Pick<Membership, "role">, action: Action, context?: unknown): Promise<void>;
}

/**
 * The app's role matrix as a checker. Deny by default: a role or an action
 * that is not listed is refused.
 */
export function createPolicy<Action extends string>(config: PolicyConfig<Action>): Policy<Action> {
  const can = (role: string, action: Action): boolean => {
    const allowed = Object.prototype.hasOwnProperty.call(config.roles, role) ? config.roles[role] : undefined;
    return !!allowed && (allowed.includes("*") || allowed.includes(action));
  };
  return {
    can,
    async assert(membership, action, context) {
      if (can(membership.role, action)) return;
      await config.onDenied?.({ role: membership.role, action, ...(context !== undefined ? { context } : {}) });
      throw new TenantForbidden(membership.role, action);
    },
  };
}

// ── In-memory store (tests, one dev process) ───────────────────────────────

/**
 * A TenantStore in this process's memory. For tests and a single dev process
 * only — it forgets everything on restart. Doubles as the reference for what
 * an app's own store must do (note markInviteUsed's atomicity).
 */
export function memoryTenantStore(seed: { tenants?: Tenant[]; memberships?: Membership[] } = {}): TenantStore & {
  readonly invites: ReadonlyMap<string, StoredInvite>;
  /** Every scoped grant written by addMembership, in order. */
  readonly grants: readonly MembershipGrant[];
} {
  const tenants = new Map((seed.tenants ?? []).map((t) => [t.id, { ...t }]));
  const memberships: Membership[] = (seed.memberships ?? []).map((m) => ({ ...m }));
  const grants: MembershipGrant[] = [];
  const invites = new Map<string, StoredInvite>();
  return {
    invites,
    grants,
    async tenantById(id) {
      return tenants.get(id) ?? null;
    },
    async tenantBySlug(slug) {
      for (const t of tenants.values()) if (t.slug === slug) return t;
      return null;
    },
    async membershipsOf(userId) {
      return memberships.filter((m) => m.userId === userId).map((m) => ({ ...m }));
    },
    async addMembership(m) {
      // A scoped grant is kept apart; the org-level row (first role wins) is
      // what membershipsOf answers — a real store derives that role its own way.
      if (m.scope !== undefined && !grants.some((x) => x.userId === m.userId && x.tenantId === m.tenantId && x.scope === m.scope)) {
        grants.push({ ...m });
      }
      if (!memberships.some((x) => x.userId === m.userId && x.tenantId === m.tenantId)) {
        memberships.push({ userId: m.userId, tenantId: m.tenantId, role: m.role });
      }
    },
    async saveInvite(invite) {
      invites.set(invite.id, { ...invite });
    },
    async inviteByTokenHash(hash) {
      for (const i of invites.values()) if (i.tokenHash === hash) return { ...i };
      return null;
    },
    async markInviteUsed(id, at, userId) {
      const i = invites.get(id);
      if (!i || i.usedAt !== undefined) return false;
      invites.set(id, { ...i, usedAt: at, usedBy: userId });
      return true;
    },
  };
}
