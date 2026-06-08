# F011 — Event Log (GDPR + Activity Log)

> L1 Identity · hybrid · effort **M** · impact **high** · owner `cms`. Status: Backlog.
> LEAP-candidate: no — stays in `components`.

## Motivation
A headless, append-only event log with three functional layers — audit (GDPR-grade who-did-what-when), activity (operational events, agent/pipeline actors), and server (errors, deploys, schedulers). All writes are fire-and-forget and never throw; the log must never block the caller. The core provides typed LogEntry/LogActor/LogTarget, retention metadata, GDPR export (structured JSON) + anonymisation primitives (Art. 17 stk. 3 lit. b), and IP hashing for pseudonymisation. Adapters wire the core to JSONL / SQLite-Drizzle / Supabase; a separate UI package delivers a filterable admin table.

## Solution
**hybrid.** The write-side contract (LogEntry shape, fire-and-forget, IP hashing, GDPR export payload) is identical across 5+ repos (cms event-log.ts, sanneandersen audit.ts, trail activity.ts, fysiodk audit.ts, senti-object-store activity/core.ts) — the schema (id, timestamp, actor{type,userId,ipHash}, action, target?, details JSON) recurs verbatim → runtime-package core. Persistence differs (JSONL / Drizzle / Supabase RLS) and the admin UI is stack-specific → thin adapters + copy-owned UI = hybrid.

## Scope

### In scope
- Extract from `webhouse/cms` `packages/cms-admin/src/lib/event-log.ts`.
- Core + LogStore interface + JSONL/SQLite/Supabase adapters + shadcn EventLogTable UI + GDPR export/anonymise.

### Out of scope
- Per-repo closed AuditEventKind unions (domain-local).
- Per-repo Supabase migrations / RLS policy management.

## Architecture

### Best source (reference implementation)
`webhouse/cms` — `packages/cms-admin/src/lib/event-log.ts`: all three layers, typed LogEntry/Actor/Target, fire-and-forget logEvent(), convenience helpers (logLogin/logDocumentCreated/logRoleChanged/logExport), paginated readLog() with all filters, logStats(), rotateLog(), hashIp(). Covers ~90% of the core.

### Other implementations seen
- `broberg/trail` `packages/core/src/activity.ts` + `packages/db/src/schema.ts` — best multi-actor model (llm/pipeline actor kinds), tenantId + knowledgeBaseId scope, open-text kind (cheap migrations).
- `webhouse/sanneandersen` `site/src/lib/eir/audit.ts` + `lib/auth/gdpr.ts` — fail-soft logAuditEvent, 40+ typed closed AuditEventKind, full Art. 17 delete (anonymise + hard-delete PII, transactional) + structured export payload.
- `webhouse/senti-object-store` `src/lib/activity/core.ts` + `components/activity-logs/ActivityLogsTable.tsx` — best admin UI (sortable, tab-filter, paginator, search-spinner) + logBatchActivity().
- `webhouse/fysiodk-aalborg-sport` `apps/web/src/lib/audit.ts` — dual-path: client RLS-guarded INSERT + service-role server writes.

### Headless core vs. adapters
- **Core (no framework/DB):** types (LogLayer/Level/Entry/Actor/Target, open AuditEventKind, ActivityActorKind user|llm|system|pipeline, ReadOptions, ExportPayload, DeleteResult); makeLogEntry; retention config; GDPR helpers (hashIp, anonymizeContact, buildExportPayload); filterEntries; LogStore interface (append/query/stats/rotate?); fire-and-forget convenience wrappers (logLogin/logout/loginFailed/document*/roleChanged/export/agentRan/serverError) — all take a LogStore, never throw.
- **Stack A (Next/Supabase):** event-log-supabase: LogStore over supabase insert; client-adapter (auth.getUser, RLS) + server-adapter (service role); useEventLog() hook; EventLogTable (shadcn Table+Tabs+Input, no native selects).
- **Stack B (Bun/Hono/SQLite):** event-log-sqlite: LogStore over Drizzle bun:sqlite (trail activityLog schema); rotateLog by MAX_AGE_DAYS; Hono logRequestActivity(ctx) middleware. Companion event-log-jsonl for cms.

### Public API
```ts
export type { LogLayer, LogLevel, LogEntry, LogActor, LogTarget, ReadOptions, LogStats, ExportPayload, DeleteResult, ActivityActorKind };
export { makeLogEntry, hashIp, anonymizeContact, filterEntries, buildExportPayload };
export type { LogStore };
export { logLogin, logLogout, logLoginFailed, logDocumentCreated, logDocumentUpdated, logDocumentPublished, logDocumentDeleted, logRoleChanged, logExport, logAgentRan, serverError };
// '@broberg/event-log-sqlite' → SqliteLogStore, logRequestActivity
// '@broberg/event-log-supabase' → SupabaseLogStore, useEventLog
// '@broberg/event-log-ui' → EventLogTable
```

## Stories
- **F011.1** — Extract headless core package — _AC:_ exports types + LogStore + makeLogEntry + hashIp + anonymizeContact + filterEntries + buildExportPayload + convenience helpers; zero framework/DB imports; tests: makeLogEntry fills id+timestamp, hashIp 8-char hex, filterEntries by layer/userId/since/action-prefix; cms compiles with the package replacing inline types.
- **F011.2** — SQLite/Drizzle adapter (Stack B) — _AC:_ SqliteLogStore over bun:sqlite; schema exported; rotateLog prunes by MAX_AGE_DAYS; Hono logRequestActivity auto-fills actor from ctx.var.user; trail logActivity replaced; trail tests pass; activity feed unregressed.
- **F011.3** — JSONL adapter (cms use case) — _AC:_ append-only JSONL per layer; readLog newest-first with all filters; rotateLog renames to .YYYY-MM.jsonl at threshold; cms event-log.ts replaced; admin event-log page renders identically; logStats correct against a fixture.
- **F011.4** — Supabase adapter + dual client/server (Stack A) — _AC:_ createClientLogStore (auth.uid RLS) + createServerLogStore (service role); fysiodk audit.ts + audit-server.ts replaced without changing call sites; RLS policy still enforced; useEventLog returns {log,isLoading}.
- **F011.5** — Admin UI table (Stack A) — _AC:_ EventLogTable (shadcn Table+Tabs+Input, no native selects); tabs map to categories; search debounced 300ms + spinner; pagination + timestamp/action sort; data-testid on all controls; renders in storybook with fixtures.
- **F011.6** — GDPR export + anonymise API — _AC:_ buildExportPayload returns the sanneandersen-shaped ExportPayload; anonymizeContact replaces fields with '[deleted]'; deleteUserData runs steps in a transaction → DeleteResult; integration test export→delete→export returns anonymised payload with userDeleted=true.

## Acceptance criteria
1. @broberg/event-log builds + typechecks clean; headless core imports no framework packages.
2. Each story (F011.1–F011.6) meets its own AC.
3. Piloted in cms and adopted back with no regression (runtime-verified).
4. A second consumer (trail or sanneandersen) migrates onto the shared package with identical behaviour.

## Dependencies
- External: drizzle-orm (sqlite adapter), @supabase/supabase-js (supabase adapter), shadcn/ui Table+Tabs+Input+Badge + lucide-react (ui pkg).
- Related: F014 Consent (logs consent changes).

## Rollout
Strangler: 1) extract core from cms event-log.ts; 2) add LogStore + makeLogEntry; 3) sqlite adapter pilot in trail; 4) publish; 5) sanneandersen (keep its closed union as a domain extension); 6) supabase adapter + UI for fysiodk + senti; 7) spread to cardmem.

LEAP-candidate: no — stays in `components`.

## Open Questions
- Open AuditEventKind with generic LogEntry<TKind>, or each repo defines its own layer on a base union?
- Supabase adapter bundle the DDL+RLS migration, or each repo manages its own?
- trail's human-readable 'summary' field — required or optional in the shared LogEntry?
- JSONL multi-process-safe appends (file locking) for cms multi-worker, or single-writer acceptable?
- Realtime SSE in the UI package, or polling-only for v1?

## Effort estimate
**M** — owner session: `cms`. Reuse model: hybrid.

## Risks
Three persistence backends mean the LogStore interface must be frozen at v1.0 before adapters are written (a breaking change invalidates all three at once). Closed AuditEventKind unions are domain concerns — support open-string kind + optional generic for local narrowing (adds type complexity). cms's 8-char truncated IP hash may not satisfy strict DPA interpretation for small IP spaces — offer full sha256 as an option. JSONL rotate-by-mtime can rotate prematurely — scan the last entry timestamp instead.