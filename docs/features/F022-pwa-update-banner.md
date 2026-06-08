# F022 — PWA Update Banner

> L2 Shell · copy-owned · effort **M** · impact **medium** · owner `cardmem`. Status: Backlog.
> Graduate-candidate: no — stays in `components`.

## Motivation
A fixed top-of-screen banner that appears when a new service worker has installed and is waiting to activate. It gives two choices: 'Update' (fires SKIP_WAITING to the waiting SW, sets an updatingRef guard, reloads on controllerchange with a 1.5s backstop) or 'Later' (dismisses for the session, no reload). The component is purely presentational; detection + SW handshake live in a companion controller. The principle across all four source repos: a reload is ALWAYS human-initiated — never silent — so a board or form mid-edit is never destroyed under the user.

## Solution
**copy-owned.** The UI shell (banner markup + tokens) is intentionally project-specific (fysiodk pins brand-green hex, cardmem uses its palette, xrt81 uses CSS class names). The contract (onUpdate/onDismiss, data-testid anchors, role=status aria-live=polite) is identical, but the styling can't be a shared runtime package without imposing a design system. The headless controller logic (SW registration, visibilitychange poll, SKIP_WAITING handshake, updatingRef guard) IS identical across xrt81/cardmem/fysiodk → extract as a tiny framework-agnostic core. So: headless core (package) + copy-owned UI shell. Dominant mode for the visible part is copy-owned.

## Scope

### In scope
- Extract from `broberg/cardmem` `apps/web/src/components/ui/{pwa-prompts,pwa-update-banner}.tsx` + `public/sw.js`.
- Headless controller core (@broberg/pwa-update-core) + React + Preact copy-owned banner templates.

### Out of scope
- Install-prompt helpers (those are F021 pwa.ts).
- Per-brand banner styling (copy-owned).

## Architecture

### Best source (reference implementation)
`broberg/cardmem` — `apps/web/src/components/ui/{pwa-prompts,pwa-update-banner}.tsx` + `public/sw.js`: most polished controller — handles both vite-plugin-pwa AND manual-SW paths, explicit dev-mode SW teardown (never fights HMR), documents every invariant (updatingRef guard, first-ever-install vs user-tap, foreground-check as the reliable mobile trigger), all three data-testid anchors. F113 refinement of the xrt81 F021 original.

### Other implementations seen
- `broberg/xrt81` `apps/web/src/components/{PwaPrompts,PwaUpdateBanner}.tsx` + `lib/pwa.ts` — original F021; uses vite-plugin-pwa registerSW virtual module (couples to the plugin); source of the install-prompt helpers (separate concern).
- `webhouse/fysiodk-aalborg-sport` `apps/web/src/components/pwa/pwa-update-banner.tsx` + `app/sw.ts` — Stack A (Next/React/Tailwind) with brand palette inline + a third X dismiss; most feature-rich SW (@serwist/next).

### Headless core vs. adapters
- **Core (no React/Preact/next):** createPwaUpdateController({swPath, pollIntervalMs?, dev?, onNeedRefresh, onRegistered?}) → {check(), destroy()} (registers SW, updatefound/statechange listener, hourly setInterval + visibilitychange foreground check); applyUpdate(reg?) (sets updatingRef guard, posts SKIP_WAITING, 1.5s backstop reload); isDevMode(). Reloads only when updatingRef is set (protects first-install). No JSX.
- **Stack A (Next/React/shadcn):** PwaPrompts (use client, wraps controller in useEffect, needRefresh useState, renders copy-owned PwaUpdateBanner with var(--*) Tailwind tokens); SW can be @serwist/next or plain sw.ts (must handle SKIP_WAITING); dev teardown via getRegistrations().
- **Stack B (Bun/Hono/Preact):** PwaPrompts (preact/hooks); banner uses CSS custom-property + BEM (no Tailwind); vite-plugin-pwa registerSW callback OR manual sw.js swPath.

### Public API
```ts
export function createPwaUpdateController(opts: { swPath: string; pollIntervalMs?: number; dev?: boolean; onNeedRefresh: () => void; onRegistered?: (reg: ServiceWorkerRegistration) => void }): { check: () => void; destroy: () => void };
export function applyUpdate(reg?: ServiceWorkerRegistration | null): void;
// Copy-owned per project: Stack A PwaPrompts+Banner (React), Stack B PwaPrompts+Banner (Preact). PwaPrompts dropped into root layout once, no props.
```

## Stories
- **F022.1** — Extract headless SW controller @broberg/pwa-update-core — _AC:_ exports createPwaUpdateController + applyUpdate; tests: (a) dev mode unregisters all SWs + returns early, (b) onNeedRefresh fires when a waiting worker exists at registration, (c) onNeedRefresh fires when updatefound→installed, (d) applyUpdate posts SKIP_WAITING + schedules reload backstop; ESM + CJS + d.ts.
- **F022.2** — Stack A copy-owned template (React 19 / Tailwind v4) — _AC:_ templates/.../stack-a: PwaPrompts ('use client', imports core) + PwaUpdateBanner (Tailwind design-token classes, no hardcoded hex); data-testid pwa-update-banner/dismiss/confirm; role=status aria-live=polite; slide-in-from-top enter animation.
- **F022.3** — Stack B copy-owned template (Preact / CSS vars) — _AC:_ templates/.../stack-b: PwaPrompts (preact/hooks, imports core) + PwaUpdateBanner (CSS custom-property/BEM, no Tailwind); same data-testid + ARIA; no next/* imports.
- **F022.4** — Pilot adoption in cardmem — _AC:_ cardmem pwa-prompts.tsx imports createPwaUpdateController + applyUpdate instead of inline; dev-mode teardown still works (toggle import.meta.env.PROD); banner + update flow no regression (Lens smoke on pwa-update-banner).
- **F022.5** — Adopt in xrt81 — _AC:_ xrt81 PwaPrompts imports from the core; banner still surfaces on vite-plugin-pwa onNeedRefresh; install helpers stay local (out of scope).
- **F022.6** — Lens smoke baseline for both stacks — _AC:_ baseline captured for pwa-update-banner in cardmem (Stack B) + fysiodk (Stack A); approved; future layout regressions caught by lens_verify before handoff.

## Acceptance criteria
1. @broberg/pwa-update-banner builds + typechecks clean; headless core imports no framework packages.
2. Each story (F022.1–F022.6) meets its own AC.
3. Piloted in cardmem and adopted back with no regression (Lens / runtime-verified).
4. A second consumer (xrt81 or fysiodk) migrates onto the shared package with identical behaviour.

## Dependencies
- F021 — PWA Setup (blocks). External: lucide-react (Stack A), preact/hooks (Stack B).

## Rollout
Strangler: 1) extract createPwaUpdateController + applyUpdate from cardmem pwa-prompts.tsx → @broberg/pwa-update-core (vitest, no DOM for pure logic); 2) pilot cardmem (wire to import); 3) add Stack A + Stack B copy-owned templates; 4) adopt xrt81; 5) adopt fysiodk; 6) spread via scaffold.

Graduate-candidate: no — stays in `components`.

## Open Questions
- Bundle the install-prompt helpers (xrt81 pwa.ts) into pwa-update-core or keep a separate @broberg/pwa-install-prompt? (different problem, none adopted yet).
- Document the __BUILD_ID__ build-stamp as a required companion convention, or out of scope?
- fysiodk's third X-icon dismiss — expose a showCloseIcon prop or single dismiss action?

## Effort estimate
**M** — owner session: `cardmem`. Reuse model: copy-owned.

## Risks
The controller's timing invariants (updatingRef guard, first-install vs user-tap) are subtle — unit tests are the safeguard. Serwist skipWaiting:false must pair with the banner (fysiodk sw.ts line 24) — skipWaiting:true would auto-reload without consent; document in the template README. The 1.5s backstop reload in applyUpdate could surprise consumers expecting a pure promise — keep it explicit in the JSDoc.