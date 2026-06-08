# F015 — Mode-switch (dark / light / system)

> L2 Shell · hybrid · effort **S** · impact **high** · owner `fysiodk-aalborg-sport`. Status: Backlog.
> Graduate-candidate: no — stays in `components`.

## Motivation
A three-state (light/dark/system) colour-mode selector that persists the user's choice, applies the correct class/data-attribute to the document root, respects prefers-color-scheme when 'system' is active, and avoids flash-of-unstyled-content (FOUC). Ships a framework-agnostic headless core + two thin UI adapters: Next.js 16/React 19 (wrapping next-themes) and Stack B (Preact, plain DOM). All controls carry semantic data-testid so Lens drives them without Playwright.

## Solution
**hybrid.** The headless logic (localStorage read/write, prefers-color-scheme detect, apply root attribute, pub/sub) is identical across trail theme.ts, xrt81 theme.ts, buddy layout.tsx, and the boilerplates-cms FOUC script — ~50-line pattern reinvented everywhere → runtime-package core. The UI binding differs: Next.js delegates to next-themes (SSR hydration + suppressHydrationWarning); Stack B owns the DOM toggle (Preact, html.light). Shipping next-themes inside the package is fine for Stack A but dead weight in Stack B. So: headless core (package) + per-stack UI adapters.

## Scope

### In scope
- Extract from `webhouse/fysiodk-aalborg-sport` `apps/web/src/components/{theme-provider,theme-selector}.tsx`; headless core from trail/xrt81 theme.ts.
- Add the missing system-follow MediaQueryList listener; FOUC_SCRIPT export; React + Preact adapters.

### Out of scope
- Five-variant named sub-themes (separate component on top).
- Per-tenant accent-ramp derivation (xrt81; future extension).

## Architecture

### Best source (reference implementation)
`webhouse/fysiodk-aalborg-sport` — `apps/web/src/components/{theme-provider,theme-selector}.tsx`: next-themes ThemeProvider with enableSystem; 3-mode ThemeSelector; useSyncExternalStore mount guard (correct SSR-safe pattern, beats useState+useEffect); data-testid theme-selector-light/dark/system.

### Other implementations seen
- `broberg/trail` `apps/admin/src/theme.ts` — best headless core (pub/sub Set, setAttribute data-theme, localStorage, SSR guard, ~50 lines; lacks system-follow — add matchMedia).
- `broberg/xrt81` `apps/web/src/lib/theme.ts` — near-identical + prefers-color-scheme in getTheme; per-tenant accent-ramp (future).
- `cbroberg/codepromptmaker` `theme-toggle.tsx` — cleanest Sun/Moon/Monitor dropdown (useState mount guard).
- `webhouse/buddy` `layout.tsx` + `styles.css` — best Stack B Preact ref (html.light, dark-first @theme).
- `webhouse/boilerplates-cms` `layout.tsx` — canonical FOUC inline script (reads localStorage, adds class before first paint).

### Headless core vs. adapters
- **Core (no React/next):** Mode='light'|'dark'|'system'; getMode/getResolvedMode (matchMedia)/setMode/applyMode (data-theme or class)/onModeChange (pub/sub)/initMode; FOUC_SCRIPT serialised inline script. Adds system-follow MediaQueryList listener so UI updates when OS flips while 'system'.
- **Stack A (Next/React/shadcn):** ModeProvider (next-themes wrapper, attribute=class, enableSystem, default system); ModeToggleDropdown (Sun/Moon/Monitor + shadcn DropdownMenu, useSyncExternalStore guard); ModeSelector (3-button segment from fysiodk); data-testid mode-toggle / mode-selector-{value}.
- **Stack B (Bun/Hono/Preact):** useMode() over onModeChange; ModeToggleButton (Sun/Moon, html.light, buddy pattern); initMode() before mount; no next-themes.

### Public API
```ts
export type Mode = 'light'|'dark'|'system'; export type ResolvedMode = 'light'|'dark';
export { getMode, getResolvedMode, setMode, applyMode, onModeChange, initMode, FOUC_SCRIPT };
// '@broberg/mode-switch/react' → ModeProvider, ModeToggleDropdown, ModeSelector
// '@broberg/mode-switch/preact' → useMode, ModeToggleButton
// all UI accepts optional storageKey + className
```

## Stories
- **F015.1** — Headless core module — _AC:_ getMode/getResolvedMode/setMode/applyMode/onModeChange/initMode/FOUC_SCRIPT; SSR-safe; system mode auto-updates via MediaQueryList; Bun tests pass; no React/next imports.
- **F015.2** — Stack B Preact adapter + buddy pilot — _AC:_ useMode + ModeToggleButton; buddy layout.tsx imports it, inline useTheme removed; data-testid='mode-toggle'; Lens smoke captures both states.
- **F015.3** — Stack A React adapter (next-themes) — _AC:_ ModeProvider + ModeToggleDropdown + ModeSelector; useSyncExternalStore guard prevents SSR mismatch; data-testid mode-selector-light/dark/system; no flash in fysiodk (Lens).
- **F015.4** — FOUC_SCRIPT export + boilerplate adoption — _AC:_ FOUC_SCRIPT injectable as raw <script> (suppressHydrationWarning on <html>); boilerplates-cms replaces its inline block with the import; Lighthouse a11y unchanged.
- **F015.5** — data-testid completeness (Lens-ready) — _AC:_ all controls in buddy/fysiodk/codepromptmaker carry mode-toggle / mode-selector-{value}; testid-gaps zero; Lens flow asserts resolved class/attr on <html>.
- **F015.6** — Estate rollout to 5 more repos — _AC:_ codepromptmaker, coverletter-generator, cdn-platform, whop, webhouse-site import the package; old files deleted; all build + CI pass; no Lens baseline regressions.

## Acceptance criteria
1. @broberg/mode-switch builds + typechecks clean; headless core imports no framework packages.
2. Each story (F015.1–F015.6) meets its own AC.
3. Piloted in fysiodk-aalborg-sport and adopted back with no regression (Lens / runtime-verified).
4. A second consumer (buddy) migrates onto the shared package with identical behaviour.

## Dependencies
- F001 — Design tokens (blocks).
- External: next-themes (Stack A peer), lucide-react, shadcn DropdownMenu (Stack A dropdown), Tailwind v4 (host).

## Rollout
Strangler: 1) extract headless core from trail/xrt81 theme.ts + add system-follow; 2) Stack B adapter, pilot buddy; 3) Stack A adapter (next-themes), pilot fysiodk; 4) publish; 5) spread to codepromptmaker/coverletter/cdn-platform/whop/webhouse-site (one-line swaps); 6) boilerplates-cms uses FOUC_SCRIPT.

Graduate-candidate: no — stays in `components`.

## Open Questions
- Expose next-themes attribute (class vs data-theme) as a prop, or standardise on class? (estate split: cms data-theme vs most class).
- Per-tenant accent-ramp (xrt81): separate component depending on mode-switch, or bundled?
- Five-variant named sub-themes (cms/contract-manager): accommodate here or a ThemeVariant layer on top?
- storageKey default: generic 'theme' or scoped '@broberg/mode'?

## Effort estimate
**S** — owner session: `fysiodk-aalborg-sport`. Reuse model: hybrid.

## Risks
FOUC if FOUC_SCRIPT isn't injected before hydration (visible flash). next-themes coupling in Stack A — if it drops Next 16 RSC support the adapter breaks (the headless core can replace it). Four different localStorage keys across the estate — the storageKey prop lets each app keep its key on migration. Preact system-follow: the MediaQueryList listener can't force a re-render without useMode subscribing — the unsubscribe must run in cleanup.