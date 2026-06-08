# F034 — User Menu (account dropdown + quick-prefs)

> L2 Shell · copy-owned (thin headless menu-state core + per-stack scaffolds) · effort **M** · owner `cms` (React pilot) / `xrt81` (Preact pilot). Status: Backlog.
> The navbar avatar → dropdown that every app re-implements: identity header + inline quick-prefs + nav links + sign-out. **Composition** component — it wires existing primitives (F012/F013 avatar, F015 theme, F019 language, F016 popover, F008/F009 auth); it does not rebuild them. The full Account Settings *page* is **F017**, not here.
> Graduate-candidate: **no** — small app-shell component, stays in `components`.

## Motivation
Every app grows the same avatar-anchored dropdown, and they are ~80% identical plumbing under visibly different chrome: an identity header (avatar + name + email + an org/context line), a row of inline quick-preference toggles (theme, language, ambient/palette), a few nav links into settings, and a sign-out action. Today each repo re-implements the wiring — cms via Radix + a two-axis theme hook, xrt81 hand-rolled in Preact with theme+language, cardmem a minimal Better-Auth skeleton. The divergence is cosmetic; the contract is not. Capturing the menu as a composition component (two copy-owned scaffolds + a thin headless state core) lets a new app drop in a vetted dropdown wired to the shared theme/lang/profile/auth packages instead of rebuilding it.

## Best source (reference implementation)
`webhouse/cms`:
- `packages/cms-admin/src/components/admin-header.tsx` — `UserNav` (lines 102-169) + inline `ThemeItems` (lines 51-100). Radix `DropdownMenu`, shadcn `Avatar` trigger (Gravatar/initials), permission-gated nav links (Account Preferences → `/admin/account`, Site Settings, Organization Settings), two-axis theme (brightness × temperature) via `useThemeAxes`, `logout()`. `data-testid` on every interactive element.
- `packages/cms-admin/src/lib/hooks/use-theme-axes.ts` — wraps `next-themes` into a two-axis theme string.
- `packages/cms-admin/src/lib/header-data-context.tsx` — identity via an `/api/auth/me` context.

Why this source: most complete + accessible (Radix keyboard/focus/Escape), permission-gated links, two-axis theme, testid coverage, identity-via-context rather than prop-drilling.

## Other implementations (contract cross-check)
- `broberg/xrt81` — `apps/web/src/components/ui/UserMenu.tsx` (Preact, Stack B): the only source with BOTH theme AND language inline. Theme via `lib/theme.ts` (localStorage `xrt81-theme` + `data-theme`), language via `lib/i18n.tsx` `useLang()`. 3-tier `Avatar.tsx` (uploaded → Gravatar SHA-256 → initials). Hand-rolled popover (`useState` + outside-click/Escape `useEffect`). Nav: Konto & profil, Klub-indstillinger (owner-gated), Brugerguide. Identity via props from `Shell.tsx`. Reference for bilingual quick-prefs UX + the Stack-B (no-Radix) popover + the avatar fallback chain.
- `broberg/cardmem` — `apps/web/src/components/ui/user-menu.tsx` (Preact): cleanest minimal skeleton — pill trigger (avatar + first name + chevron), backdrop-div outside-click, `anim-menu`, strict Better-Auth `signOut()`. Reference for the lightweight Preact port + sign-out integration.
- `webhouse/buddy` — **no user menu** (internal tool, no auth; only a sidebar dark/light toggle). Confirms the menu is a per-app-auth concern, not universal — the scaffold must be optional/composable, never assumed.

## Scope
### In scope
- A thin **headless `useUserMenu`** (open/close + Escape + outside-click via F016 `makeOutsideClickHandler`; the item model: identity, prefs[], links[], onSignOut).
- **Stack A scaffold** (React/Radix, copy-owned) from cms `UserNav`.
- **Stack B scaffold** (Preact, copy-owned) from xrt81 `UserMenu` + cardmem skeleton.
- Wiring contracts to the existing primitives (avatar, theme, language, auth).
### Out of scope
- The Account Settings **page** (tabs, profile form, security, access tokens) → **F017**.
- Theme/language/avatar/auth internals → owned by F015/F019/F012-13/F008-09; this epic only *composes* them.
- Any single forced visual style — chrome is copy-owned per brand.

## Architecture
- **Headless core (no JSX):** a `useUserMenu`-style state hook — `open`/`setOpen`, Escape-to-close, outside-click wiring that delegates to F016 `makeOutsideClickHandler`, plus a typed config: `{ identity: { name, email, avatarUrl?, context? }, prefs: PrefControl[], links: MenuLink[], onSignOut: () => Promise<void> }`. No framework imports.
- **Stack A (React/Next/shadcn):** Radix `DropdownMenu` scaffold; `Avatar` trigger; renders identity header + `prefs` (theme via F015/`useThemeAxes`, language via F019) + permission-gated `links` (→ F017 pages) + sign-out. Copy-owned.
- **Stack B (Preact/Bun):** hand-rolled popover using the headless core; segmented theme + language toggles bound to the F015/F019 stores; 3-tier avatar. No `next/*`. Copy-owned.

### Public API (sketch)
```ts
export interface UserMenuIdentity { name: string; email: string; avatarUrl?: string; context?: string }
export interface PrefControl { key: string; label: string; options: {value:string;label:string}[]; value: string; onChange:(v:string)=>void }
export interface MenuLink { label: string; href: string; show?: boolean }
export function useUserMenu(opts: { onSignOut: () => Promise<void> }): { open: boolean; setOpen:(o:boolean)=>void; menuRef: unknown }
// @broberg/user-menu/react  -> <UserMenu identity prefs links onSignOut />  (copy-owned scaffold)
// @broberg/user-menu/preact -> mirror
```

## Stories
See cards **F034.1–F034.6** (each carries its own task + context + decomposed AC).

## Acceptance criteria
1. Headless core imports no framework packages; `tsc --noEmit` clean.
2. Every story F034.1–F034.6 meets its own AC.
3. Every interactive element across both scaffolds carries a kebab-case `data-testid`; Lens reports zero new gaps; no native dialog/control anywhere; sign-out shows a loading state.
4. Piloted in cms (React) and xrt81 (Preact) with no visual regression (Lens-verified, not curl).

## Dependencies
- F001 tokens · F008/F009 auth (sign-out) · F012 profile + F013 gravatar (avatar) · F015 mode-switch (theme) · F016 controls (`makeOutsideClickHandler`, popover) · F019 i18n (language). Links target **F017** (Account Settings page).

## Rollout
Strangler, never big-bang: 1) extract headless `useUserMenu` (reusing F016 outside-click). 2) React scaffold from cms `UserNav`; cms adopts back. 3) Preact scaffold from xrt81 `UserMenu`; xrt81 adopts back. 4) cardmem adopts the minimal Preact variant. 5) spread to new apps as they add auth.

## Risks
- Over-sharing trap: the chrome genuinely diverges (Radix vs hand-rolled, 1-axis vs 2-axis theme, with/without language). Keep the shell copy-owned; share only the state core + wiring contracts, or it forces one framework/style on everyone.
- Identity source differs per app (cms context / xrt81 props / cardmem Better-Auth `useSession`). The scaffold MUST accept identity as input, never fetch it itself.
- Permission-gating (Site/Org Settings) is app-specific — expose `show?` per link, do not hardcode.

## Open Questions
- Do quick-prefs belong in the menu for every app, or only links? Make `prefs` optional (cardmem shows none).
- Two-axis theme (cms brightness×temperature) vs one-axis (xrt81 light/dark): should PrefControl support grouped/multi-axis, or ship two separate controls?
- Should sign-out confirmation be part of the scaffold (custom modal via F016) or left to the app?
