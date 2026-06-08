# F023 — Mail Templates

> L3 Domain · copy-owned · effort **M** · impact **high** · owner `sanneandersen`. Status: Backlog.
> Graduate-candidate: no — stays in `components`.

## Motivation
A library of typed TS functions each returning { subject, html, text } for one transactional/marketing email. Every function composes a shared HTML shell (branded wrapper, dark-mode guards, preheader, footer) with template-specific body blocks built from primitives (heading, paragraph, cta, signOff, escapeHtml). Copy strings resolve from a keyed registry with coded defaults + optional operator-editable overrides (flat JSON file — sanneandersen; or DB table keyed by tenant — xrt81). No send responsibility — callers pass the returned object to F005's sender.

## Solution
**copy-owned.** The shell + primitives (escapeHtml, heading, paragraph, cta, fill) are genuinely identical across repos → a thin runtime package (@broberg/mail-core). But the template functions are not: each repo has a different set of keys, brand tokens (SA warm-sand vs xrt81 clay/olive), locale strategy, and override backing (JSON file vs DB). A monolithic package would impose one brand/locale or become a heavy framework. So: extract @broberg/mail-core (shell + primitives), copy template files per repo.

## Scope

### In scope
- Extract from `webhouse/sanneandersen` `site/src/lib/mail-templates/{shell,registry}.ts` + `mail-overrides.ts` + sample template files.
- @broberg/mail-core (renderShell + primitives + fill/fillMerge + makeLogoAttachment + isMailAllowed + OverrideStore interface) + file/DB override-store adapters.

### Out of scope
- Per-repo template files / brand tokens / locale strategy (copy-owned).
- Sending (F005 owns it; core has no Resend dep).

## Architecture

### Best source (reference implementation)
`webhouse/sanneandersen` — `site/src/lib/mail-templates/shell.ts` (CID logo, dark-mode [data-ogsc] Outlook fallback, brand fonts, primitives heading/paragraph/signOff/fill/escapeHtml/Attr) + `registry.ts` (single-source copy with bilingual defaults) + `mail-overrides.ts` (file-backed, 30s TTL cache + invalidate hook) + 18 template files / 11 registry entries.

### Other implementations seen
- `broberg/xrt81` `apps/server/src/lib/{mail-templates,mail}.ts` — DB-backed multi-tenant override: resolveMailTemplate() falls back to coded defaults, renderMailBody() {{token}} substitution + RICH_MAIL_FIELDS pre-escaped injection, renderMailPreview() iframe; emailShell() parameterised per tenant clubName/tagline.
- `cbroberg/pitch` `lib/email/templates/*.ts` — minimal inline-HTML (no shell/registry) — the copy-owned-without-core counter-example.
- `webhouse/contract-manager` `lib/email/send.ts` + `components/email-template-editor.tsx` — DB-persisted {{variable}} templates + WYSIWYG editor + test-send.

### Headless core vs. adapters
- **Core (@broberg/mail-core, no React/next):** renderShell(opts) (preheader, brand slots logoUrl/colors/fonts, dark-mode CSS, footer); heading/paragraph/cta/signOff/factBox; escapeHtml/escapeAttr; fill (token) + fillMerge ({{token}} + RICH_FIELDS); makeLogoAttachment(filePath); isMailAllowed(to,{live,allowlist}); types TemplateField/TemplateDef/OverrideStore. No Resend.
- **Stack A (Next):** getLogoAttachment from process.cwd()/public/uploads; FileOverrideStore (content/*.json, 30s TTL + invalidateCache()); admin editor (shadcn Textarea + iframe preview); test-send via route handler.
- **Stack B (Bun/Hono):** DrizzleOverrideStore (bun:sqlite mail_templates table tenant_id+key+subject+body); resolveMailTemplate(db,tenantId,key) async; admin editor as Hono route + Preact UI; logo via Bun.file().

### Public API
```ts
export function renderShell(opts: ShellOpts): string;
export function heading(t): string; export function paragraph(t): string; export function cta(href,label,color?): string; export function signOff(l1,l2,sig): string; export function factBox(lines): string;
export function escapeHtml(s): string; export function escapeAttr(s): string;
export function fill(t, vars): string; export function fillMerge(t, vars, richFields?): string;
export function makeLogoAttachment(filePath): Attachment|null; export function isMailAllowed(to,{live,allowlist}): boolean;
export interface OverrideStore { resolve(key, locale?): Promise<ResolvedTemplate> }
// each repo owns templates/ + registry + override store; core ships SA_BRAND/XRT81_BRAND presets
```

## Stories
- **F023.1** — Extract @broberg/mail-core (renderShell + primitives) — _AC:_ exports renderShell/heading/paragraph/cta/signOff/factBox/escapeHtml/escapeAttr/fill/fillMerge/makeLogoAttachment/isMailAllowed; zero framework deps; typed; render smoke-test produces valid HTML with no broken cid: refs.
- **F023.2** — Migrate sanneandersen shell.ts onto core — _AC:_ shell.ts imports renderShell + primitives; SA palette moved to brand.ts + passed as BrandColors; all 18 templates compile + render identical HTML (snapshot diff shows only import-path changes).
- **F023.3** — Migrate xrt81 emailShell + renderMailBody onto core — _AC:_ mail.ts uses renderShell; renderMailBody replaced by fillMerge + RICH_MAIL_FIELDS; all send functions type-check + smoke-send to MAIL_ALLOWLIST.
- **F023.4** — OverrideStore interface + file + DB adapters — _AC:_ core exports OverrideStore { resolve(key, locale?): Promise<ResolvedTemplate> }; FileOverrideStore (JSON + TTL + invalidate) ships Stack A; DrizzleOverrideStore ships Stack B; sanneandersen uses file, xrt81 uses drizzle.
- **F023.5** — Render smoke-test suite for @broberg/mail-core — _AC:_ covers renderShell ShellOpts combos (preheader/footer/cid-vs-hosted), fill/fillMerge known/unknown tokens + rich-field injection, isMailAllowed MAIL_LIVE + allowlist; bun test, no DOM dep.
- **F023.6** — Document BrandColors + SA/xrt81 preset exports — _AC:_ brands.ts exports SA_BRAND + XRT81_BRAND from existing hex; README 10-line usage example; repos import the preset rather than duplicating hex.

## Acceptance criteria
1. @broberg/mail-templates builds + typechecks clean; headless core imports no framework packages.
2. Each story (F023.1–F023.6) meets its own AC.
3. Piloted in sanneandersen and adopted back with no regression (Lens / runtime-verified).
4. A second consumer (xrt81) migrates onto the shared package with identical behaviour.

## Dependencies
- F005 — Mail sending (blocks). F001 tokens (related). External: resend (consumer peer), drizzle-orm (Stack B override store).

## Rollout
Strangler: 1) extract @broberg/mail-core from sanneandersen shell.ts + primitives (no brand baked in); 2) pilot sanneandersen (18 templates pass render smoke-test); 3) publish workspace package; 4) adopt xrt81 (collapse emailShell + renderMailBody to core); 5) adopt trail/pitch/cdn-platform/contract-manager opportunistically.

Graduate-candidate: no — stays in `components`.

## Open Questions
- Ship a validateBrandColors() WCAG-AA contrast checker that fails loudly?
- File-backed override store is Fly-volume-only — mark Stack-A-only + push Vercel/CF users to DB-backed?
- xrt81 live iframe preview needs renderShell without a DB — sample-values-only preview fn in core or app-owned?
- Migrate pitch/cdn-platform/contract-manager inline templates opportunistically or only when touched?

## Effort estimate
**M** — owner session: `sanneandersen`. Reuse model: copy-owned.

## Risks
Shell HTML complexity: sanneandersen's 165-line table-layout shell with dark-mode + Outlook [data-ogsc] overrides is hard-won — abstracting BrandColors risks callers passing insufficient-contrast values that break dark-mode guards; ship validated presets. CID logo path (process.cwd()/public/) must be passed explicitly (caller supplies full filePath). Two backing stores (JSON file vs DB) share an async interface — the file store must be async too. Scope creep: resist absorbing a send() (provider-specific; stays in F005).