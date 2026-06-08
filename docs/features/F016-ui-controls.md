# F016 — Toasts / Modals + Custom Controls (CustomSelect, DatePicker, ConfirmModal)

> L2 Shell · copy-owned · effort **M** · impact **high** · owner `cms`. Status: Backlog.
> Graduate-candidate: no — stays in `components`.

## Motivation
A suite of UI primitives that replaces every native browser control the estate forbids: window.alert/confirm/prompt, native <select>, native date inputs. Four families — CustomSelect (accessible portal listbox, keyboard-nav, generic over value), DatePicker/DateTimeInput (Monday-first Danish month-grid, text-field + calendar hybrid), Modal/ConfirmModal (scrim + ESC, danger/primary tone), Toast/ToastProvider (auto-dismiss, severity icons). All read from var(--*) tokens and carry data-testid for Lens. This is Christian's 'aldrig native dialoger eller form-controls' rule as a shared kit.

## Solution
**copy-owned.** All four families exist across 8+ repos but diverge on three axes that block a shared runtime package: (1) framework (React 19 vs Preact); (2) styling (inline CSS vars vs Tailwind vs CSS classes); (3) locale (Danish vs English labels). The headless logic (calendar arithmetic, outside-click, keyboard-nav FSM, toast queue) is shared + stable; the rendered shell is not. Runtime-package would force one framework + one styling approach, contradicting the Stack A/B split. So: headless core extracted once + two thin adapters (React + Preact) that import it; rendering stays local.

## Scope

### In scope
- Extract from `webhouse/cms` `packages/cms-admin/src/components/ui/{custom-select,custom-date-input,custom-datetime-input,sonner}.tsx`.
- Headless core (@broberg/ui-controls-core) + React + Preact adapters for all four families.

### Out of scope
- Per-brand visual divergence (copy-owned by design).
- CustomRangeSlider (separate card if needed).

## Architecture

### Best source (reference implementation)
`webhouse/cms` — `packages/cms-admin/src/components/ui/`: CustomSelect (fixed-position portal escaping overflow:hidden, auto up/down direction, arrow+Enter/Esc nav, per-option disabled, data-testid on trigger + options); CustomDateInput (typed text DD-MM-YYYY + YYYY-MM-DD, min/max, Today/Clear footer); CustomDateTimeInput; Sonner wrapper (next-themes, richColors, 4 severity icons, var(--*) overrides).

### Other implementations seen
- `broberg/cardmem` `apps/web/src/components/ui/custom-select.tsx` — most generic: createPortal to body, closes on ancestor scroll/resize, generic <T>, dot+hint per option, renderTrigger slot (best headless contract).
- `broberg/xrt81` `apps/web/src/components/ui/{Toast,Modal,DatePicker}.tsx` — cleanest Preact: Toast (escapeHtml, 2600ms, context), Modal (scrim+ESC, sticky close-X F054), DatePicker (simplest disabledDates).
- `webhouse/sanneandersen` `site/src/components/ui/confirm-modal.tsx` — best ConfirmModal: danger/primary tone, testIdBase, loading disables ESC.
- `broberg/upmetrics` `apps/web/src/components/ui/{toast,modal,datepicker}.tsx` — multi-toast stack, pinned-header modal, toLocaleDateString month label.

### Headless core vs. adapters
- **Core (no JSX):** calendar helpers (ymd, parseYmd, buildMonthGrid Monday-first, isInRange); makeOutsideClickHandler(refs,onClose); selectKeyReducer (Escape/Arrow/Enter/Space); ToastQueue class (push/dismiss/subscribe, framework-neutral); normalizeYmd (accepts YYYY-MM-DD, DD-MM-YYYY, D.M.YYYY). No react/preact/next/CSS imports.
- **Stack A (React/shadcn):** CustomSelect (createPortal, var(--*) inline, cms feature-set); CustomDateInput + CustomDateTimeInput; ConfirmModal (sanneandersen tone+loading+testIdBase); Toaster (thin sonner wrapper — don't reinvent). No next/navigation.
- **Stack B (Preact):** same core; preact/hooks + preact/compat createPortal; lucide-preact; ToastProvider array-based multi-toast (upmetrics); Modal scrim+ESC+pinned header; CustomSelect generic T; DatePicker month-grid. No sonner (React-only), no next/*.

### Public API
```ts
// @broberg/ui-controls-core
export { buildMonthGrid, ymd, parseYmd, isInRange, normalizeYmd, selectKeyReducer, makeOutsideClickHandler, ToastQueue };
export type { SelectOption, ToastItem, ToastKind };
// '@broberg/ui-controls-react' → CustomSelect, CustomDateInput, CustomDateTimeInput, Modal, ConfirmModal, Toaster, useToast
// '@broberg/ui-controls-preact' → same names, Preact generics
```

## Stories
- **F016.1** — Extract headless calendar + keyboard core — _AC:_ @broberg/ui-controls-core exports buildMonthGrid/ymd/parseYmd/isInRange/normalizeYmd/selectKeyReducer/makeOutsideClickHandler/ToastQueue; zero JSX imports; tests cover Monday-first padding, normalizeYmd DD-MM-YYYY vs YYYY-MM-DD, selectKeyReducer transitions.
- **F016.2** — React adapter: CustomSelect — _AC:_ matches cms feature-set (createPortal, auto up/down, close on ancestor scroll/resize, keyboard nav, per-option disabled+dot+hint, data-testid custom-select-trigger + custom-select-option-{value}); Lens reports no testid gaps on cms-admin.
- **F016.3** — React adapter: CustomDateInput + CustomDateTimeInput — _AC:_ typed text (normalizeYmd), calendar popover min/max, Today + Clear; DateTimeInput composes date+time; data-testid on field/calendar-trigger/prev/next/day/today/clear; Lens smoke on cms-admin.
- **F016.4** — React adapter: ConfirmModal + Toaster — _AC:_ tone (danger|primary), loading disables ESC, testIdBase → -confirm/-cancel; Toaster wraps sonner with next-themes + var(--*) overrides; no window.confirm/alert; demo page shows both.
- **F016.5** — Preact adapter: CustomSelect + DatePicker + Modal + ToastProvider — _AC:_ all import the core; CustomSelect createPortal (preact/compat) + scroll/resize close; DatePicker Monday-first + disabledDates + Danish labels; Modal scrim+ESC+sticky close-X; ToastProvider array-based 4s; validated in xrt81 replacing local copies, no regression.
- **F016.6** — Adopt into upmetrics + trail; Lens baseline all four — _AC:_ both import @broberg/ui-controls-preact; local copies deleted; Lens baselines (select open/close, datepicker nav, modal open/ESC, toast show/dismiss) approved; testid-gaps zero.

## Acceptance criteria
1. @broberg/ui-controls builds + typechecks clean; headless core imports no framework packages.
2. Each story (F016.1–F016.6) meets its own AC.
3. Piloted in cms and adopted back with no regression (Lens / runtime-verified).
4. A second consumer (xrt81 or upmetrics) migrates onto the shared package with identical behaviour.

## Dependencies
- F001 — Design tokens (blocks).
- External: sonner (Stack A Toaster), lucide-react/lucide-preact, next-themes (Stack A Toaster), preact/compat (Stack B portal).

## Rollout
Strangler: 1) extract headless core from cardmem CustomSelect (most generic) → @broberg/ui-controls-core, pilot in cms; 2) React adapter (cms select+date + sanneandersen confirm + sonner), validate cms-admin; 3) Preact adapter (xrt81 Modal/Toast + cardmem select), validate xrt81; 4) adopt upmetrics + trail; 5) spread to cardmem/sanneandersen/buddy on next touch. Leave old copies until verified per-repo.

Graduate-candidate: no — stays in `components`.

## Open Questions
- CustomSelect renderOption slot (cardmem dot+hint) generic or domain-specific?
- DatePicker dismiss-on-scroll: match CustomSelect (close on ancestor scroll)?
- ConfirmModal async onConfirm (internal loading) or caller-owned loading prop (sanneandersen)?
- CustomRangeSlider (cms) in this bundle or separate card?

## Effort estimate
**M** — owner session: `cms`. Reuse model: copy-owned.

## Risks
Portal z-index collisions (cms 9999, cardmem 1000, upmetrics 50/100) — zIndex prop default 9999. Sonner is React-only — Stack B uses hand-rolled ToastProvider (asymmetric API; document clearly). Calendar locale (cms English, xrt81/upmetrics Danish) — monthLabel(year,month,locale) wrapper, no baked-in locale. normalizeYmd ambiguity (03-04-2025) — preserve cms's 4-digit-year disambiguation rule exactly.