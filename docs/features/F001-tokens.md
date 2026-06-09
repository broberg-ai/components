# F001 — Design tokens + theme preset (`@broberg/theme`)

> L0 Rails · hybrid · effort **M** · impact **critical** · owner `cms`.
> **Status: F001.1–.4 + .6 + .8 SHIPPED** — `@broberg/theme@0.2.0` published to npm; built+typecheck+tests green (15/15). Pilots (F001.5/.7) pending.
> **Stack target: Tailwind v4 ONLY** — no v3 / legacy support (the estate standardises on v4).
> Graduate-candidate: no — small core npm that stays in `components`.

## Motivation
A CSS-first design token system and theme preset that defines the full semantic color vocabulary (background, foreground, card, primary, muted, border, ring, sidebar, destructive, radius) consumed by every app in the estate. Tokens are CSS custom properties in a single source file, mapped into Tailwind v4 via an `@theme inline` block, and flipped by a runtime `data-theme` attribute for light/dark + warm/cool variants. A companion headless TypeScript module manages persistence, system-preference detection, and pub/sub — decoupled from any framework. Ships one canonical "neutral" preset matching the shadcn/ui new-york contract + per-project brand overrides.

The cleanest existing example is **`webhouse/cms`** — dark-first `:root` with full oklch token set, `@theme inline` bridge, and five named `data-theme` variants. The headless store reference is **`broberg/trail`** `apps/admin/src/theme.ts`. Centralising removes per-repo drift and makes a fix propagate.

## Solution
**hybrid.** The headless theme-store (persist + apply + subscribe) ships as the **`@broberg/theme` runtime-package**; the CSS token baseline is a **copy-owned scaffold template**. The `@theme inline` bridge MUST be copy-owned per app because Tailwind v4 resolves it at build time and it cannot be `@import`ed from `node_modules`.

## Architecture (as built, v0.2.0)
- **Core (`packages/theme/src/index.ts`, no React/Preact/next):** `initTheme(opts?)`, `getTheme()`, `setTheme(key)`, `toggleTheme()`, `onThemeChange(fn)`, `THEME_KEYS`. Six-variant `ThemeKey` (`light|dark|light-cool|light-warm|dark-cool|dark-warm`). SSR-safe (DOM/localStorage behind `typeof` guards). `followSystem` reads `prefers-color-scheme`.
- **Stack A (`./react`):** `useTheme` (via `useSyncExternalStore` — **no `next-themes`**, any React, SSR-safe), `ThemeProvider`, `ThemeToggle` (minimal light↔dark, `data-testid="theme-toggle"`; full dropdown copy-owned).
- **Stack B (`./preact`):** thin `useTheme` hook over the store; no `next/*`.
- **CSS baseline (`css/neutral-preset.css`):** neutral shadcn token set, dark-first, 6 `data-theme` variants + `@theme inline` bridge. Copy-owned, Tailwind v4.
- **DESIGN.md generator (`./design-md`, v0.2.0):** `designMdToTailwindV4()` converts a DESIGN.md (Google Labs Apache-2.0 format) into the v4 `:root`+`@theme` baseline — fills the **v3-only gap** in `@google/design.md`; `checkContrastAA()` (WCAG-AA via culori); `theme-design-md` CLI (css|check). Ships a neutral-preset `DESIGN.md`. This is the v4 half of cardmem's F123.2 anchor seam.
- Build: tsup (ESM+CJS+dts, 4 entries). Tests: vitest (jsdom + node-env), **15/15 green**.

### Public API
```ts
// @broberg/theme — headless core
export type ThemeKey = 'light'|'dark'|'light-cool'|'light-warm'|'dark-cool'|'dark-warm';
export function initTheme(opts?: { defaultTheme?: ThemeKey; followSystem?: boolean; storageKey?: string }): ThemeKey;
export function getTheme(): ThemeKey;
export function setTheme(key: ThemeKey): void;
export function toggleTheme(): ThemeKey;
export function onThemeChange(fn: (key: ThemeKey) => void): () => void;
export const THEME_KEYS: readonly ThemeKey[];
// @broberg/theme/react  — useTheme, ThemeProvider, ThemeToggle
// @broberg/theme/preact — useTheme (+ re-export initTheme)
// @broberg/theme/css    — neutral-preset.css (copy-owned)
// @broberg/theme/design-md — designMdToTailwindV4, checkContrastAA, parseDesignMd (+ theme-design-md CLI)
```

## Stories
- **F001.1** — Extract and publish headless theme-store package — **DONE** (`@broberg/theme@0.1.0` on npm; SSR-safe; pub/sub + system-pref tests pass).
- **F001.2** — Ship CSS baseline template (neutral shadcn-compatible preset) — **DONE** (`css/neutral-preset.css`, 6 variants + `@theme` bridge, neutral primary).
- **F001.3** — Stack A React adapter (ThemeProvider + ThemeToggle) — **DONE** (useSyncExternalStore, no next-themes; ThemeToggle data-testid).
- **F001.4** — Stack B Preact adapter — **DONE** (`useTheme` over the store, no next/*).
- **F001.5** — Pilot adoption in webhouse/cms (Stack A) — pending (needs the published package + Lens baseline).
- **F001.6** — Document brand-override pattern — **DONE** (folded into the package README "Brand override pattern").
- **F001.7** — Pilot adoption in Upmetrics (Stack B Preact) — pending; lead Stack-B pilot. Rollout (gated): xrt81, trail, cardmem.
- **F001.8** — DESIGN.md contract + Tailwind-v4 generator — **DONE** (v0.2.0; `designMdToTailwindV4` + `checkContrastAA` + neutral-preset `DESIGN.md` + `theme-design-md` CLI; fills `@google/design.md`'s v3-only gap; is cardmem F123.2's anchor→v4-CSS path, coordinated #4253/#4268).

## Acceptance criteria
1. `@broberg/theme` builds + typechecks clean (`tsc --noEmit`); headless core imports no framework packages. **MET.**
2. Every story meets its own AC (F001.1–.4, .6, .8 met; .5/.7 pending pilots).
3. Piloted in a real consumer with no behavioural regression (Lens / runtime-verified) — **pending** (F001.7 lead on Upmetrics).

## Dependencies
- tailwindcss **v4** (peer, for the CSS baseline only). react / preact are optional peers (adapters). `yaml` + `culori` (deps, for the DESIGN.md generator).

## Rollout
Strangler: ✅ build + publish `@broberg/theme@0.1.0`; ✅ v0.2.0 adds the DESIGN.md→v4 generator (F123.2 anchor seam with cardmem) → pilot Stack B on Upmetrics (F001.7) → on green, spread to xrt81/trail/cardmem → pilot Stack A on cms (F001.5) → spread to remaining v4 repos.

## Risks (v4-only)
The `@theme inline` bridge requires Tailwind v4 — the estate standardises on v4 (upgrade work outside this epic: **fysiodk** `^3.4.19`→v4, **cms** consolidate mixed v3/v4, **cardmem** beta→stable; buddy/sanneandersen/trail/upmetrics already v4). **Non-Tailwind** consumers (e.g. xrt81) are NOT a legacy case — they consume the portable CSS-variable layer + the JS store; only the `@theme` bridge is omitted. No v3 fallback is shipped. The `@theme` block cannot be `@import`ed from node_modules — the copy step is non-negotiable and can drift (mitigated by F123 design-consistency gate, for which DESIGN.md is the anchor).

## Open Questions (resolved)
- next-themes hard dep? → **No** — React adapter wraps the headless store via `useSyncExternalStore`.
- Bare vs prefixed token names? → bare names (shadcn), matching cms.
- Five variants vs two? → ship all six keys; apps use the subset they want.
- DESIGN.md interop? → v0.2.0 ships a DESIGN.md→v4 generator (the v3-only gap in `@google/design.md`); DTCG export is a future follow-up.
