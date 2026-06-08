# F001 — Design tokens + theme preset

> L0 Rails · hybrid · effort **M** · impact **critical** · owner `cms`. Status: Backlog.
> Graduate-candidate: no — small core npm that stays in `components`.

## Motivation
A CSS-first design token system and theme preset that defines the full semantic color vocabulary (background, foreground, card, primary, muted, border, ring, sidebar, destructive, radius) consumed by every app in the estate. Tokens are declared as CSS custom properties in a single source file, mapped into Tailwind v4 via an @theme inline block, and optionally flipped by a runtime data-theme attribute (or .dark class) for light/dark and warm/cool variants. A companion headless TypeScript module manages persistence, system-preference detection, and pub/sub notification — decoupled from any framework. The package ships one canonical "neutral" preset that matches the shadcn/ui new-york contract, plus instructions for per-project brand overrides.

This pattern is currently re-implemented per repo. The cleanest existing example is **`webhouse/cms`** — dark-first :root with full oklch semantic token set, @theme inline bridge mapping every shadcn token plus radius scale, and five named data-theme variants (light, light-cool, light-warm, dark-cool, dark-warm) via @custom-variant dark. The five-variant pattern is the most evolved token structure in the estate. Centralising it removes per-repo drift and makes a fix propagate.

## Solution
**hybrid.** The @theme inline bridge block and the semantic token names are genuinely identical across 20+ repos (webhouse/cms globals.css, webhouse/contract-manager globals.css, webhouse/webhouse-site globals.css, webhouse/buddy styles.css, broberg/upmetrics styles.css). The CSS token baseline qualifies as a copy-owned scaffold template; the headless theme-store (persist + apply + subscribe, identical to trail/apps/admin/src/theme.ts) qualifies as a runtime-package. The @theme inline bridge MUST be copy-owned per app because Tailwind v4 resolves it at build time and it cannot be @imported from node_modules. So: headless TS engine as runtime-package, CSS baseline as copy-owned scaffold template.

(Headless-core/adapter split is detailed under Architecture.)

## Scope

### In scope
- Extract from `webhouse/cms` `packages/cms-admin/src/app/globals.css` (token set + @theme bridge + 5 data-theme variants).
- Extract the headless store from `broberg/trail` `apps/admin/src/theme.ts`.
- The framework-agnostic headless core + thin per-stack adapters.

### Out of scope
- Per-brand visual divergence (each app overrides --primary/--radius locally).
- Big-bang migration (strangler only — see Rollout).
- Component libraries that consume the tokens (F015/F016/F017).

## Architecture

### Best source (reference implementation)
`webhouse/cms` — `packages/cms-admin/src/app/globals.css`: dark-first :root oklch token set (lines 8-34), @theme inline bridge (lines 36-64), five named data-theme variants (lines 67-209), @custom-variant dark (&:is([data-theme^='dark'] *)).

### Other implementations seen (contract cross-check)
- `webhouse/contract-manager` `app/globals.css` — 478-line, five variants in HSL, status-color tokens + extended brand palette. Reference for domain status-token extension.
- `broberg/trail` `apps/admin/src/theme.ts` — cleanest headless theme-store (initTheme/getTheme/setTheme/toggleTheme/onThemeChange, localStorage + pub/sub, no React/next).
- `webhouse/buddy` `apps/web/src/styles.css` — @theme dark defaults + html.light override; simpler two-mode alternative.
- `cbroberg/codepromptmaker` `packages/web/src/components/theme-toggle.tsx` — cleanest Stack A toggle (next-themes + mounted-guard + Sun/Moon/Monitor + DropdownMenu).

### Headless core vs. adapters
- **Core (no React, no `next/*`):** runtime theme state — initTheme(opts?), getTheme(), setTheme(key), toggleTheme(), onThemeChange(fn); extensible ThemeKey union ('light'|'dark'|'light-cool'|'light-warm'|'dark-cool'|'dark-warm'); SSR-safe (DOM/localStorage behind typeof guards, trail pattern).
- **Stack A (Next.js 16/React 19/Tailwind v4/shadcn):** ThemeProvider (next-themes), @theme inline block in globals.css, ThemeToggle component; adapter re-exports the headless store as a useTheme shim.
- **Stack B (Bun/Hono/Preact/Tailwind v4):** no next-themes — thin Preact useTheme over onThemeChange; identical CSS baseline; no next/* imports.

### Public API
```ts
// @broberg/tokens — headless core
export type ThemeKey = 'light' | 'dark' | 'light-cool' | 'light-warm' | 'dark-cool' | 'dark-warm';
export function initTheme(opts?: { defaultTheme?: ThemeKey; followSystem?: boolean }): void;
export function getTheme(): ThemeKey;
export function setTheme(key: ThemeKey): void;
export function toggleTheme(): ThemeKey;
export function onThemeChange(fn: (key: ThemeKey) => void): () => void;
export const BASELINE_CSS_PATH: string; // copy-owned neutral preset .css
// @broberg/tokens/react — ThemeProvider, useTheme, ThemeToggle
// @broberg/tokens/preact — useTheme
```

## Stories
- **F001.1** — Extract and publish headless theme-store package — _AC:_ @broberg/tokens exports init/get/set/toggle/onChange; SSR-safe; unit tests cover persistence, pub/sub, system-preference; published to the pnpm workspace.
- **F001.2** — Ship CSS baseline template (neutral shadcn-compatible preset) — _AC:_ neutral-preset.css (from cms globals.css lines 1-214) declares :root dark-first tokens + 5 data-theme variants + @theme bridge; README shows the exact 3 lines to add to an app's globals.css.
- **F001.3** — Stack A React adapter (ThemeProvider + ThemeToggle) — _AC:_ ThemeProvider wraps layout, useTheme returns theme+setTheme, ThemeToggle renders a mounted-guard Sun/Moon/Monitor dropdown with data-testid; no hydration mismatch; confirmed in Next.js 16 (pilot cms).
- **F001.4** — Stack B Preact adapter — _AC:_ useTheme Preact hook subscribes via onThemeChange; no next/* imports; confirmed in a Bun/Hono/Preact app (pilot upmetrics or cardmem).
- **F001.5** — Pilot adoption in webhouse/cms — _AC:_ cms globals.css imports the baseline + overrides only the CMS gold primary; the 5-variant system still works; no visual regression (Lens baseline pass).
- **F001.6** — Document brand-override pattern — _AC:_ components CLAUDE.md section: import baseline, override --primary/--radius in :root; worked examples for a warm-palette brand and a dark-first brand.

## Acceptance criteria
1. `@broberg/tokens` builds + typechecks clean (`tsc --noEmit`); the headless core imports no framework packages.
2. Every story above (F001.1–F001.6) meets its own AC.
3. Piloted in **cms** and adopted back with no behavioural regression (Lens / runtime-verified, not just curl).
4. At least one second consumer has migrated onto the shared package with identical behaviour.

## Dependencies
- External: tailwindcss (v4, peer)
- External: next-themes (optional, Stack A adapter only)

## Rollout
Strangler: 1) extract headless store from trail theme.ts → @broberg/tokens core; 2) extract the neutral CSS baseline from cms globals.css as the copy-owned template; 3) Stack A adapter wrapping next-themes + ThemeToggle from codepromptmaker; 4) publish; 5) pilot in cms (owns the best impl — trivial); 6) adopt in contract-manager (validates 5-variant path); 7) spread to ~18 repos as they next touch globals.css.

Graduate-candidate: no — small core npm that stays in `components`.

## Open Questions
- Bare names (--background, shadcn) vs prefixed (--color-background, contract-manager/cardmem)? Align with shadcn bare names to reduce friction.
- Five data-theme variants vs two (light/dark)? Make the extra variants opt-in?
- Is next-themes a hard dep for Stack A, or wrap the headless store directly for smaller bundles?
- Distribute per-project brand tokens as named preset files or always local overrides?

## Effort estimate
**M** — owner session: `cms`. Reuse model: hybrid.

## Risks
Token naming divergence (bare vs prefixed names in active use across the estate) requires a one-time rename in ~half the repos or shipping both conventions. Color-space divergence (oklch vs hsl). The @theme inline block CANNOT be @imported from node_modules in Tailwind v4 — every app must copy-own the bridge block, so the copy step is non-negotiable and can drift.
