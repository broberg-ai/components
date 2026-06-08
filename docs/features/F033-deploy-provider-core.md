# F033 — Deploy provider core + trigger UI (`@broberg/deploy-core`)

> L3 Domain · hybrid (runtime-package core + copy-owned trigger UI) · effort **L** (~16 SP) · owner `cms` (pilot/consumer). Status: Backlog.
> Re-homed from the **execution half** of the original F027 "Deployment Management". When F027's *observe* half moved to Upmetrics (their **F019**: probe/health/CI-watch/deploy-events + deploy-complete relay + release-registry), the *execution* half came back here per Christian — components owns the reusable deploy package; cms/whop are consumers.
> Graduate-candidate: **no** — small shared core npm + copy-owned UI scaffold, stays in `components`.

## Motivation
The logic that **actually deploys** is re-implemented across cms + whop (+ partially cardmem/buddy): HMAC-signed incremental Fly Live sync, Cloudflare Pages direct-upload, GitHub Pages, a typed Fly Machines REST client, and an in-process SSE deploy-event bus. Today a fix to the manifest-diff or HMAC signing has to be hand-ported between repos. Extracting the production-hardened cms implementation into `@broberg/deploy-core` makes a fix propagate once and gives every new app a vetted deployer instead of a copy.

This is the **execution counterpart** to Upmetrics' observe platform. The two meet at exactly one contract: every deploy-event this package emits MUST carry an `originator` (the cc-session/repo that triggered the deploy) so Upmetrics' deploy-complete relay (their F019.7) can route the "deploy done — you can continue" intercom back to the right session, and the release-registry (F019.8) can attribute the release.

## Best source (reference implementation)
`webhouse/cms`:
- `packages/cms-admin/src/lib/deploy/fly-live-provider.ts` — HMAC-signed incremental Fly Live deploy: manifest diff + atomic commit, `signIcdRequest`, `generateSyncSecret`. Pure `node:crypto` + `fetch`.
- `packages/cms-admin/src/lib/deploy/cloudflare-pages-provider.ts` — CF Pages direct-upload with project-creation idempotency.
- `packages/cms-admin/src/lib/deploy/fly-machines.ts` — typed Fly Machines REST client (listApps/getMachines/createMachine…).
- `packages/cms-admin/src/lib/deploy/deploy-events.ts` — in-process SSE deploy-event bus (subscribe/publish/listenerCount, keyed by `orgId:siteId`, optional Web Push hook).
- `packages/cms-admin/src/components/deploy-modal.tsx` — SSE-consumer trigger UI (progress steps, abort, skip-dialog). Copy-owned scaffold.

Cross-check (other implementation): `webhouse/whop app/api/cron/fly-sync/route.ts` (Fly GraphQL app-sync) — used near-identically.

## Scope
### In scope
- `@broberg/deploy-core` headless package (no `next/*`, no React): the four provider/bus modules above.
- `originator` field on `DeployEvent` + the emit-to-Upmetrics contract (their F019.7/F019.8 dependency).
- Copy-owned **DeployModal trigger-UI scaffold** (Stack A) — re-homed from Upmetrics per #4148.
- Pilot: cms adopts the package back as proving ground.

### Out of scope
- Probe / health / CI-runs viewer / read-only deploy-timeline display → **Upmetrics F019** (observe side).
- Deploy-complete relay + release-registry surfaces → **Upmetrics F019.7/.8** (this package only *emits* the originator-stamped events they consume).
- Multi-instance deploy-event bus (Redis pub/sub) — single-process only for v1.

## Architecture
**Headless core** (pure TS, no framework): `deploy/fly-live`, `deploy/cloudflare-pages`, `deploy/github-pages`, `deploy/fly-machines`, `events/deploy-event-bus`. `flyctl` is **optional** — the content-sync path (`syncContent`/`diffManifests`) must never require the binary; only infra-rebuild does.
**Stack A**: server components call the core; a route handler exposes the SSE stream the DeployModal reads. DeployModal is copy-owned (per-brand divergence), not published.
**Stack B** (future): a Hono streaming route mounts the same core; no story in v1.

### Public API (sketch)
```ts
// @broberg/deploy-core
export { flyLiveDeploy, syncContent, diffManifests, signIcdRequest, generateSyncSecret } from './deploy/fly-live'
export { cloudflarePagesDeploy } from './deploy/cloudflare-pages'
export { githubPagesDeploy } from './deploy/github-pages'
export { FlyMachinesClient } from './deploy/fly-machines'
export { subscribe, publish, listenerCount } from './events/deploy-event-bus'
export type { DeployEvent } from './events/deploy-event-bus' // includes `originator: { session: string; repo: string }`
```

## Stories
See cards **F033.1–F033.6** (each carries its own task + context + decomposed AC):
- **F033.1** — Extract Fly Live HMAC incremental-sync provider
- **F033.2** — Extract Cloudflare Pages + GitHub Pages providers
- **F033.3** — Extract Fly Machines REST client + deploy-event bus
- **F033.4** — Stamp deploy-events with `originator` (Upmetrics F019.7/.8 contract)
- **F033.5** — DeployModal trigger-UI scaffold (Stack A, copy-owned)
- **F033.6** — Pilot adoption back in cms

## Acceptance criteria
1. `@broberg/deploy-core` builds + typechecks clean; core imports no `next/*`/React.
2. Every story F033.1–F033.6 meets its own AC.
3. Piloted in **cms** and adopted back with **no behavioural regression** (Lens / runtime-verified, not just curl 200).
4. Every emitted `DeployEvent` carries `originator`; verified end-to-end against Upmetrics' relay (F019.7).

## Dependencies
- Built-ins: `node:crypto` (HMAC), `node:fs/promises` (manifest walk), `fetch`.
- Optional: `flyctl` on PATH (infra-rebuild path only).
- Cross-project: **Upmetrics F019.7/.8** consume the `originator`-stamped deploy-events; **cms/whop** are the consumers/owners of deploy *usage*.

## Rollout
Strangler, never big-bang: 1) extract fly-live + cf-pages + fly-machines + event-bus from cms into `@broberg/deploy-core`; cms adopts back immediately. 2) add `originator` to DeployEvent + wire emit to Upmetrics. 3) whop adopts (replaces its fly-sync copy). 4) DeployModal scaffold lands copy-owned in components. 5) spread to remaining repos on next natural touch.

## Risks
- `execFileSync('flyctl')` fails where flyctl is absent (CI/containers) → content-sync path MUST be flyctl-free; infra-rebuild guards for the binary and errors clearly.
- CF Pages multipart upload uses Node20+ FormData/Blob → pin `bun >=1.1` for Stack B.
- Deploy-event bus is single-process → multi-instance Fly deployments silently drop SSE events; documented limitation, Redis adapter out of scope for v1.

## Open Questions
- Should `flyctl` invocation be a separate optional sub-package (`@broberg/deploy-core/fly-infra`) so the content-sync path has zero system-binary deps?
- `originator` source: does the triggering cc-session set it via env/arg, or does buddy inject it? Needs a one-line contract with buddy + cms/whop before F033.4.
