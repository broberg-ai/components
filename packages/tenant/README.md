# @broberg/tenant

Organisations, memberships, invitations and role checks, the same way in every app.

**The storage is yours.** You implement `TenantStore` against your own database, in whatever shape it is: one shared DB with a `tenant_id`, a DB per organisation, or units below the organisation. The package never opens a tenant database, and it never decides how tenant data is isolated. Organisations never live in Broberg ID: BID says who the user is, and your app says which organisations she belongs to (D-5345a2).

Why it exists: six apps in the fleet each built their own (survey F029.7), and four of them choose the active organisation by silently falling back to «the first membership». This package refuses to.

## Choosing the active tenant

```ts
import { resolveActiveTenant } from "@broberg/tenant";

const active = await resolveActiveTenant({
  store, userId,
  requested: c.req.param("tenant"),   // explicit, for THIS request → strict
  preferred: cookie("active-tenant"), // a standing preference → may fall back
  pickDefault: (usable) => mostRecentlyUsed(usable), // your rule when nothing says which
});
// → { tenant, membership, fellBack, reason? }
if (active.fellBack) clearCookie("active-tenant"); // the preference was stale
```

| input | when it cannot be used |
|---|---|
| `requested` (path, header) | **throws**: `TenantNotFound`, `TenantNotMember` or `TenantSuspended`. A bad request is never quietly answered for another tenant. |
| `preferred` (cookie, stored choice) | **falls back** to one of the user's OWN memberships, with `fellBack: true` and `reason`. A stale cookie must not lock a user out of her own system (trail's pattern). |
| neither, several memberships | `pickDefault` decides. Without it the call throws `TenantChoiceRequired`; it never picks «the first row». |

In every mode, the result is one of the user's own memberships. A suspended tenant is never returned.

## Invitations

```ts
import { createInvite, acceptInvite } from "@broberg/tenant";

const { token } = await createInvite({ store, tenantId, email, role: "member", invitableRoles: ["member", "admin"], invitedBy });
// mail `${origin}/invite/${token}` with @broberg/mail. The token is returned ONCE.

const membership = await acceptInvite({ store, token, user: { id, email }, invitableRoles: ["member", "admin"] });
```

- **Only the token's SHA-256 is stored**, so a leaked database does not leak working invitations.
- **Single use.** Of two accepts racing on one token, exactly one wins. Your store's `markInviteUsed` must be atomic, for example `UPDATE … SET used_at = ? WHERE id = ? AND used_at IS NULL` and then check the rowcount.
- **The signed-in email must match** the invitation (case-insensitive).
- **Expires** after 7 days by default (`ttlMs`).
- **Cannot escalate.** A role outside `invitableRoles` is refused when the invitation is created and again when it is accepted.
- Accepting again as the same user is safe and returns the same membership, so a half-finished earlier accept is repaired.

Refusals are `InviteRefused` with `reason`: `not_found`, `expired`, `revoked`, `used`, `email_mismatch` or `role_not_invitable`.

## Role checks (RBAC)

```ts
import { createPolicy } from "@broberg/tenant";

const policy = createPolicy({
  roles: { owner: ["*"], admin: ["team:manage", "project:create"], member: ["project:read"] },
  onDenied: ({ role, action, context }) => audit("permission_denied", { role, action, context }),
});
policy.can(membership.role, "team:manage");        // boolean
await policy.assert(membership, "team:manage", ctx); // throws TenantForbidden after onDenied
```

Deny by default: a role or action that is not listed is refused. The roles are your own vocabulary.

## TenantStore

```ts
interface TenantStore {
  tenantById(id): Promise<Tenant | null>;
  tenantBySlug(slug): Promise<Tenant | null>;
  membershipsOf(userId): Promise<Membership[]>;   // across tenants; derive it if members belong to units
  addMembership(m): Promise<void>;                // idempotent
  saveInvite(invite): Promise<void>;              // insert or replace by id
  inviteByTokenHash(hash): Promise<StoredInvite | null>;
  markInviteUsed(id, at, userId): Promise<boolean>; // ATOMIC: true only for the call that claimed it
}
```

`memoryTenantStore()` is the reference implementation, for tests and one dev process. The test suite runs the same checks against three stores: a shared DB with `tenant_id`, a DB per tenant, and units with a derived organisation membership.

## Not in this package

- **How tenant data is isolated**: that is your app's decision.
- **Plans, limits, billing**: these are specific to each product.
- **Levels below the organisation** (site, project, unit): yours. Your store derives the organisation-level membership from them.
