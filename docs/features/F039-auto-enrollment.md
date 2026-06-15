# F039 — Auto-enrollment service (Discovery write-layer)

> Service · runtime (Discovery API) · effort **M** · impact **high** · owner `components`.
> **Status:** in progress (2026-06-15) — API + Turso store built; live deploy gated on the Fly auth re-login + a Turso DB provision.
> Depends on: F038 (Discovery API).

## Motivation
Today, when a fleet session adopts a `@broberg/*` package, **I hand-edit `scripts/inventory-data.mjs`** (the FLEET roster's `uses:`/`src:` + the F005-style adoption trackers) and redeploy. That happened 4× today alone (trail, sanne, cms, xrt81 on mail; xrt81 on config). It doesn't scale and it's the kind of manual sync that drifts.

Christian's ask: components **offers an auto-enrollment service**. Any session can (1) ask "what's the newest version of X, am I enrolled, and what am I missing?" and (2) **self-report** an enrollment via an API call that **auto-writes them onto the inventory/site** — no human edit.

## Solution
Extend the Discovery API (F038, currently read-only + stateless) with a small **write-layer** backed by **Turso (libSQL)** — the fleet's shared edge DB, multi-tenant-safe across Discovery's machines (the documented "move state to Turso" pattern; a Fly volume would force single-machine). Reads stay public; writes require a fleet key. The compiled-in inventory (`inventory-data.mjs`) remains the **designed/canonical** roster; live enrollments are an **overlay** that the API serves instantly and the dashboard shows as a live strip. I **periodically reconcile** confirmed enrollments back into `inventory-data.mjs` so the repo stays the single source of truth.

## Scope

### In scope (v1)
- Turso-backed enrollment store (`session`, `pkg`, `version`, `role`, `commit`, `notes`, `updated_at`; PK `(session,pkg)` → upsert).
- `POST /api/enroll` — authed self-report (validates `pkg` against the known package list so the roster can't be polluted with garbage).
- `GET /api/enrollments` — the live roster.
- `GET /api/sessions/:session` — a session's status: enrolled · newest versions · the **gap** (shipped packages not yet enrolled).
- Write auth via a shared fleet `ENROLL_KEY` (`x-enroll-key` header); ship-dark when unconfigured (reads work, writes 503).

### Out of scope (follow-ups)
- The dashboard live "who-enrolled" strip (client-fetch `/api/enrollments`) — fast-follow.
- Auto-reconcile job (fold live enrollments → `inventory-data.mjs`) — a scheduled/manual reconcile; v1 keeps the API as the live truth + I reconcile by hand initially.
- Per-session keys / signed enrollment (v1 trusts an authed fleet key — low blast radius; a bad row is reconcilable + correctable).

## Architecture
- **Store** (`apps/discovery/enroll.ts`): `@libsql/client` (`url` = `TURSO_DATABASE_URL`/`ENROLL_DB_URL`, `authToken` = `TURSO_AUTH_TOKEN`); a local `file:` works for dev, `:memory:`/temp-file for tests. Lazy init (creates the table on first use); disabled (null) when no URL is configured → writes 503, reads empty.
- **Endpoints** (`server.ts`): added under the existing CORS; `POST /api/enroll` gated on `ENROLL_KEY`. The manifest (`/api`) advertises them so a session discovers the enroll flow from the root.
- **Gap logic**: `available` = shipped packages + latest version (from the compiled inventory); `gap` = available − a session's enrolled pkgs.

## Public API
```
GET  /api/enrollments                      → { count, enrollments[] }
GET  /api/sessions/:session                → { session, enrolled[], available[], gap[] }
POST /api/enroll   (x-enroll-key)           body { session, pkg, version, role?, commit?, notes? } → { ok, enrollment }
```

## Stories
- **F039.1** — Turso enrollment store (init/upsert/list/bySession) — _AC:_ lazy init creates the table; upsert is idempotent on `(session,pkg)`; disabled when no DB URL. ✅
- **F039.2** — Write + read endpoints + auth — _AC:_ `POST /api/enroll` rejects without a valid `x-enroll-key` (401) and on unknown `pkg` (400); valid enroll upserts + returns it; `GET /api/enrollments` + `/api/sessions/:session` (with gap) work; manifest lists them. ✅
- **F039.3** — Live dashboard strip — _AC:_ the dashboard fetches `/api/enrollments` and renders a live "recently enrolled" strip in the Fleet section. (follow-up)
- **F039.4** — Reconcile-to-repo — _AC:_ a path (script or scheduled job) folds confirmed live enrollments into `inventory-data.mjs` so the repo stays canonical. (follow-up)

## Acceptance criteria
1. Discovery builds + typechecks clean with the write-layer; store ship-dark when unconfigured. ✅ (v1)
2. Unit tests cover enroll auth (401), unknown-pkg (400), upsert + list + session-gap — against an in-memory/temp libSQL. ✅ (v1)
3. Live: a Turso DB provisioned + `ENROLL_KEY`/`TURSO_*` set as Fly secrets; a real session enrolls via the API and appears in `/api/enrollments`. (gated on Fly auth re-login + Turso provision)

## Dependencies
- `@libsql/client` (^0.17) — Turso/libSQL client (runtime dep on the Discovery app, which is private/not published, so no peer concern).
- Turso DB + creds (`TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`) — to provision (fleet Turso org).
- `ENROLL_KEY` — a generated shared fleet write-secret (Fly secret; distributed to sessions out-of-band, never over intercom — same rule as R2 creds).
- Live deploy blocked until the Fly auth token is re-authed (`fly auth login`).

## Rollout
1. Build API + store + tests (this turn). 2. Provision Turso DB + set Fly secrets (`TURSO_*`, `ENROLL_KEY`). 3. Deploy once Fly auth is restored. 4. Broadcast the enroll endpoint + key to the fleet so sessions self-report. 5. Add the live dashboard strip (F039.3) + reconcile path (F039.4).

## Risks
A second source of truth (live store vs compiled inventory) — mitigated by treating the repo as canonical + reconciling the overlay back in (F039.4). A shared write-key is coarse — acceptable (low blast radius, authed, reconcilable); per-session keys are a later hardening. Discovery becomes stateful — Turso (not a Fly volume) keeps it multi-machine-safe.
