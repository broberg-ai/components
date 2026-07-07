# F054 — @broberg/pwa (fleet PWA primitive)

**Status:** in progress · **Owner:** components · **Greenlit:** Christian, 2026-07-06

## Motivation

Four repos have each hand-rolled the same PWA plumbing:

- **xrt81** — PWA *setup* (manifest + service-worker + install wiring). Inventory copy-tier entry "PWA setup".
- **cardmem**, **fds**, **pitch-vault** — the *"new version available"* update banner (SW `waiting` → banner → `SKIP_WAITING` postMessage → `skipWaiting()` → `controllerchange`-reload). Inventory copy-tier entry "PWA update banner". pitch-vault was mid-way on a **third** copy when fds flagged it.

Three+ hand-rolled copies of the same lifecycle = exactly the drift `@broberg/*` exists to kill. Christian asked whether the update screen was already in the inventory (it is — as copy-tier, not a package). Decision: **promote it into a real package.**

## Scope (v0.1.0 — the update-detection primitive)

The battle-tested piece 3 repos share. Ships as one package with three subpath exports (mirrors `@broberg/webpush`):

- **`@broberg/pwa`** (core, zero runtime deps) — `createPwaUpdater(opts)`: a framework- AND bundler-agnostic controller for the SW update lifecycle. `{ subscribe, getState, applyUpdate, destroy }`.
- **`@broberg/pwa/react`** — `usePwaUpdate(opts)` hook + an **unstyled** `<PwaUpdateBanner>` skeleton (a11y `role=status`/`aria-live`, testids `pwa-update-confirm/-dismiss/-close`, consumer styles it via `className`/tokens — no hardcoded colours). `react` is an optional peer.
- **`@broberg/pwa/sw`** — `listenForSkipWaiting(self)` + the shared `SKIP_WAITING` message constant. Serwist-agnostic (works with Serwist, Workbox, or a hand-rolled SW).

### Controller behaviour (distilled from fds's reference, generalised)

- Register `swUrl` (default `/sw.js`); if `reg.waiting` at mount → `updateReady=true`.
- `updatefound` → new worker `statechange` → `installed` **while a controller already exists** → `updateReady=true`. A *first* install (no existing controller) does **not** fire the banner (suppression).
- `pollIntervalMs` (default 60 min; `0` disables) calls `reg.update()`.
- `applyUpdate()` posts `{type:'SKIP_WAITING'}` to the waiting worker; `controllerchange` → `location.reload()` (when `reloadOnControllerChange`, default true; guarded against reload-loops).
- **Guards are consumer policy, injected as options** — `disabled` (e.g. `isNativeCapacitor || isDev`) makes the controller an inert no-op. The package never hardcodes `process.env.NODE_ENV` or a `.native` class check (app-specific); it documents the recommended guard.
- Dark-ship: no `serviceWorker` in `navigator` → inert no-op, never throws.

## Non-goals (v0.1.0)

- **PWA install / manifest factory + SVG→icon generator** — real need (xrt81 + pitch-vault) but its source isn't in hand yet; deferred to **v0.2.0** (F054.4). Don't block the proven update primitive on unread code.
- **No bundled web-push** — scope-fence: notifications stay in `@broberg/webpush` (fds's `sw.ts` wires both; they compose, they don't merge).
- **No Serwist dependency** — the SW helper only needs `skipWaiting` + a message listener.
- **No hardcoded styling or copy** — unstyled skeleton + overridable `labels`.

## Architecture

```ts
// @broberg/pwa
createPwaUpdater(opts?: {
  swUrl?: string;                    // '/sw.js'
  pollIntervalMs?: number;           // 3_600_000; 0 = off
  reloadOnControllerChange?: boolean;// true
  disabled?: boolean;                // consumer guard (native/dev)
}): { subscribe(cb): () => void; getState(): { updateReady: boolean }; applyUpdate(): void; destroy(): void }

// @broberg/pwa/react
usePwaUpdate(opts?): { updateReady: boolean; applyUpdate: () => void }
<PwaUpdateBanner updateReady onUpdate onDismiss? labels? className? />

// @broberg/pwa/sw
listenForSkipWaiting(self?): void
export const SKIP_WAITING_MESSAGE = { type: 'SKIP_WAITING' } as const
```

## Dependencies

Zero runtime deps in core + sw. `react` optional peer (only `/react`). Dev: vitest, tsup, typescript, @testing-library/react, happy-dom.

## Consumers / rollout

1. **fds** = source + consumer #1 — migrates its 3 files to the package on release.
2. **pitch-vault** — consumes instead of shipping copy #3.
3. **cardmem**, **xrt81** — adopt as they touch their PWA code.

Release: bootstrap-publish `v0.1.0` (manual `npm publish` + one OTP from Christian) → Trusted Publisher → OIDC tag `pwa-v*` after. Discovery enroll (`role=src`) + promote the inventory 'PWA setup'/'PWA update banner' catalogue rows into a real `@broberg/pwa` package entry. Harness: RED vitest gate in CI blocks publish; fds proves it live in a real installed PWA (Lens/real-device) as the runtime probe.

## Stories

- **F054.1** Core controller (`createPwaUpdater`) + `@broberg/pwa/sw` skip-waiting helper — framework-agnostic, zero-dep, vitest.
- **F054.2** React adapter — `usePwaUpdate()` + unstyled `<PwaUpdateBanner>` skeleton (a11y + testids), vitest.
- **F054.3** Publish `v0.1.0` (package.json/tsup/README, dark-ship, bootstrap + OIDC job) + Discovery enroll + promote inventory catalogue → package.
- **F054.5** Preact adapter — `@broberg/pwa/preact` (`usePwaUpdate()` + unstyled `<PwaUpdateBanner>`) for cardmem + the Stack B (Bun/Hono/Preact) apps, same core, `preact` optional peer. Ships v0.1.1 token-free (OIDC tag `pwa-v0.1.1`).
- **F054.4** *(backlog, v0.2.0)* PWA setup — manifest/meta factory + SVG→apple-touch/maskable icon generator (absorb pitch-vault `cbroberg/pitch @ d5de8c2` + xrt81).
