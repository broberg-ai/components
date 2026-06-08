# F014 — Consent / Cookie Banner

> L1 Identity · copy-owned · effort **M** · impact **medium** · owner `codepromptmaker`. Status: Backlog.
> Graduate-candidate: no — small core npm/scaffold that stays in `components`.

## Motivation
A bottom-anchored banner that fires on first visit when no prior consent exists, offering one-click Accept All, Opt Out, and a Privacy Settings modal with granular per-category toggles (Essential always-on; Analytics/Marketing optional). Consent state persists to localStorage (unauthenticated) or a user profile row (authenticated), with an audit event on every change. A separate in-app consent-wall variant (mandatory policy acceptance before access) uses the same headless state machine but renders as a blocking card. Policy versioning re-surfaces the banner when the policy version changes.

## Solution
**copy-owned.** Only codepromptmaker has the classic floating cookie banner; fysiodk has a richer authenticated consent-wall backed by Supabase. Two divergent patterns, not one stable shared impl. The UI is inherently site-specific (policy text, storage key, categories, brand tokens). A runtime-package would require so many props it buys nothing over copy-owned. Copy-owned lets each product own its policy copy + categories without waiting for a release. The scaffold ships a ready-to-edit starting point built on a small headless state-machine core.

## Scope

### In scope
- Extract from `cbroberg/codepromptmaker` `packages/web/src/components/cookie-consent.tsx`.
- Headless consent-manager core + Stack A (React/shadcn) + Stack B (Preact) banner/modal adapters + policy-versioning.

### Out of scope
- Per-product policy text, categories, brand tokens (copy-owned by design).
- Server-side consent persistence wiring (host app via onConsentChange callback).

## Architecture

### Best source (reference implementation)
`cbroberg/codepromptmaker` — `packages/web/src/components/cookie-consent.tsx`: complete banner+modal (getStoredConsent/storeConsent localStorage, Accept/Opt-out/Privacy-settings, granular Switch modal), zero external deps, 163 lines, directly copyable.

### Other implementations seen
- `webhouse/fysiodk-aalborg-sport` `apps/web/src/components/{privacy-banner,privacy-consent-required,privacy-policy-dialog}.tsx` + `content/privacy-policy.ts` + `supabase/migrations/00007_gdpr_consent.sql` — authenticated consent-wall: policy versioning (re-surface when outdated), audit logging (read/accept/marketing), server-persisted consent record shape (privacy_policy_accepted_at, version, marketing_consent). Coupled to next/navigation + Supabase — the right MODEL, not directly portable.

### Headless core vs. adapters
- **Core (no React/next):** ConsentRecord {essential:true, analytics, marketing, policyVersion, acceptedAt}; ConsentStorage interface (get/set/clear) + LocalStorageConsentStorage + MemoryConsentStorage (SSR); createConsentManager(storage, policyVersion) → {getConsent, setConsent, needsBanner, isOutdated, clearConsent}; CONSENT_CATEGORIES constant.
- **Stack A (Next/React/shadcn):** CookieBanner (floating, null if !needsBanner); ConsentModal (shadcn Dialog + Switch per non-essential category); useConsent hook (hasAnalytics/hasMarketing for conditional script loading); shadcn Button/Switch/Dialog, no native; data-testid on banner + toggles; PrivacyConsentGate blocking-card variant writing via an onAccept callback (no DB dep in the adapter).
- **Stack B (Bun/Hono/Preact):** Preact functional component on the same core; no shadcn; Preact signals; same HTML/Tailwind output so visuals match Stack A; zero next/* imports.

### Public API
```ts
export type ConsentRecord = { essential: true; analytics: boolean; marketing: boolean; policyVersion: string; acceptedAt: string };
export interface ConsentStorage { get(): ConsentRecord|null; set(r: ConsentRecord): void; clear(): void }
export function createLocalStorageConsentStorage(key: string): ConsentStorage;
export function createConsentManager(storage: ConsentStorage, currentPolicyVersion: string): { getConsent; setConsent; needsBanner; isOutdated; clearConsent };
// Stack A: CookieBanner({storageKey, policyVersion, privacyPolicyHref, categories?, onConsentChange?}); useConsent(key, version)
```

## Stories
- **F014.1** — Headless consent-manager core — _AC:_ exports ConsentRecord, createLocalStorage/MemoryConsentStorage, createConsentManager; needsBanner true when empty; isOutdated true when stored version differs; tests: empty/same-version/outdated/cleared.
- **F014.2** — Stack A CookieBanner — _AC:_ renders null when !needsBanner; first visit shows bottom panel with Accept All / Opt Out / Privacy Settings (data-testid cookie-banner-root/accept/optout/settings); Accept persists {analytics:true,marketing:true}; Opt Out persists false; no native alert/confirm; Lens baseline capture.
- **F014.3** — Stack A ConsentModal granular toggles — _AC:_ Privacy Settings opens shadcn Dialog; Essential row disabled Switch (always on); analytics/marketing Switch default to stored value; Confirm saves, Cancel discards; data-testid consent-toggle-analytics/marketing; not a native dialog.
- **F014.4** — useConsent hook + onConsentChange — _AC:_ hasAnalytics/hasMarketing update reactively; onConsentChange fires full ConsentRecord after save; codepromptmaker pilot: replacing the existing component produces identical localStorage output under the same key.
- **F014.5** — Policy-version re-surface — _AC:_ mounted with version 1.1 + stored 1.0 → needsBanner true + 'Privacy policy updated' heading; accepting writes 1.1; identical version stays hidden.
- **F014.6** — Stack B Preact adapter — _AC:_ CookieBanner + useConsent as Preact with zero next/shadcn imports; same HTML/Tailwind; verified in a Vite+Preact sandbox (appears on first load, disappears after accept, correct localStorage).

## Acceptance criteria
1. @broberg/consent-cookie builds + typechecks clean; headless core imports no framework packages.
2. Each story (F014.1–F014.6) meets its own AC.
3. Piloted in codepromptmaker and adopted back with no regression (Lens / runtime-verified).
4. A second consumer (fysiodk) migrates onto the shared package with identical behaviour.

## Dependencies
- F001 — Design tokens (blocks).
- F011 — Event log (related: logs consent changes).
- External: shadcn/ui Button+Switch+Dialog (Stack A). No DB dep (host wires onConsentChange).

## Rollout
Strangler: 1) extract core + Stack A adapter from codepromptmaker; 2) pilot: swap codepromptmaker's component (same localStorage key + visuals); 3) add policy-version + onConsentChange for the fysiodk authenticated pattern; 4) adopt in fysiodk (replace privacy-banner shell + thin Supabase onConsentChange handler); 5) spread via scaffold.

Graduate-candidate: no — stays in `components`.

## Open Questions
- Ship a ConsentReopenButton (persistent footer re-open) as a first-class export? GDPR right-to-withdraw makes it near-mandatory.
- Built-in third 'marketing' category alongside analytics, or fully dynamic category array? Fixed set is simpler + covers all known cases.
- Reference onConsentChange Supabase-profiles adapter, or keep DB-free + document the pattern?
- Enforce a storageKey namespacing convention (<appSlug>-consent) or arbitrary key?

## Effort estimate
**M** — owner session: `codepromptmaker`. Reuse model: copy-owned.

## Risks
GDPR/ePrivacy: codepromptmaker has no withdraw/review mechanism after dismissal — the package MUST expose a re-open entry point (legal requirement in most EU contexts). Policy-version mismatch needs the host to keep CONSENT_VERSION in sync (stale constant = users not re-asked). Authenticated persistence requires the host to wire onConsentChange to a server write; silent failure = banner gone but no audit record — mitigate with a mandatory onConsentChange-error prop + docs.