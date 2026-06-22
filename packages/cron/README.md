# @broberg/cron

Typed self-service client for **cronjobs.webhouse.net** — the fleet's hosted
HTTP-cron. Register and manage scheduled jobs in a few typed calls instead of
hitting the NextAuth login wall or hand-rolling a scheduler.

- **Dependency-free.** Raw `fetch` over the Bearer-authed `/api/jobs` API, so it
  runs in Node, Bun and edge alike.
- **Per-repo scoped token.** A scoped `CRONJOBS_API_TOKEN` only ever sees and
  touches its own repo's jobs (cross-scope → 404).
- **Secrets stay server-side.** Put a target secret in a per-job `headers` entry;
  it's stored on the cron service and forwarded verbatim on each tick — never in
  the URL or a log.

> **Status: scaffold (F041).** Built against the verified, stable `/api/jobs`
> routes. A few spots are marked `SEAM:` in the source because the cronjobs
> service is shipping a stable error envelope, idempotent `externalId` upsert,
> and an OpenAPI export → generated types. Those land with cronjobs' rollout
> step 5, after which the types are regenerated from the OpenAPI and v0.1.0 is
> bootstrap-published. Not yet on npm.

```bash
pnpm add @broberg/cron
```

## Usage

```ts
import { createCron } from "@broberg/cron";

// token defaults to process.env.CRONJOBS_API_TOKEN; baseUrl to cronjobs.webhouse.net
const cron = createCron();

// Register a job. The target secret rides in `headers` (object → stored JSON),
// never in the URL.
const job = await cron.createJob({
  name: "xrt81 push-tick",
  schedule: "*/10 * * * *", // every 10 minutes
  url: "https://xrt81.com/api/push/tick",
  method: "POST",
  headers: { Authorization: "Bearer <PUSH_TICK_SECRET>" },
});

await cron.listJobs({ tag: "push" });
await cron.pauseJob(job.id);
await cron.resumeJob(job.id);
await cron.runJob(job.id); // fire once, now
await cron.deleteJob(job.id);
```

Every method throws a typed `CronError` (`{ status, code?, message, details? }`)
on a non-2xx response, so a failed registration surfaces loudly.

## API

- `createCron(config?) → CronClient` — `config: { token?, baseUrl?, fetch? }`.
- `createJob(spec)` · `getJob(id)` · `listJobs(filter?)` · `updateJob(id, patch)`
  · `deleteJob(id)` · `pauseJob(id)` · `resumeJob(id)` · `runJob(id)` ·
  `getStatus(id)`.
- `CronError` — thrown on any non-2xx (and on a missing token/fetch).

Owned + published by [`broberg-ai/components`](https://github.com/broberg-ai/components)
(epic **F041**). The cron **service** (scoped tokens, self-service mint,
idempotency) is owned by the `cronjobs` repo. MIT.
