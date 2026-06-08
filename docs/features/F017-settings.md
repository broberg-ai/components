# F017 — Settings — Tabbed Config Shell with Section Panels

> L2 Shell · hybrid · effort **M** · impact **high** · owner `cms`. Status: Backlog.
> Graduate-candidate: no — stays in `components`.

## Motivation
A full-page settings surface organising config into labelled tabs (General, Team, AI, Email, Deploy, …) where each tab renders one or more named section panels. The shell owns the tab strip, action bar, dirty-tracking, and global Save; individual panels own their fetch/persist. Used for admin app-config (cms, trail, xrt81, cardmem, buddy, cpmaker) and user account/preference pages (trail account, fysiodk profile). The invariant everywhere: Card container → SectionHeading → fields (InputRow/Toggle/CustomSelect), no native controls, toast feedback after every mutation.

## Solution
**hybrid.** The structural primitives (SettingsCard, InputRow, Toggle, SectionHeading, SettingsSaveButton, dirty-event bus) are ~identical across cms, trail, xrt81, cardmem, buddy — same card/row/toggle grammar + dirty→save flow → runtime-package. The section panels (AI keys, deploy targets, mail templates, cost dashboards) are deeply domain-specific and differ per repo → copy-owned. So: headless primitives + dirty-bus as a package; panels copy-owned using the shared primitives.

## Scope

### In scope
- Extract from `webhouse/cms` `packages/cms-admin/src/components/settings/{settings-card,settings-save-button,general-settings-panel}.tsx` + `app/admin/(workspace)/settings/page.tsx`.
- Headless core (dirty-bus, generateSecret, copyToClipboard) + React + Preact primitive sets + tab-strip.

### Out of scope
- Domain-specific panels (copy-owned per repo).
- Each repo's persistence/fetch logic.

## Architecture

### Best source (reference implementation)
`webhouse/cms` — `packages/cms-admin/src/components/settings/` + `settings/page.tsx`: only repo with fully extracted named primitives (SettingsCard/Input/SaveButton/AnchorScroll) + a documented custom-event dirty bus (cms:settings-dirty/save/saved) + 14 panels spanning every category. Most complete tab-strip + ActionBar + per-panel data-testid.

### Other implementations seen
- `broberg/trail` `apps/admin/src/panels/{settings-account,settings-trail}.tsx` — best Preact/Stack B ref (Section/Field/Toggle + sticky anchor-nav + useStored + GenerateKeyModal).
- `broberg/xrt81` `apps/web/src/routes/Indstillinger.tsx` — richest single-file Stack B settings (per-tenant colour presets, AI toggles optimistic, BYOK slots, mail-template live preview, double-confirm broadcast).
- `broberg/cardmem` `apps/web/src/components/settings.tsx` — multi-tab Preact with PageTabs (no next/navigation), MCP key mgmt, SSE LivePill.
- `webhouse/buddy` `apps/web/src/pages/settings.tsx` — live runtime-diagnostic snapshot + config mix.

### Headless core vs. adapters
- **Core (no React/next/Preact):** dirty-bus (subscribe/markDirty/markSaved/requestSave over window CustomEvent in browser, callbacks in SSR/test); useStored interface; generateSecret (crypto.getRandomValues → hex, duplicated in cms + xrt81); copyToClipboard (1500ms reset).
- **Stack A (Next/React/shadcn):** useDirtyBus/useStored hooks; SettingsCard/Input/Toggle/SectionHeading React components (var(--card/border/primary)); SettingsSaveButton (dimmed/full/spinner driven by bus); SettingsAnchorScroll; tab strip as ?tab= Link hrefs (no next/navigation in primitives).
- **Stack B (Bun/Hono/Preact):** Preact hooks over the core; same visual primitives; tab strip via window.history/popstate (cardmem settingsTabFor); Section/Field two-column grid (trail 180px label).

### Public API
```ts
export { markDirty, markSaved, requestSave, onDirtyBus, generateSecret, copyToClipboard };
// '@broberg/settings/react' → useDirtyBus, useStored, SettingsCard, SettingsInput, SettingsToggle, SectionHeading, SettingsSaveButton
// '@broberg/settings/preact' → same surface, Preact types
```

## Stories
- **F017.1** — Extract dirty-bus core + shared logic from cms — _AC:_ core.ts exports markDirty/markSaved/requestSave/onDirtyBus/generateSecret/copyToClipboard, zero browser/React/Preact imports; tests cover bus lifecycle (dirty→save→saved→clean); generateSecret(32) → 64-char hex.
- **F017.2** — React adapter: SettingsCard/Input/Toggle/SectionHeading/SaveButton — _AC:_ match cms visual output; SaveButton shows dimmed/full/spinner from the bus; data-testid settings-save-button/settings-input-field/settings-input-copy-button/toggle-button; Lens smoke on cms dev.
- **F017.3** — Preact adapter mirroring the React surface — _AC:_ Preact components; useDirtyBus + useStored match trail useStored signature; two-column grid matches trail tokens; no next/* imports.
- **F017.4** — useStored hook with localStorage persistence — _AC:_ reads on mount, writes on update, survives reload, silent fallback when localStorage throws; both adapters; matches trail settings-account.tsx.
- **F017.5** — Tab-strip component (React + Preact) — _AC:_ React uses ?tab= anchor Links (no next/navigation); Preact uses history+popstate (cardmem); active tab border-b-2 border-primary; data-testid=settings-tab-{id}.
- **F017.6** — Migrate cms back onto the package + Lens baseline — _AC:_ cms removes inline SettingsCard/SaveButton/dirty-bus/Toggle, imports from @broberg/settings/react; build passes; Lens captures all 14 settings-panel-* testids + approves baseline.

## Acceptance criteria
1. @broberg/settings builds + typechecks clean; headless core imports no framework packages.
2. Each story (F017.1–F017.6) meets its own AC.
3. Piloted in cms and adopted back with no regression (Lens / runtime-verified).
4. A second consumer (trail or xrt81) migrates onto the shared package with identical behaviour.

## Dependencies
- F001 — Design tokens (blocks). F015 mode-switch (related). F016 ui-controls (related).

## Rollout
Strangler: 1) extract primitives + dirty-bus from cms settings/; 2) wire cms back, confirm 14 panels pass Lens; 3) publish; 4) adopt trail (Preact) replacing inline Section/Field/Toggle; 5) adopt xrt81; 6) cardmem/buddy/cpmaker on next touch. Never big-bang.

Graduate-candidate: no — stays in `components`.

## Open Questions
- dirty-bus: module-level EventEmitter (SSR-safe) or window CustomEvent only (cms ActionBar↔panel broadcast relies on window)?
- SaveButton 5s safety timeout — configurable or removed for explicit markSaved()?
- Token-name divergence (--border vs --color-border) — tokens prop or required aliases?
- Tab-strip in scope, or each app owns nav and only panel primitives shared?

## Effort estimate
**M** — owner session: `cms`. Reuse model: hybrid.

## Risks
cms dirty-bus uses window CustomEvents as a broadcast channel between ActionBar + panels in separate React subtrees — moving to a module-level emitter changes the boundary; panels using formRef.requestSubmit() must be re-tested. React + Preact adapters need identical CSS var names but Preact repos define their own (--color-border vs --border) — token-map prop or documented aliases. cms general-settings-panel inlines its own Card/Toggle alongside shared imports — consolidate without visual change (Lens diff approval before deleting old code).