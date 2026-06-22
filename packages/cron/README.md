# @broberg/cron

Typed self-service client for **cronjobs.webhouse.net** — the fleet's hosted
HTTP-cron. Register and manage scheduled jobs in a few typed calls instead of
hitting the NextAuth login wall or hand-rolling a scheduler.

- **Dependency-free.** Raw `fetch` over the Bearer-authed `/api/jobs` API, so it
  runs in Node, Bun and edge alike.
- **Types generated from the service OpenAPI** (`pnpm gen` → `src/schema.ts`), so
  the client stays byte-aligned with the contract — a spec change is a type error.
- **Per-repo scoped token.** A scoped `CRONJOBS_API_TOKEN` only ever sees and
  touches its own repo's jobs (cross-scope → 404).
- **Secrets stay server-side.** Put a target secret in a per-job `headers` entry;
  it's stored on the cron service and forwarded verbatim on each tick — never in
  the URL or a log.

> **Not yet on npm.** v0.1.0 bootstrap-publish is pending Christian's go +
> Trusted Publisher (the standard `@broberg/*` ship path). Built against the live
> contract; `cronjobs.webhouse.net/api/openapi.json` is the source of truth.

```bash
pnpm add @broberg/cron
```

## Usage

```ts
import { createCron } from "@broberg/cron";

// token defaults to process.env.CRONJOBS_API_TOKEN; baseUrl to cronjobs.webhouse.net
const cron = createCron();

// Register a job. Pass a stable `externalId` so re-running a deploy UPSERTS the
// same job (no duplicate) instead of creating a new one — this is also how you
// UPDATE a job (re-create with the same externalId), so you never track ids.
// The target secret rides in `headers` (object → stored JSON), never in the URL.
const job = await cron.createJob({
  name: "xrt81 push-tick",
  schedule: "*/10 * * * *", // every 10 minutes
  url: "https://xrt81.com/api/push/tick",
  method: "POST",
  headers: { Authorization: "Bearer <PUSH_TICK_SECRET>" },
  externalId: "xrt81:push-tick",
});

await cron.listJobs({ tag: "push" });
await cron.pauseJob(job.id);   // idempotent — no-op if already paused
await cron.resumeJob(job.id);
await cron.runJob(job.id);     // fire once now → Execution
await cron.getExecutions(job.id); // recent run history
await cron.deleteJob(job.id);
```

Every method throws a typed `CronError` (`{ status, code?, message, details? }`,
`code` ∈ `unauthorized | forbidden | not_found | validation_error | invalid_cron`)
on a non-2xx response, so a failed registration surfaces loudly.

### Minting tokens (orchestrator only)

```ts
// Requires a session/admin token (a scoped token gets 403). Omit `scope` for a
// full-access token (session only). The plaintext `key` is returned ONCE.
const { key } = await cron.mintKey({ name: "xrt81 production", scope: "xrt81" });
```

The admin token that mints per-repo tokens lives with **buddy** (one audited
privileged path); ordinary repos consume a scoped token they were provisioned.

## API

- `createCron(config?) → CronClient` — `config: { token?, baseUrl?, fetch? }`.
- `createJob(spec)` (upsert via `externalId`) · `getJob(id)` · `listJobs(filter?)`
  · `deleteJob(id)` · `pauseJob(id)` · `resumeJob(id)` · `toggleJob(id)` ·
  `runJob(id)` · `getExecutions(id)` · `mintKey({name, scope?})`.
- `CronError` — thrown on any non-2xx (and on a missing token/fetch).

Owned + published by [`broberg-ai/components`](https://github.com/broberg-ai/components)
(epic **F041**). The cron **service** (scoped tokens, self-service mint,
idempotency) is owned by the `cronjobs` repo. MIT.
