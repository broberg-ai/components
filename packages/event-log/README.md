# @broberg/event-log

The **headless core** for an append-only event log — audit (GDPR who-did-what),
activity (operational), server (errors/deploys). The write-side contract that
five+ repos hand-rolled, extracted once: a typed entry, a **fire-and-forget**
writer that never throws or blocks the caller, GDPR primitives, and a pluggable
`LogStore`. Zero deps, no framework/DB imports.

```bash
npm i @broberg/event-log
```

## Usage

```ts
import { createEventLog, createMemoryLogStore } from "@broberg/event-log";

const log = createEventLog(store, { onError: (e) => console.error(e) });

log.logLogin({ id: "u1", kind: "user" });
log.logDocumentPublished({ id: "u1", kind: "user" }, { type: "post", id: "p9" });
log.logAgentRan({ id: "bot", kind: "llm" }, "Summarised 12 docs");
log.serverError("Webhook 500", { route: "/stripe" });

// raw / custom kind
log.audit({ kind: "invoice.voided", actor: { id: "u1", kind: "user" }, target: { id: "inv_1" } });

const recent = await log.read({ layer: "audit", since: "2026-07-01T00:00:00Z" });
```

**Fire-and-forget is the point:** a store failure (sync *or* async) can never
throw into or block your primary operation — it's routed to `onError` and
otherwise swallowed. Logging must never take the user's request down with it.

## Pieces

- **`LogEntry<TKind = string>`** — `{ id, at, layer, level, kind, actor?, target?, summary?, metadata?, tenantId?, ipHash? }`.
  The generic `TKind` lets a consumer narrow `kind` to a closed union without
  forking the package.
- **`LogStore`** — `{ append, read }`. **Frozen at v1** (semver-major-gated) so
  the JSONL / SQLite / Supabase adapters stay compatible. `createMemoryLogStore()`
  ships for tests + SSR.
- **`makeLogEntry(input)`** — stamps `id` + ISO `at`, defaults `level` to `info`.
- **`filterEntries(entries, opts)`** — newest-first, filtered by layer / level /
  actorId / `since` / `kindPrefix` / limit.
- **GDPR:** `hashIp(ip, { full? })` (Web-Crypto SHA-256 — 8-char prefix, or full),
  `anonymizeContact(row, fields)` (Art. 17 → `[deleted]`).
- **`LOG_CONFIG`** — `MAX_AGE_DAYS` / `MAX_LINES` retention knobs (one source).

## Adapters (follow-on)

`@broberg/event-log-sqlite` (Drizzle bun:sqlite + Hono middleware),
`@broberg/event-log-jsonl` (append-only files), `@broberg/event-log-supabase`
(client RLS + service-role) and `@broberg/event-log-ui` (shadcn admin table) all
implement / consume this frozen core.

## License

MIT · part of the [`@broberg/*`](https://discovery.broberg.ai) shared inventory.
