# F029 — @broberg/tenant: organisations, memberships and invitations, the same way in every app

> Epic · runtime package (headless core + Hono adapter) + switcher in app-shell · effort M · status: **revised 6 Oct 2026 after the survey F029.7, awaiting Christian's decision before code**

## Summary
Six apps each handle «which organisation am I in, with what role, and who may join» in their own way, and four of them get the same thing wrong: they silently pick an organisation the user did not ask for. `@broberg/tenant` gives every app the same strict rules for memberships, choosing the active organisation and invitations, while each app keeps its data in its own database however it likes. Organisations are never stored in Broberg ID.

## Motivation
Christian, 6 Oct 2026: «Burde vi have et modul til Tenant styring … er der nogle fordele ved at have et /tenant npm modul?» He also decided (D-5345a2) that organisations and memberships do **not** live in Broberg ID.

The survey F029.7 read the code in xrt81, cms, cardmem, trail and helpdesk, plus Scout's plan (table in `F029.7-tenant-survey.md`). Four findings decide the design:
1. **Six implementations, and none of them is shared.** Scout is about to write the seventh.
2. **The part that repeats is the part with the bugs.** Choosing the active organisation falls back silently to «the first membership» in cardmem and trail, cms falls back to the first site, and xrt81 looks members up by email without an organisation. Only helpdesk refuses hard.
3. **Data isolation does NOT repeat:** shared DB with `tenant_id` (3), a DB per organisation (trail, Scout), a directory per site (cms). The package must not choose it.
4. **Role names do not repeat** (owner/admin/member, owner/operator/viewer, admin/editor/viewer), but the shape (user, organisation, role) does.

## What changed against the June plan, and why

The June plan was written from cms alone: a `registry.json`, an engine pool keyed by `orgId:siteId`, `mergeConfigs` inheritance, trail's key-index, a Next adapter, and pilots in cms and trail. The survey shows that those are **cms' and trail's isolation choices, not the fleet's common pattern**. A shared pool would force one isolation model on Scout (Postgres per org) and the three shared-DB apps alike. Stories F029.1–.6 are therefore archived (reasons on each card), and the June text lives in git history (`git log -- docs/features/F029-multi-tenant.md`).

## Solution
A small headless package with storage through an adapter, the same pattern as sso's `TokenStore`:

```ts
interface TenantStore {              // the app implements it against its own DB
  tenantBySlug(slug: string): Promise<Tenant | null>;
  membershipsOf(userId: string): Promise<Membership[]>;      // across tenants
  addMembership(m: Membership): Promise<void>;
  // invitations
  saveInvite(i: StoredInvite): Promise<void>;                // tokenHash, never the token
  inviteByTokenHash(hash: string): Promise<StoredInvite | null>;
  markInviteUsed(id: string, at: number): Promise<boolean>;  // false = already used (single use)
}
```

- **`resolveActiveTenant({ requested?, preferred?, memberships })`** has two inputs with two rules. trail's argument (#1976, 6/10) made this precise:
  - **`requested`** is an explicit choice for THIS request (path slug, header). It is **strict**: if it is not one of the user's memberships, the call throws `TenantNotMember` / `TenantNotFound` / `TenantSuspended`. Otherwise the answer would be shown under the wrong organisation's name.
  - **`preferred`** is a standing preference (cookie, `users.active_org_id`). It goes stale for innocent reasons (a membership is revoked, a tenant is deleted), and a hard refusal there locks the user out of her own system. So it **falls back, but only within the user's own memberships, and never silently**: the result carries `{ tenant, fellBack: true, reason }`, so the app can clear the stale preference and the UI can say which organisation is active. Its fallback order comes from the app (e.g. the most recently used), never «the first row without ORDER BY».
  - **Never another tenant than one of the user's own**, in either mode.
- **Invitations:** `createInvite(tenant, email, role)` → token (only its hash is stored), expiry, single use. `acceptInvite(token, user)` requires the signed-in email to match (case-insensitive), is idempotent, and can never grant a role outside the app's `invitableRoles` (helpdesk's «cannot escalate to the platform»).
- **Capabilities:** `can(role, action)` from a matrix the app supplies, plus an `onDenied` audit hook (cardmem's pattern).
- **Hono adapter (`/hono`):** `tenantMiddleware({ store, from })` sets `c.var.tenant` and `c.var.membership` and answers with JSON 401/403/404, never a redirect.
- **UI:** `TenantSwitcher` in `@broberg/app-shell`, which shows only the user's memberships and switches through the app's own route.

## Reuse
- **Identity:** `@broberg/sso` (who the user is). Organisations stay in the app's DB (D-5345a2).
- **Storage:** the app's own (shared SQLite/libSQL, `@broberg/db-sdk` Postgres per org, anything else) via `TenantStore`. Discovery search for «tenant» on 6/10 found nothing shipped, only F029 itself.
- **Invitation mail:** `@broberg/mail` in the app, not in the package (the package returns the link).
- **Switcher UI:** `@broberg/app-shell`.

## Design
The switcher belongs in the user menu in app-shell and is designed in its own story (design consult then). The rest of the epic has no visual surface.

## Scope

### In scope
- `packages/tenant` → `@broberg/tenant`: types, `TenantStore`, `resolveActiveTenant`, invitations, `can`, named errors, `memoryTenantStore()` for tests.
- `@broberg/tenant/hono`: `tenantMiddleware`, plus JSON routes for invitation accept and the list of my memberships.
- `TenantSwitcher` in `@broberg/app-shell`.

### Out of scope
- **Data isolation** (shared DB, DB per org, pool): the app's own. The package never opens a tenant DB.
- **Plans, limits, billing:** stored in four apps and enforced in none, so there is no common pattern to lift.
- **Levels under the organisation** (site, project, unit): the app's own.
- **Migrating existing apps:** each app's own decision, after a pilot.
- **Organisations in Broberg ID:** D-5345a2.

## Stories
- **F029.7** — Survey before code (done).
- **F029.8** — Core: types, TenantStore, strict resolver, invitations, `can`, memoryTenantStore.
- **F029.9** — Hono adapter: tenantMiddleware and invitation/membership routes with JSON refusals.
- **F029.10** — TenantSwitcher in app-shell.
- **F029.11** — Pilot in ONE app (chosen by Christian) with its own adapter, plus a release report.

## Acceptance criteria
1. `resolveActiveTenant`: a `requested` organisation without membership → a named error; a stale `preferred` → one of the user's own memberships with `fellBack: true`; never a tenant outside the user's memberships. Measured in vitest with negative controls (a member of A requests B → refused; prefers B → A + fellBack; requests A → A).
2. An invitation token is stored only as a hash, works once, expires, requires a matching email, and cannot grant a role outside `invitableRoles`. Measured in vitest on the store (read back), mutation-checked.
3. The package runs against two different isolation models without changes: a shared DB with `tenant_id` and a DB per organisation. Measured in vitest with two `TenantStore` implementations.
4. In the pilot app, a user who is a member of two organisations switches with the switcher, and a request for an organisation without membership is refused. Measured by Lens on the pilot's deployed build.

## Dependencies
- D-5345a2 (organisations are not in BID).
- `@broberg/sso` for identity.

## Rollout
New package, opt-in per app, no impact on anyone until an app adopts it. The pilot app migrates its own data to its `TenantStore`; other apps follow only on Christian's word (D-5f65b6).

## Open Questions
None. Christian decided on 6–7/10:
1. **Pilot app: appkit-demo** (appkit-lean-demo). It is the template new apps are built from, so the package reaches every future app, and appkit already runs our Lens proofs. To check: the demo needs at least two organisations per test user before the switch can be proven.
2. **Home: components** (`packages/tenant` → `@broberg/tenant`), not its own repo.

## Effort estimate
**M**: F029.8 about a day, F029.9 half a day, F029.10 half a day, the pilot depends on the app.
