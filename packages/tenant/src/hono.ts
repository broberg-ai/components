// @broberg/tenant/hono — the tenant rules as Hono middleware and routes (F029.9).
//
// Every refusal is JSON with a status, never a redirect: these sit in front of
// APIs, and a fetch cannot follow a redirect to a login page (the reason
// sso.require is wrong in front of an API, F097).
import { Hono, type Context, type MiddlewareHandler } from "hono";
import {
  acceptInvite,
  createInvite,
  resolveActiveTenant,
  type ActiveTenant,
  type Membership,
  type Policy,
  type ResolveInput,
  type Tenant,
  type TenantStore,
} from "./index.js";

/** The signed-in user, as the app knows her — from @broberg/sso's session, or anything else. */
export interface TenantUser {
  id: string;
  email: string;
}

type UserFn = (c: Context) => TenantUser | null | Promise<TenantUser | null>;

const TENANT_KEY = "broberg.tenant";

/** The active tenant set by tenantMiddleware, or null outside it. */
export function getTenant(c: Context): ActiveTenant | null {
  return (c.get(TENANT_KEY as never) as ActiveTenant | undefined) ?? null;
}

/**
 * Errors are matched by NAME, not instanceof: an app may build its store or
 * policy from the main entry, which is a separate bundle with its own copies
 * of the classes (the lesson from @broberg/sso's accountRoutes).
 */
function nameOf(e: unknown): string | undefined {
  return e instanceof Error ? e.name : undefined;
}

/**
 * JSON for every refusal this package makes. TenantNotFound and TenantNotMember
 * are the SAME 404 on purpose: a non-member must not be able to learn which
 * tenant slugs exist. TenantSuspended is only ever thrown to a member (the core
 * decides that), so its 403 reveals nothing new.
 */
export function tenantErrorResponse(c: Context, e: unknown): Response | null {
  const err = e as { reason?: string; count?: number; action?: string };
  switch (nameOf(e)) {
    case "TenantNotFound":
    case "TenantNotMember":
      return c.json({ error: "tenant_not_found" }, 404);
    case "TenantSuspended":
      return c.json({ error: "tenant_suspended" }, 403);
    case "TenantNoMembership":
      return c.json({ error: "no_tenant" }, 403);
    case "TenantChoiceRequired":
      return c.json({ error: "tenant_choice_required", count: err.count }, 409);
    case "TenantForbidden":
      return c.json({ error: "forbidden", action: err.action }, 403);
    case "InviteRefused": {
      const status = ({ not_found: 404, expired: 410, revoked: 410, used: 409, email_mismatch: 403, role_not_invitable: 403 } as const)[
        err.reason as "not_found"
      ];
      return c.json({ error: `invite_${err.reason}` }, status ?? 400);
    }
    default:
      return null;
  }
}

export interface TenantMiddlewareOptions extends Pick<ResolveInput, "pickDefault"> {
  store: TenantStore;
  user: UserFn;
  /** The explicit tenant for THIS request (strict) — e.g. `(c) => c.req.param("tenant")`. */
  requested?: (c: Context) => string | null | undefined;
  /** The standing preference (may fall back) — e.g. a cookie. */
  preferred?: (c: Context) => string | null | undefined;
  /** Called when the preference was stale and another of the user's memberships was used — clear it here. */
  onFellBack?: (c: Context, active: ActiveTenant) => void | Promise<void>;
}

/**
 * Resolve the tenant for this request and put it on the context (`getTenant(c)`).
 * 401 without a user, 404 for a tenant that is not hers (whether or not it
 * exists), 403 suspended / no tenant, 409 when several memberships and nothing
 * says which.
 */
export function tenantMiddleware(o: TenantMiddlewareOptions): MiddlewareHandler {
  return async (c, next) => {
    const user = await o.user(c);
    if (!user) return c.json({ error: "unauthenticated" }, 401);
    let active: ActiveTenant;
    try {
      active = await resolveActiveTenant({
        store: o.store,
        userId: user.id,
        requested: o.requested?.(c) ?? null,
        preferred: o.preferred?.(c) ?? null,
        ...(o.pickDefault ? { pickDefault: o.pickDefault } : {}),
      });
    } catch (e) {
      const res = tenantErrorResponse(c, e);
      if (res) return res;
      throw e;
    }
    if (active.fellBack) await o.onFellBack?.(c, active);
    c.set(TENANT_KEY as never, active as never);
    await next();
  };
}

/**
 * RBAC for one route: the active membership's role must be allowed `action`
 * by the app's policy. 403 JSON after the policy's onDenied (the audit hook).
 * Must run after tenantMiddleware — without it the route is refused, never
 * opened (fail closed).
 */
export function requireCapability<Action extends string>(policy: Policy<Action>, action: Action): MiddlewareHandler {
  return async (c, next) => {
    const active = getTenant(c);
    if (!active) return c.json({ error: "no_tenant_context" }, 500);
    try {
      await policy.assert(active.membership, action, { tenantId: active.tenant.id, userId: active.membership.userId });
    } catch (e) {
      const res = tenantErrorResponse(c, e);
      if (res) return res;
      throw e;
    }
    await next();
  };
}

export interface TenantRoutesOptions<Action extends string> {
  store: TenantStore;
  user: UserFn;
  /** The roles an invitation may grant (never owner or platform unless you list it). */
  invitableRoles: readonly string[];
  /**
   * Inviting needs the active tenant (put tenantMiddleware before this app's
   * /invites route), this action in the policy, AND a way to deliver the link.
   * Without `deliverInvite` the route is not mounted: the token never travels
   * back to the inviter's browser.
   */
  invite?: {
    policy: Policy<Action>;
    action: Action;
    deliverInvite: (msg: { to: string; token: string; tenant: Tenant; role: string; invitedBy: string }) => Promise<void>;
  };
}

/**
 * JSON routes for the membership surface:
 *   GET  /memberships      → [{ tenant: {id, slug, name, status}, role }] for the signed-in user
 *   POST /invites/accept   {token} → { tenant, role }
 *   POST /invites          {email, role} → { inviteId }   (only with `invite`, needs tenantMiddleware)
 */
export function tenantRoutes<Action extends string>(o: TenantRoutesOptions<Action>) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });
  // A write from ANOTHER site is refused. SameSite=Lax stops a foreign domain
  // but not a sibling subdomain (same site). Browsers send Sec-Fetch-Site on
  // every request; a non-browser caller sends none and is let through. Same
  // guard as @broberg/sso's accountRoutes.
  app.use("*", async (c, next) => {
    const site = c.req.header("sec-fetch-site");
    if (c.req.method !== "GET" && site !== undefined && site !== "same-origin" && site !== "none") {
      return c.json({ error: "cross_site" }, 403);
    }
    await next();
  });

  app.get("/memberships", async (c) => {
    const user = await o.user(c);
    if (!user) return c.json({ error: "unauthenticated" }, 401);
    const out: { tenant: Pick<Tenant, "id" | "slug" | "name" | "status">; role: string }[] = [];
    for (const m of await o.store.membershipsOf(user.id)) {
      const t = await o.store.tenantById(m.tenantId);
      if (t) out.push({ tenant: { id: t.id, slug: t.slug, name: t.name, ...(t.status ? { status: t.status } : {}) }, role: m.role });
    }
    return c.json(out);
  });

  app.post("/invites/accept", async (c) => {
    const user = await o.user(c);
    if (!user) return c.json({ error: "unauthenticated" }, 401);
    const body = (await c.req.json().catch(() => null)) as { token?: unknown } | null;
    if (typeof body?.token !== "string" || body.token === "") return c.json({ error: "invalid_request" }, 400);
    try {
      const m: Membership = await acceptInvite({ store: o.store, token: body.token, user, invitableRoles: o.invitableRoles });
      const t = await o.store.tenantById(m.tenantId);
      return c.json({ tenant: t ? { id: t.id, slug: t.slug, name: t.name } : { id: m.tenantId }, role: m.role });
    } catch (e) {
      const res = tenantErrorResponse(c, e);
      if (res) return res;
      throw e;
    }
  });

  if (o.invite) {
    const inv = o.invite;
    app.post("/invites", requireCapability(inv.policy, inv.action), async (c) => {
      const active = getTenant(c)!;
      const body = (await c.req.json().catch(() => null)) as { email?: unknown; role?: unknown } | null;
      if (typeof body?.email !== "string" || !body.email.includes("@") || typeof body.role !== "string") {
        return c.json({ error: "invalid_request" }, 400);
      }
      try {
        const { invite, token } = await createInvite({
          store: o.store,
          tenantId: active.tenant.id,
          email: body.email,
          role: body.role,
          invitableRoles: o.invitableRoles,
          invitedBy: active.membership.userId,
        });
        await inv.deliverInvite({ to: invite.email, token, tenant: active.tenant, role: invite.role, invitedBy: active.membership.userId });
        return c.json({ inviteId: invite.id }, 201);
      } catch (e) {
        const res = tenantErrorResponse(c, e);
        if (res) return res;
        throw e;
      }
    });
  }

  return app;
}
