# F021 — PWA Setup

> L2 Shell · hybrid (scaffold + runtime) · effort **M** · impact **medium** · owner `xrt81`. Status: Backlog.
> Graduate-candidate: no — stays in `components`.

## Motivation
A reusable PWA layer making any web app installable with a human-tap-only update flow. Three concerns: (1) a service worker that precaches the app shell + intercepts fetches with appropriate strategies, (2) a web manifest declaring display/icons/brand colors, (3) UI components — PwaUpdateBanner (surfaces when a new SW is waiting) + optional InstallModal. Proven across fysiodk (@serwist/next), xrt81 (vite-plugin-pwa/Workbox), cardmem (manual SW), cms-admin (minimal SW) — all share the SKIP_WAITING handshake + the 'never silent reload' contract.

## Solution
**hybrid (scaffold + runtime).** The headless lifecycle logic (beforeinstallprompt capture, hasInstallPrompt/promptInstall/isStandalone/detectPlatform, SKIP_WAITING handshake, hourly + visibilitychange update poll) is identical across xrt81, cardmem, fysiodk → runtime package. The SW file CANNOT be a runtime package — it's compile-time stamped (__BUILD_ID__), bundled by the framework plugin (withSerwist/VitePWA), or a plain public/sw.js referencing project cache names → scaffold per repo. The UI (PwaUpdateBanner/InstallModal) renders with each project's design tokens → copy-owned. So: headless core (@broberg/pwa) + scaffolded SW/manifest + copy-owned UI.

## Scope

### In scope
- Extract from `broberg/xrt81` `apps/web/src/lib/pwa.ts` + `components/{PwaUpdateBanner,InstallModal}.tsx` + `vite.config.ts`.
- Headless core + React + Preact adapters + SW/manifest scaffold templates.

### Out of scope
- Web Push subscription management (PushManager.subscribe/VAPID) — follow-on.
- Per-brand banner styling (copy-owned).

## Architecture

### Best source (reference implementation)
`broberg/xrt81` — `apps/web/src/lib/pwa.ts` (pure framework-agnostic: hasInstallPrompt/promptInstall/isStandalone/detectPlatform) + `InstallModal.tsx` (platform-aware install guide) + `PwaUpdateBanner.tsx` (headless-props onUpdate/onDismiss) + `vite.config.ts` (explicit Workbox config, navigateFallbackDenylist /api).

### Other implementations seen
- `webhouse/fysiodk-aalborg-sport` `apps/web/src/app/sw.ts` + `public/manifest.json` + `components/pwa/pwa-update-banner.tsx` + `next.config.mjs` — best Stack A (@serwist/next): runtime caching (Supabase NetworkFirst 5min, next/image CacheFirst 1d) + web push handlers + withSerwist wrapper.
- `broberg/cardmem` `apps/web/public/sw.js` + `components/ui/pwa-prompts.tsx` — best manual SW (navigations network-first + shell fallback, hashed assets cache-first, /api never intercepted, __BUILD_ID__ stamp) + most robust lifecycle hook (updatingRef guard, hourly + visibilitychange poll, 1.5s reload backstop).
- `webhouse/cms` `packages/cms-admin/src/components/pwa-register.tsx` — minimal installability baseline (register prod, unregister dev).

### Headless core vs. adapters
- **Core (no React/next):** install helpers (captureInstallPrompt, hasInstallPrompt, promptInstall, isStandalone, detectPlatform 'ios-safari'|'ios-other'|'android'|'desktop'); SW lifecycle (registerSW (prod-only + dev unregister), skipWaiting (postMessage), watchForUpdate (updatefound/statechange + hourly poll + visibilitychange)); SKIP_WAITING_MSG constant. Grounded in xrt81 pwa.ts + cardmem watchForUpdate.
- **Stack A (Next/React/shadcn):** usePwaUpdate() hook; PwaUpdateBanner (use client, shadcn Button); PwaRegister (drop into layout); SW template wired to @serwist/next; manifest template.
- **Stack B (Bun/Hono/Preact/Vite):** PwaPrompts; PwaUpdateBanner (project CSS tokens); InstallModal (platform branching); vite.config VitePWA snippet (registerType prompt, navigateFallbackDenylist /api).

### Public API
```ts
export function captureInstallPrompt(): void; export function hasInstallPrompt(): boolean; export function promptInstall(): Promise<boolean>; export function isStandalone(): boolean;
export type Platform = 'ios-safari'|'ios-other'|'android'|'desktop'; export function detectPlatform(): Platform;
export function registerSW(swPath?: string): Promise<ServiceWorkerRegistration|null>; export function skipWaiting(reg): void; export function watchForUpdate(reg, onUpdate): () => void; export const SKIP_WAITING_MSG;
// '@broberg/pwa/react' → PwaRegister, usePwaUpdate, PwaUpdateBanner ; '@broberg/pwa/preact' → PwaPrompts, PwaUpdateBanner, InstallModal
```

## Stories
- **F021.1** — Extract headless @broberg/pwa core from xrt81 — _AC:_ exports captureInstallPrompt/hasInstallPrompt/promptInstall/isStandalone/detectPlatform/registerSW/watchForUpdate/skipWaiting/SKIP_WAITING_MSG; zero framework imports; unit-testable without DOM (typeof window guards); xrt81 pwa.ts deleted + replaced; app builds + tests pass.
- **F021.2** — Preact adapter (PwaPrompts + PwaUpdateBanner + InstallModal) — _AC:_ PwaPrompts renders nothing in dev (unregisters SW), shows banner when a waiting SW exists, cleans up listeners on unmount; InstallModal handles all four detectPlatform branches, no native confirm/alert; token-agnostic; xrt81 adopts; Lens verifies pwa-update-banner.
- **F021.3** — React adapter (usePwaUpdate + PwaRegister + PwaUpdateBanner) — _AC:_ usePwaUpdate → {needRefresh,onUpdate,onDismiss}; PwaRegister null-render use-client safe in layout; PwaUpdateBanner fixed top with data-testid pwa-update-banner/confirm/dismiss; props onUpdate/onDismiss only (caller applies Tailwind); fysiodk adopts, removes local banner; build passes.
- **F021.4** — SW + manifest scaffold templates — _AC:_ docs/scaffolds: sw-next.ts (Serwist template, TODO runtimeCaching + push slots, references SKIP_WAITING_MSG) + sw-vite-workbox-config.ts (navigateFallbackDenylist /api) + manifest.json (all required fields incl. maskable icons); README on copy-owned vs package.
- **F021.5** — Consistent + documented dev-mode SW unregister — _AC:_ all three adapters unregister any SW in non-prod + skip registration (cms NODE_ENV + cardmem import.meta.env.PROD); README explains why (dev fetch interception breaks HMR); both env spellings covered.
- **F021.6** — Web push handler in the Serwist/Next SW scaffold — _AC:_ sw-next.ts includes push + notificationclick handlers (title/body/url/tag/badge, matchAll focus-or-open, setAppBadge feature-detect) marked optional; SKIP_WAITING listener always present, references SKIP_WAITING_MSG.

## Acceptance criteria
1. @broberg/pwa builds + typechecks clean; headless core imports no framework packages.
2. Each story (F021.1–F021.6) meets its own AC.
3. Piloted in xrt81 and adopted back with no regression (Lens / runtime-verified).
4. A second consumer (fysiodk) migrates onto the shared package with identical behaviour.

## Dependencies
- F001 — Design tokens (related). External: @serwist/next + serwist (Stack A SW, peer).

## Rollout
Strangler: 1) extract xrt81 pwa.ts → @broberg/pwa; 2) Preact adapter (cardmem/xrt81), pilot xrt81; 3) React adapter (fysiodk), adopt fysiodk; 4) SW scaffold templates (Serwist + Vite); 5) cms-admin upgrades from minimal to full usePwaUpdate. Each repo keeps its own manifest + SW file.

Graduate-candidate: no — stays in `components`.

## Open Questions
- Web Push subscription mgmt (PushManager.subscribe/VAPID) in v1 or follow-on? (fysiodk has SW push handlers; subscription side missing everywhere).
- React PwaUpdateBanner: bare headless (props only) or a default @broberg/tokens Tailwind variant? (fysiodk hardcodes #77B729).
- InstallModal for Stack A too, or is beforeinstallprompt + manual iOS docs enough?
- Manual SW scaffold include the __BUILD_ID__ stamp pattern + a Vite plugin snippet?

## Effort estimate
**M** — owner session: `xrt81`. Reuse model: scaffold + runtime.

## Risks
SW files can't be runtime packages — must be built/bundled by the framework toolchain (withSerwist stamps __SW_MANIFEST; VitePWA generates the Workbox precache). The scaffold boundary is correct but requires manual sync of future improvements. The 'never silent reload' contract: the updatingRef guard exists because clients.claim() on first install fires controllerchange — dropping it reloads an in-use board. React usePwaUpdate runs only in client components (Next 'use client' boundary) — document so PwaRegister isn't placed in an RSC. iOS Safari lacks beforeinstallprompt — hasInstallPrompt() always false; the InstallModal ios-safari Share-Sheet branch is the only path; test detectPlatform UA heuristic against current iOS.