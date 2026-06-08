# F029 — Multi-Tenant Management

> L4 Capstone · hybrid · effort **L** · impact **high** · owner `cms`. Status: Backlog.
> Graduate-candidate: YES — should get its own repo + cardmem project (recommendation, confirm with Christian).

## Motivation
A headless library providing the canonical data model, resolution logic, and lifecycle operations for multi-tenant apps across the estate. Core: the three-level hierarchy (platform→org→tenant/site), the active-tenant resolution chain (request-scoped override > cookie > env default > registry default), and a lazy-loaded TTL-cached instance pool routing every authenticated op to the correct tenant context without cross-tenant leakage. Also: org-level settings inheritance (cascade down to sites with a strict NEVER_INHERIT guard), a serial write-lock for safe registry mutations, and a global key-index sidecar mapping bearer/session to tenant slugs before any per-tenant DB opens.

## Solution
**hybrid.** The core resolution logic + data model appear in 4+ repos (cms site-registry/site-pool, trail tenant-pool/key-index, xrt81 tenants schema, cardmem orgs) in structurally similar but divergent form. The pure logic (Registry type, findSite/findOrg, mergeConfigs inheritance, pool get-or-create, key-index resolve) is identical enough to share → runtime package. The UI (org/site switchers) is framework-specific → copy-owned. The DB schema DDL is copy-owned (xrt81 adds themeColor/visionModel/BYOK; cardmem adds plan/githubOrgName). So: headless engine (package) + schema/UI copy-owned scaffolds.

## Scope

### In scope
- Extract from `webhouse/cms` `packages/cms-admin/src/lib/{site-registry,site-pool,org-settings,site-paths}.ts`.
- Headless core (Registry types + loadRegistry/mutations + TenantPool + mergeConfigs + KeyIndex + resolveTenantContext + getAdminDataDir) + Next + Hono adapters.

### Out of scope
- App-specific tenant DB schema (each app owns its Drizzle schema).
- Per-brand switcher UI styling.

## Architecture

### Best source (reference implementation)
`webhouse/cms` — `packages/cms-admin/src/lib/`: site-registry.ts (Registry/OrgEntry/SiteEntry types, load/save with serial write-lock _writeLock chain, atomic deep-clone mutations, findSite/findOrg/getDefaultSite, bootstrapRegistryFromEnv, single/multi-site detection); site-pool.ts (lazy Map<orgId:siteId,CmsInstance> with prod-forever/dev-TTL tiers, absolutizeConfigPaths chdir-race guard, formatSiteError Zod-aware); org-settings.ts (3-level mergeConfigs + INHERITABLE_FIELDS/NEVER_INHERIT + detectMigratableFields); site-paths.ts (resolution precedence + EmptyOrgError cross-org leak guard).

### Other implementations seen
- Cross-checks (structurally similar, divergent): trail tenant-pool.ts + key-index.ts (slug-keyed file discovery), xrt81 tenants schema + auth scoping (themeColor/visionModel/BYOK), cardmem orgs schema (plan/githubOrgName). cms is the most complete + battle-tested source.

### Headless core vs. adapters
- **Core (no React/next):** Registry/OrgEntry/SiteEntry/OrgSettings types + Zod schemas; loadRegistry/saveRegistry (serial write-lock); findSite/findOrg/getDefaultSite/addOrg/addSite/updateSite/removeSite/moveSite; TenantPool (Map-backed lazy get-or-create, TTL tiers, invalidate); mergeConfigs (INHERITABLE_FIELDS/NEVER_INHERIT); KeyIndex (resolveBearer/resolveSession/addBearer/addSession/revoke via a driver-agnostic {run,query} shim); resolveTenantContext({cookie?,bearer?,override?}); getAdminDataDir (WEBHOUSE_DATA_DIR > /data > XDG > $HOME chain).
- **Stack A (Next):** reads cookies() from next/headers in resolveTenantContext; invalidateActiveSite(); OrgSwitcher + SiteSwitcher RSCs (read registry via server action, write active-org/active-site cookies); EmptyOrgError boundary. No pool/registry logic here.
- **Stack B (Hono):** tenantMiddleware (reads Bearer/session cookie → KeyIndex.resolve → c.set('tenantSlug')); pool adapter takes a createDb(slug) factory; KeyIndex driver shim uses bun:sqlite. No next/*.

### Public API
```ts
export type { Registry, OrgEntry, SiteEntry, OrgSettings, TenantRef, TenantPool };
export { loadRegistry, saveRegistry, findSite, findOrg, getDefaultSite, addOrg, addSite, updateSite, removeSite, moveSite, bootstrapRegistryFromEnv };
export { createTenantPool, mergeConfigs, INHERITABLE_FIELDS, NEVER_INHERIT, createKeyIndex, resolveTenantContext, getAdminDataDir };
// '@broberg/multi-tenant/next' → invalidateActiveSite, getActiveTenantRef, OrgSwitcher, SiteSwitcher ; '/hono' → tenantMiddleware
```

## Stories
- **F029.1** — Headless core: Registry, pool, mergeConfigs — _AC:_ loadRegistry/saveRegistry serial write-lock, findSite/findOrg/getDefaultSite, add/update/remove/moveSite, createTenantPool (TTL tiers, invalidate), mergeConfigs (INHERITABLE/NEVER_INHERIT), getAdminDataDir; zero framework imports; tests: concurrent saveRegistry serialize; deep-clone on addSite prevents ghost entries on write failure; empty-string site values don't override inheritable org values; pool re-creates after TTL.
- **F029.2** — KeyIndex — driver-agnostic bearer/session routing — _AC:_ createKeyIndex(driver:{run,query}); resolveBearer → {tenantSlug,userId}|null for revoked/missing; resolveSession honours expires_at; addBearer/addSession idempotent (INSERT OR REPLACE); tests: unknown/revoked/expired → null; idempotent upsert no throw.
- **F029.3** — Next.js adapter — cookies-based active-tenant resolution — _AC:_ resolveTenantContext() reads override > cms-active-org/site cookies > registry default; invalidateActiveSite(); OrgSwitcher + SiteSwitcher RSCs write cookies + revalidate path; EmptyOrgError when active org has no sites (not another org's first); no bun:sqlite/Hono imports.
- **F029.4** — Hono adapter — tenantMiddleware + bun:sqlite KeyIndex driver — _AC:_ tenantMiddleware(pool, keyIndex) reads Bearer then session cookie; resolve; sets c.set('tenantSlug') + c.set('tenantDb', pool.get(slug)); 401 on missing/revoked + unknown slug (no cross-tenant fallback); tests cover all four error paths.
- **F029.5** — Pilot adoption in cms (Next.js) — _AC:_ cms removes site-registry/site-pool/org-settings/site-paths.ts + imports from the package + /next; all existing routes + admin UI pass their suite unchanged; no browser-observable delta (Lens smoke).
- **F029.6** — Pilot adoption in trail (Hono/Bun) — _AC:_ trail removes tenant-pool.ts + key-index.ts, wires /hono tenantMiddleware with the bun:sqlite KeyIndex driver; TRAIL_MULTI_TENANT=1 preserved (boot-time slug discovery, secondary DB boot); integration test: token from tenant-A against tenant-B → no cross-tenant response.

## Acceptance criteria
1. @broberg/multi-tenant builds + typechecks clean; headless core imports no framework packages.
2. Each story (F029.1–F029.6) meets its own AC.
3. Piloted in cms and adopted back with no regression (Lens / runtime-verified).
4. A second consumer (trail) migrates onto the shared package with identical behaviour.

## Dependencies
- F009 — User mgmt (blocks). External: @broberg/db-sdk (KeyIndex driver interface).

## Rollout
Strangler: 1) extract headless core from cms site-* into @broberg/multi-tenant; 2) unit tests (write-lock, mergeConfigs, pool TTL, EmptyOrgError, KeyIndex); 3) wire the Next adapter back into cms (byte-for-byte API); 4) Hono adapter, pilot trail (replace tenant-pool + key-index); 5) adopt xrt81; 6) spread to cardmem + cpm orgs. Then GRADUATE to own repo+project.

Graduate-candidate: YES — should get its own repo + cardmem project (recommendation, confirm with Christian).

## Open Questions
- registry.json schema_version field for non-breaking additions (cms + trail write unversioned today)?
- trail uses slug-keyed dirs not registry.json — support both discovery modes or migrate trail?
- INHERITABLE_FIELDS is cms-specific — generic mergeConfigs (caller passes allowlist) or a cms subtype?
- xrt81 AES-256-GCM BYOK keys stay in app schema — include the secret-redaction pattern (clearRedactedSecrets/ORG_SETTINGS_SECRET_FIELDS) in the shared merge so secrets aren't inherited in plaintext?

## Effort estimate
**L** — owner session: `cms`. Reuse model: hybrid.

## Risks
Key divergence: each tenant table has app-specific columns — the core must own only the in-memory Registry + registry.json, NOT the DB schema (adopters own their Drizzle schema), else it becomes a leaky monolith. The chdir-race guard (absolutizeConfigPaths) is cms-filesystem-specific — stays in the cms adapter. The serial write-lock (_writeLock chain) must be preserved exactly — a naive async/await reintroduces the ghost-sites race seen in prod. registry.json is unversioned today — a field rename in the shared type is a silent breaking change; consider a schema_version field.