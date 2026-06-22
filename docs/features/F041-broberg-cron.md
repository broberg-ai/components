# F041 — `@broberg/cron`: typed self-service client for cronjobs.webhouse.net

> **Owner:** components (the npm client) · **Service-side counterpart:** the `cronjobs` session (cronjobs.webhouse.net repo) · **Status:** Backlog — build gated on cronjobs shipping the scoped-token + self-service-mint contract.
> **First customer:** xrt81 (push-tick every 10 min). **Origin:** Christian, worked out with upmetrics + cronjobs over intercom #5781–#5791, 2026-06-22.

## The pain

cronjobs.webhouse.net is the fleet's hosted HTTP-cron. Its `/api/jobs` is already fully programmatic (Bearer `cj_`), but the browser UI redirects to NextAuth, so repos *think* they need an interactive login and either hand-roll a scheduler or wait for a human to register the job. Two real gaps make self-service impossible today:

1. **Flat token model** — any enabled `cj_` token has FULL CRUD over EVERY job on the instance. An xrt81 token could delete upmetrics' probes. `createdBy` is logged but never enforced.
2. **No self-service mint** — `POST /api/keys` (mint) is session-only (NextAuth). A token cannot mint a token, so a new repo cannot get its own token without an interactive magic-link login. **This is the actual blocker** (not the API, not list/get — both already exist).
3. Not idempotent — `POST /api/jobs` makes a fresh nanoid every call; re-running a deploy double-creates jobs.

## Decision — SCOPE-FIRST (Christian, 2026-06-22)

Per-repo **scoped** tokens (a token may only touch its own jobs) land BEFORE self-service mint rolls out broadly. Rationale: self-service mint is exactly what makes tokens proliferate; a cloud of full-access tokens is when "flat" turns dangerous — the accidental fleet-wide wipe class we have already been bitten by (rm/DELETE incidents). Scope before proliferation beats migrating after. (xrt81 still gets an interim token NOW — one controlled token, not the broad rollout.)

## Division of labor

| Side | Owner | What |
|---|---|---|
| **Service** | cronjobs | scoped tokens (binding token→repo/owner, enforce own-jobs-only) · self-service mint without NextAuth · idempotent upsert via client-supplied `externalId` · stable error envelope `{error:{code,message,details?}}` · open `/api/openapi.json` · export typed zod schema |
| **Client** (this epic) | components | `@broberg/cron` — typed wrapper over `/api/jobs` |

## Client scope (`@broberg/cron`)

- `createCron({ token?, baseUrl? })` — token from `CRONJOBS_API_TOKEN` env by default; `baseUrl` defaults to `https://cronjobs.webhouse.net`.
- `createJob(spec)` / `getJob(id)` / `listJobs(filter?)` / `updateJob(id, patch)` / `deleteJob(id)` / `toggleJob(id, enabled)` / `runJob(id)` — thin typed calls over the existing routes.
- **Idempotent upsert** — pass an `externalId`; re-running a deploy updates the same job instead of duplicating (depends on the cronjobs idempotency change).
- **Per-job target auth as a stored header** — the client lets you set per-job `headers` (e.g. the target's `Authorization: Bearer <secret>`). cronjobs forwards stored headers verbatim, so the secret never lands in a URL or a log. Secret is set repo→service over HTTPS at create time, NEVER over intercom.
- **`ensureToken()` / mint helper** — self-service bootstrap of a repo's own scoped token (shape depends on cronjobs' mint contract: trust-on-first-use a la Discovery enroll, or admin-mint). Built once cronjobs ships mint.
- Typed, never-throws-on-expected-errors result style consistent with `@broberg/mail` / `@broberg/apikey`.

## Build approach — consume the service's typed contract

Build the client against cronjobs' **exported zod schema / OpenAPI** (openapi-typescript → generated types, the `@broberg/complimenta-sdk` pattern) so client ↔ service stay byte-aligned and a contract change surfaces as a type error, not a runtime drift. **Do NOT build against the current contract** — cronjobs is about to change the error envelope + add `externalId` idempotency + scoped tokens; building now = rework. Wait for their stabilized OpenAPI + schema export, then build.

## Verified contract (today, pre-changes)

`jobSchema` required: `{ name, schedule (cron-expr), protocol enum(https|http|wss|ws), url }`. Defaults: `timezone=Europe/Copenhagen`, `method=GET`, `timeout=30000`, `retryCount=0`, `retryStrategy=fixed`. Routes: `GET /api/jobs` (filters search/tag/status/protocol/sort/order), `GET /api/jobs/{id}`, `GET /api/jobs/{id}/status`, `POST /api/jobs`, `PUT /api/jobs/{id}`, `DELETE /api/jobs/{id}`, `POST /api/jobs/{id}/toggle`, `POST /api/jobs/{id}/run`. All Bearer-auth'd.

## Non-goals

- **NOT a new scheduler.** cronjobs.webhouse.net stays the engine; this is a client + the service's own self-service layer. (Distinct from buddy's `schedule_job`/F062, which wakes cc-SESSIONS; this is pure HTTP-endpoint cron, no session.)
- **NOT the scoping / mint / idempotency logic** — those are cronjobs' service-side.
- **No retry/exactly-once guarantees in the client** — cron ticks are independent; a missed tick is caught next interval (upmetrics' proven stance). Observability stays self-observed in the calling app.

## Rollout

1. cronjobs ships scoped tokens + self-service mint + idempotent `externalId` + stable error envelope + open OpenAPI + typed schema export.
2. components builds `@broberg/cron` against that contract (generate types from the OpenAPI), tests, tsup dual ESM/CJS.
3. Bootstrap-publish `@broberg/cron@0.1.0` (OIDC `publish.yml` + a `cron-v*` tag prefix + Trusted Publisher; v0.1.0 by hand) — gate on Christian's go + a verified pilot.
4. Pilot consumers: xrt81 (first), then upmetrics swaps its hand-rolled calls. Catalogue in Discovery (`scripts/inventory-data.mjs`).

## Dependencies

- cronjobs service-side contract (scoped tokens, mint, idempotency, OpenAPI, typed schema) — the hard dependency; client build waits on it.
- xrt81 — first customer; unblocked independently NOW via an interim token (not on this critical path).
