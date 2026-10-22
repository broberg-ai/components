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

## Two write paths — pick by what a failed write should do (0.2.0)

| | `createEventLog(store)` | `createAuditTrail({ appendTx })` |
|---|---|---|
| For | activity / server logs | an audit trail that must match the data |
| A failed write | is swallowed (`onError`), the user's action goes on | **throws**, so your transaction rolls back |
| Transaction | none — fire-and-forget | yours — the entry is written with your `tx` |

```ts
import { createAuditTrail } from "@broberg/event-log";

const trail = createAuditTrail<Tx>({
  appendTx: (tx, entry) => tx.insert(auditLog).values(entry), // your DB, your transaction
});

await db.transaction(async (tx) => {
  await tx.update(docs).set(change).where(eq(docs.id, id));
  await trail.appendIn(tx, { kind: "document.updated", actor, target: { type: "doc", id } });
  // if appendIn throws, the update above is rolled back with it
});
```

`appendIn` builds the entry exactly like the log does (id, time, `layer: "audit"`,
level `info` unless given) and resolves with it. The package never sees a
database driver — the transaction is yours.

**Synchronous transaction? Use `appendInSync` (0.3.0).** Drizzle on bun:sqlite and
better-sqlite3 run `db.transaction(cb)` with a callback that cannot await. There,
`appendIn` is wrong: its throw becomes a rejected promise, the callback returns
normally and the change commits WITHOUT its audit row.

```ts
db.transaction((tx) => {
  tx.update(docs).set({ title }).where(eq(docs.id, id)).run();
  trail.appendInSync(tx, { kind: "document.updated", actor, target: { type: "doc", id } });
  // a failed audit write throws HERE, synchronously → the update rolls back
});
```

`appendTx` must then be synchronous too; if it returns a promise, `appendInSync`
throws `AuditSyncError` rather than silently not waiting. `entry.at` is an ISO
string; `Date.parse(entry.at)` if your column is epoch-ms.

## Adapters (follow-on)

`@broberg/event-log-sqlite` (Drizzle bun:sqlite + Hono middleware),
`@broberg/event-log-jsonl` (append-only files), `@broberg/event-log-supabase`
(client RLS + service-role) and `@broberg/event-log-ui` (shadcn admin table) all
implement / consume this frozen core.

## License

MIT · part of the [`@broberg/*`](https://discovery.broberg.ai) shared inventory.
