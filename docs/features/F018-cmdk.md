# F018 — CMD+K Command Palette

> L2 Shell · copy-owned · effort **M** · impact **high** · owner `cms`. Status: Backlog.
> Graduate-candidate: no — stays in `components`.

## Motivation
A modal overlay, triggered by Cmd+K/Ctrl+K anywhere, presenting a single search input with a grouped, keyboard-navigable result list. The user types to filter static quick-actions + dynamic data (nav targets, entities, context-switches), then activates with Enter or click. Every active repo independently hand-built this — 6+ implementations — making it the single most duplicated shell-level component in the fleet.

## Solution
**copy-owned.** The headless interaction logic (keyboard handler, debounced search, flat-index highlight, recents store) is ~identical across all 6 repos, but the items fed in are entirely app-specific (cms: permission-gated nav + site/org switch; cardmem: cards/epics/plan-docs + request-seq dedup; trail: trails + tenant-switch; xrt81: lazy members/songs/photos). Items churn is HIGH (cms added workflows/templates/favorites incrementally), so locking a package API to items would cause constant cross-repo version churn. Right call: ship the shell + core primitives as a shared package, but items are always consumer-defined and passed in.

## Scope

### In scope
- Extract from `webhouse/cms` `packages/cms-admin/src/components/command-palette.tsx`.
- Headless core (6 primitives) + React + Preact presentational shells.

### Out of scope
- Per-repo items/commands arrays (always consumer-defined).
- Item rendering opinions beyond PaletteItem shape.

## Architecture

### Best source (reference implementation)
`webhouse/cms` — `packages/cms-admin/src/components/command-palette.tsx`: permission-gated items, localStorage favorites, dynamic org/site/collection/workflow/template switching, debounced content search (180ms), grouped rendering + section headers, Highlight, full ARIA testids, CommandPaletteProvider + CommandPalette(onClose) split, global ESC, scrollIntoView, footer kbd hints.

### Other implementations seen
- `broberg/cardmem` `apps/web/src/components/command-palette.tsx` — debounce with request-seq dedup (stale-result guard), exact-search toggle, versioned recents key, body-scroll-lock hook, project-switch.
- `broberg/trail` `apps/admin/src/components/ui/command-palette.tsx` — cleanest Group{title,items[]} model + flat running index; Preact/Stack B ref.
- `broberg/xrt81` `apps/web/src/components/ui/CommandPalette.tsx` — lazy-load datasets on first open, lyrics-aware (strip HTML) search; heaviest consumer.
- `cbroberg/pitch` `components/global-command-palette.tsx` — only repo on the external cmdk v1.1 lib (shadcn CommandDialog); viable drop-in for minimal Stack A.

### Headless core vs. adapters
- **Core (no React/Preact/next):** useCommandPalette (open state + Cmd+K listener); useKeyboardNav (selectedIndex + Arrow/Enter/Escape); useDebouncedSearch (request-seq guard, cardmem pattern); fuzzyFilter (static set); recentsStore (versioned localStorage key, quota-safe); useBodyScrollLock. EventTarget shim for SSR.
- **Stack A (Next/React/shadcn):** re-exports core + CommandPaletteProvider (portal + global shortcut), CommandPalette (backdrop, Search input, results list, footer kbd hints, Highlight), ResultRow, SectionHeader; useRouter for href items; var(--card/border/accent/muted-foreground) styling; items passed by consumer; optional shadcn CommandDialog wrapper (pitch).
- **Stack B (Bun/Hono/Preact):** same core bound to preact/hooks; preact-iso useLocation().route() nav; Preact shell; body-scroll-lock; no next/* imports.

### Public API
```ts
export { useCommandPalette, useKeyboardNav, useDebouncedSearch, fuzzyFilter, recentsStore, useBodyScrollLock };
export type { PaletteItem, PaletteGroup };
// '@broberg/cmdk/react' → CommandPaletteProvider, CommandPalette, ResultRow, SectionHeader, KbdHint, Highlight
// '@broberg/cmdk/preact' → same (no Highlight)
// PaletteItem { id,label,sublabel?,category,icon?,href?,action?,keywords?,featured?,newTab? }
```

## Stories
- **F018.1** — Extract headless core into @broberg/cmdk/core — _AC:_ useCommandPalette/useKeyboardNav/useDebouncedSearch/fuzzyFilter/recentsStore/useBodyScrollLock; zero React/Preact/next imports; tests: keyboard nav wraps at boundaries, Enter fires onActivate, Escape closes; recentsStore dedups + respects maxItems + swallows quota errors.
- **F018.2** — Stack A React shell — _AC:_ CommandPaletteProvider + CommandPalette accept items: PaletteItem[]; grouped section headers, Highlight, footer kbd hints, backdrop-click-close; data-testid command-palette-backdrop/search-input/item-{id}/close (cms convention); Lens baseline green.
- **F018.3** — Pilot Stack A shell back in cms — _AC:_ cms imports Provider+Palette from @broberg/cmdk/react; local quickActions array stays in cms; existing Lens baseline passes; permission-gated items + favorites + site/org switching still work.
- **F018.4** — Stack B Preact shell — _AC:_ Provider+Palette from @broberg/cmdk/preact (preact/hooks + preact-iso); no next/* imports; Lens smoke: open, type, arrow-nav, Enter navigates, Esc closes.
- **F018.5** — Adopt in trail + cardmem — _AC:_ both replace inline palette with @broberg/cmdk/preact + local items; body-scroll-lock active; cardmem recents persist; Lens green on both.
- **F018.6** — testid-gap audit + Lens smoke flow in CI — _AC:_ a cardmem-lens flow runs on PRs touching palette files in adopted repos (open Cmd+K, type, verify a row, arrow down highlight moves, Esc closes); testid-gaps returns 0.

## Acceptance criteria
1. @broberg/cmdk builds + typechecks clean; headless core imports no framework packages.
2. Each story (F018.1–F018.6) meets its own AC.
3. Piloted in cms and adopted back with no regression (Lens / runtime-verified).
4. A second consumer (trail or cardmem) migrates onto the shared package with identical behaviour.

## Dependencies
- F001 — Design tokens (blocks).
- External: lucide-react (Stack A), preact + preact-iso (Stack B), next/navigation (Stack A useRouter), cn/clsx.

## Rollout
Strangler: 1) extract core hooks from cms palette → @broberg/cmdk/core @0.1; 2) Stack A shell (cms reference, preserve testids/ARIA); 3) pilot back in cms (items stay local), Lens baseline; 4) Stack B shell (trail reference, preact/hooks + preact-iso); 5) adopt trail; 6) spread to cardmem/xrt81/whop; pitch adopts last or stays on shadcn CommandDialog.

Graduate-candidate: no — stays in `components`.

## Open Questions
- Stack A: expose a shadcn CommandDialog variant (pitch) alongside the hand-rolled shell, or single canonical shell?
- fuzzyFilter support exact mode (cardmem exact:boolean) or is exact a consumer/fetcher concern?
- recentsStore: package-owned default key scheme or consumer passes the key (avoids collisions)?
- xrt81 lazy-loads big datasets on first open — model as a data-provider callback so the package doesn't dictate fetch timing?

## Effort estimate
**M** — owner session: `cms`. Reuse model: copy-owned.

## Risks
Items diversity: if the package owns item rendering it grows uncontrollable — keep it shell+core only, items always consumer-passed. Stack B nav coupling (preact-iso vs window.history vs preact-iso) — item.action() is the escape hatch. cms palette currently uses inline style objects — porting to Tailwind v4 var(--*) tokens needs a one-time audit against @broberg/tokens.