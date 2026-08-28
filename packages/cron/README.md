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

## Three things the types cannot tell you

### `externalId` uses a COLON — `repo:job-name`

Thirteen of the fifteen jobs on the fleet follow it, and **nothing on either side normalises it.** So a deviation does not fail — it silently **creates a duplicate job** instead of updating the one you meant.

> From the call site, *"the upsert missed"* and *"the upsert updated"* look identical. Only `201` versus `200` separates them, and nobody reads that.

Pick the convention and stay on it. This client deliberately does **not** rewrite your identifier for you: silently normalising someone's id is how you create the duplicate you were trying to prevent.

### `connectTimeout` defaults to `null`, and that is deliberate

Two different questions, which `timeout` alone used to answer at once:

| | |
|---|---|
| `timeout` | how long the **work** may take |
| `connectTimeout` | how long we wait for a response to **begin** |

`fetch()` resolves at the response *headers*, so for a job that computes first and answers afterwards, **time-to-header is work time** — a short default would kill exactly those jobs. Set it only when your endpoint answers promptly.

Where it does apply the gain is real: buddy's ingest job answers in 201 ms, and with `timeout: 120000` it hung for the full two minutes through a 16-second outage, burning its whole retry budget on one dead attempt. **Long patience makes a job more fragile, not more robust.**

### A partial update no longer resets what you left out — but send everything anyway

Server-side defaults now apply **only on creation**, so a minimal spec is safe. `tags: undefined` keeps them; `tags: []` clears them.

It was not always so, and the bug hit the exact pattern we recommend — an idempotent re-registration by `externalId`, which every integration runs on **every deploy**. Each run silently cleared all tags, reset timeout/retry/timezone, turned a POST job into a GET, and **re-enabled a job someone had deliberately paused.**

Fixed upstream. Still send your full configuration, so your job does not depend on server behaviour you cannot see from here.

## Is this client still current?

```bash
npm run check:drift
```

Fetches the published contract, regenerates, and compares. **Three outcomes, never two:**

| | exit | |
|---|---|---|
| `✓` | 0 | in sync |
| `✗ DRIFTED` | 1 | regenerate with `npm run gen` — it names the first line that differs |
| `? COULD NOT ASK` | 2 | the spec could not be reached or parsed |

It runs as part of `npm test`, where **drift blocks and "could not ask" does not.** That asymmetry is on purpose: a check that goes red on a flaky network is a check that gets switched off, and the real drift gets switched off with it. The trade is that an unreachable spec is *reported* rather than *enforced* — so read the line, don't just read the exit code.

**Why it exists:** on 2026-08-28 four public-API changes landed in a single day, two of which had already made these types wrong — and the only reason we found out is that somebody on the other side chose to write to us. A signal that exists only while a person remembers to send it is not a signal.

## API

- `createCron(config?) → CronClient` — `config: { token?, baseUrl?, fetch? }`.
- `createJob(spec)` (upsert via `externalId`) · `getJob(id)` · `listJobs(filter?)`
  · `deleteJob(id)` · `pauseJob(id)` · `resumeJob(id)` · `toggleJob(id)` ·
  `runJob(id)` · `getExecutions(id)` · `getStatus(id)` · `mintKey({name, scope?})`.
- `CronError` — thrown on any non-2xx (and on a missing token/fetch).

Owned + published by [`broberg-ai/components`](https://github.com/broberg-ai/components)
(epic **F041**). The cron **service** (scoped tokens, self-service mint,
idempotency) is owned by the `cronjobs` repo. MIT.
