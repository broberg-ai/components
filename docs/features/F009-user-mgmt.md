# F009 — User Management + Invitation

> L1 Identity · hybrid · effort **M** · impact **high** · owner `cms`. Status: Backlog.
> Graduate-candidate: no — stays in `components`.

## Motivation
A headless engine owning the full user lifecycle: create/lookup/update/delete user records; generate + validate invitation tokens (email + role + TTL); enforce a last-admin guard; and expose a role-permission matrix with wildcard resolution (e.g. media.*). Every app re-implements this with only the persistence layer varying (JSON in cms, SQLite/Drizzle in sanneandersen/trail/pitch, Supabase in fysiodk). The package collapses the duplication into one testable core while each stack wires its own DB adapter + email sender. UI surfaces (invite form, user list, role-edit) are copy-owned shells over the core API.

## Solution
**hybrid.** The business logic (token gen, expiry, last-admin guard, role→permission resolution, duplicate-invite check, cross-org guard) is identical across cms (auth/invitations/team/permissions), sanneandersen (invite route + db), trail (invite/auth), pitch (queries) — >=3 repos, identical → runtime-package. Persistence (JSON/SQLite-Drizzle/Supabase/bun:sqlite) and email transport differ per repo. The React invite-form + user-list UI is project-specific → copy-owned. So: headless core (package) + copy-owned UI shells = hybrid.

## Scope

### In scope
- Extract from `webhouse/cms` `packages/cms-admin/src/lib/{auth,invitations,team,permissions-shared,permissions}.ts`.
- Headless core + UserStore/InvitationStore adapter contracts + Next/Hono guards + Resend email adapter + copy-owned InviteForm scaffold.

### Out of scope
- Per-repo role vocabulary / persistence schema.
- Project-specific invite UI styling (copy-owned).

## Architecture

### Best source (reference implementation)
`webhouse/cms` — `packages/cms-admin/src/lib/{auth,invitations,team,permissions-shared,permissions}.ts`. Most complete: user CRUD, strict/lenient file-read guard, invitation create/validate/accept/revoke with cross-site token search, site-scoped team membership separate from global users, role enum, fine-grained permission catalogue + wildcard, last-admin guard on delete AND demote, clean client-safe vs server-only permission split.

### Other implementations seen (contract cross-check)
- `webhouse/sanneandersen` `site/src/app/api/admin/users/invite/route.ts` + `lib/auth/db.ts` + `[locale]/admin/users/invite/invite-form.tsx` — complete invite route (audit, 409 guard, 24h TTL, dev-URL) + canonical invite-form UI (data-testid, CustomSelect, busy/error/success, locale).
- `broberg/trail` `apps/admin-server/src/invite.ts` + `auth.ts` + `packages/db/src/schema.ts` — cross-org guard, re-invite upsert, lazy-expire status enum; cleanest Hono-native (Stack B reference).
- `cbroberg/pitch` `lib/db/queries/user-invitations.ts` — minimal Drizzle query contract (the persistence adapter shape).
- `webhouse/fysiodk-aalborg-sport` `apps/web/src/app/api/admin/invite/route.ts` — Supabase inviteUserByEmail + in-memory rate limiter + rollback.

### Headless core vs. adapters
- **Core (no React/next/Hono):** UserRole; Permission catalogue + ROLE_PERMISSIONS + hasPermission (wildcard, from cms permissions-shared.ts); createUser/updateUser/deleteUser/getUserById/getUserByEmail with last-admin guard; hashPassword/verifyPassword (bcrypt); createToken/verifyToken (jose HS256 7d); Invitation lifecycle (create dedup+TTL+32-byte token / validate / markAccepted / revoke / list); TeamMember add/updateRole/remove with last-admin guard. Persistence injected via UserStore + InvitationStore; email via sendInviteEmail callback (core never imports a mailer).
- **Stack A (Next.js):** requireAuth/requireAdmin/requirePermission (next/headers + cookies); getSessionUser; RSC user-list + client InviteForm (copy-owned, sanneandersen pattern); Resend email adapter; DrizzleUserStore.
- **Stack B (Hono):** auth middleware (hono/cookie); inviteRoutes + authRoutes slices (trail pattern); Preact invite island; Resend via fetch; DrizzleUserStore over bun:sqlite.

### Public API
```ts
export { PERMISSIONS, ROLE_PERMISSIONS, hasPermission, resolvePermissions };
export { createUser, updateUser, deleteUser, getUserById, getUserByEmail, getUsers };
export { hashPassword, verifyPassword, createToken, verifyToken };
export { createInvitation, validateToken, markAccepted, revokeInvitation, listInvitations };
export { addTeamMember, updateTeamMemberRole, removeTeamMember };
export type { UserStore, InvitationStore, SendInviteEmailFn };
// '@broberg/user-mgmt/next' → requireAuth/requireAdmin/requirePermission/getSessionUser
// '@broberg/user-mgmt/hono' → authRoutes/inviteRoutes/sessionMiddleware
```

## Stories
- **F009.1** — Extract headless core + tests — _AC:_ exports all types + CRUD with last-admin guard + bcrypt + jose tokens + hasPermission + full invitation lifecycle; tests: last-admin guard throws on delete+demote, duplicate-invite errors, expired token null, wildcard media.* grants media.upload; zero framework imports.
- **F009.2** — DrizzleUserStore adapter + pilot in cms — _AC:_ DrizzleUserStore<TSchema> implements UserStore+InvitationStore (any dialect); cms replaces fs-based auth/invitations with the package; all admin flows pass; JSON-file fallback store ships for cms file mode.
- **F009.3** — Next.js adapter: requirePermission + getSessionUser — _AC:_ requirePermission accepts Bearer token then falls back to session+ROLE_PERMISSIONS; getSessionUser returns SessionPayload|null; requireAdmin/requireAuth wrappers; tested with mocked next/headers.
- **F009.4** — Hono adapter + invite routes — _AC:_ authRoutes (magic-link/verify/me/logout) + inviteRoutes (cross-org guard + upsert, lazy-expire list, delete); trail adopts; its invite+auth flows pass.
- **F009.5** — Copy-owned InviteForm scaffold (Stack A) — _AC:_ scaffold InviteForm: CustomSelect role (no native <select>), email+name, POST to invite route, busy/error/success with visible feedback, data-testid on every interactive element, locale prop. Matches sanneandersen invite-form.tsx.
- **F009.6** — Resend email adapter — _AC:_ sendInviteEmail (in package, not core) accepts {to, magicUrl, role, inviterName, locale}; dev mode returns devUrl; swap-in via the createInvitation callback.

## Acceptance criteria
1. @broberg/user-mgmt builds + typechecks clean; headless core imports no framework packages.
2. Each story (F009.1–F009.6) meets its own AC.
3. Piloted in cms and adopted back with no regression (runtime-verified).
4. A second consumer (sanneandersen or trail) migrates onto the shared package with identical behaviour.

## Dependencies
- F005 — Mail (related). F008 — OAuth (related).
- External: bcryptjs, jose, drizzle-orm (peer, adapter only).

## Rollout
Strangler: 1) extract core from cms lib (tests first); 2) wire cms (JSON UserStore) pilot; 3) DrizzleUserStore, pilot sanneandersen (SQLite); 4) validate trail (Hono); 5) spread to pitch, fysiodk (Supabase). Never big-bang.

Graduate-candidate: no — stays in `components`.

## Open Questions
- TeamMember (site-scoped) in this package or a separate @broberg/team-membership?
- Canonical role vocab? Ship generic string role + configurable ROLE_PERMISSIONS (repos differ: admin/editor/viewer vs owner/curator/reader vs ...).
- Invitation TTL configurable per call-site (24h vs 7d) or fixed?
- Supabase adapter: thin InvitationStore wrapper around Supabase Auth, or keep fysiodk's native flow + adopt only role/permission core?

## Effort estimate
**M** — owner session: `cms`. Reuse model: hybrid.

## Risks
(1) UserStore must be fully async even when backing store is sync (bun:sqlite) to avoid a leaky abstraction. (2) cms multi-site token-search is JSON-registry-specific — stays in the cms adapter, must not bleed into core. (3) last-admin guard exists in both auth.ts + team.ts in cms — consolidate to one fn without dropping either check. (4) bcryptjs blocks the Bun event loop — evaluate Bun.password in the Stack B adapter.
