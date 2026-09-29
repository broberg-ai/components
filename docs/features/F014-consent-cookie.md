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
---

## REVISION 28/9 2026: ét modul som alle sites kan bruge, uanset stak (Christian)

> Christian, 28/9: «Vi mangler sgu da et Cookie modul :) Et ALLE sites kan anvende uanset om de er på stak A eller B».

**Juni-planen ovenfor er hermed afløst på ét punkt, og det er det bærende punkt.**
Den valgte *copy-owned* med to adaptere: React/shadcn til Stack A og Preact til Stack B. Det betyder, at hvert site kopierer og vedligeholder sit eget banner. Det er det modsatte af ordren. Kernen (F014.1, `createConsentManager`, 0.1.0 på npm siden juni) er stadig rigtig og genbruges uændret.

### Målt før revisionen (28/9)

- `@broberg/consent-cookie` 0.1.0: kun den headless kerne. Ingen UI, ingen script-blokering, ingen bevis-log.
- Forbrugere: ingen, blandt de 15 fleet-repoer der er klonet lokalt. Heller intet hånd-rullet banner i nogen af dem. Lokal måling, ikke hele flåden: sanne, fd-sundhed m.fl. er ikke klonet her.

### Nyt design: én web component

`<broberg-consent>` (custom element, eksporteret fra `@broberg/consent-cookie/element`).

- **Én implementering til alle stakke.** Et custom element virker i Next (client), Vite+Preact og ren HTML/cms-statiske sites uden adapter. Det erstatter F014.2, .3, .4 og .6 (fire adaptere) med én.
- **Styling via @broberg/theme-tokens.** Elementet bruger shadow DOM og læser `--primary`, `--radius`, `--background` osv. fra siden, så det automatisk får sitets brand. Hvert token har en fallback, så et site uden theme stadig ser rigtigt ud.
- **Tekst**: dansk standard og engelsk indbygget, og al tekst kan overskrives, fordi politik-teksten ejes af sitet.
- **Kerne-API'et bliver stående**: `window.brobergConsent` / `element.manager` er den eksisterende `ConsentManager`. Et site med egen UI kan stadig bruge kernen direkte.

### Det lovpligtige, som juni-planen ikke dækkede

1. **Afvis skal være lige så let som accepter.** Samme niveau og samme størrelse på første lag (Datatilsynets praksis). Ingen forhåndsafkrydsede kategorier.
2. **Scripts må ikke køre før samtykke.** `<script type="text/plain" data-consent="analytics">` aktiveres først ved samtykke. Iframes (YouTube, kort) får en pladsholder. Sendes Google Consent Mode v2-signaler, sker det kun når sitet beder om det.
3. **Tilbagekald skal være lige så let som at give samtykke.** Et fast «Cookie-indstillinger»-greb (knap eller link) genåbner panelet. Det var allerede et krav i juni-constraints'ene.
4. **Samtykke skal kunne dokumenteres (GDPR art. 7(1)).** Valgfri `endpoint`: hver ændring POSTes som `{ consentId, policyVersion, choices, timestamp }`, uden IP-adresse. Sitet ejer lagringen.

### Nye stories (F014.7–.12)

Mockup først, så komponent, så gating, så bevis, så de tre stakke, så pilot. F014.2, .3, .4 og .6 arkiveres med henvisning hertil. F014.5 (policy-version) er allerede i kernen og testet, så den lukkes mod F014.1's tests.

### Åbent for Christian

- Hvilket site er pilot (F014.12)?
- Skal broberg.ai have én fælles, hostet script-tag-version (fx `cdn.broberg.ai/consent.js`) til sites der ikke har et build? Det er ikke med i scope nu.

## Reuse

Discovery-søgning 28/9 på «cookie» og «consent»: det eneste træf er @broberg/consent-cookie (F014) selv. Kernen `createConsentManager` genbruges uændret under elementet. Styling genbruger @broberg/theme's CSS-variabelnavne (`--primary`, `--radius`, …), men uden at importere pakken, så elementet også virker på et site uden theme. Der er ingen anden @broberg-pakke til script-gating eller consent-log, så de bygges her.

## F014.15 — cookie-knappen kan stå i alle fire hjørner, eller være væk (28/9)

> Christian, 28/9: broberg-ai har en fast «Rediger»-knap nederst til venstre, præcis hvor cookie-knappen står; den skal kunne placeres forskellige steder og være helt væk, fordi den kan ødelægge et design. «Så må sitet implementere en anden måde at force dialogen frem igen, eks. i Privacy siden.»

- `reopen-position`: `bottom-left` (standard), `bottom-right`, `top-left`, `top-right`. `left`/`right` fra 0.2.0 betyder stadig de nederste hjørner, så intet eksisterende site flytter sig. Ukendt værdi = standard.
- `hide-reopen` (fandtes allerede i 0.2.0): knappen er væk. Sitet ansvarer for en anden vej tilbage: ethvert element med `data-broberg-consent-open`, fx på privatlivssiden. Loven kræver en vej tilbage, men ikke at den er en flydende knap.
- Udgivet som 0.4.0. Tests: fire hjørner + aliaser + ukendt værdi; skjult knap + link åbner panelet.
- Ikke gjort: pakken advarer ikke, hvis et site skjuler knappen uden at have et link. Det er sitets ansvar ifølge ejeren.

## F014.12 — udrulningen, status 29/9 kl. ~10.20 (dansk tid)

Christian 29/9: «rul det ud til alle live sites». Kilde for listen: `buddy list_sessions` (22 kørende sessioner) + cardmem-projektlisten (41 projekter). Ingen af dem registrerer «har et offentligt site med URL», så ordren er sendt bredt, og hver ejer MÅLER og svarer — listen nedenfor er deres svar, ikke vores gæt.

Leveret to veje: intercom 29/9 (16 sessioner; m1-levering uden kvittering) og en dispatch'et plan_build-kort på hvert sites eget board (holdbar, også for sessioner der ikke kører).

| Projekt | Kort | Status |
|---|---|---|
| discovery.broberg.ai | components F014.12 | ✅ live 28/9, Lens-bevist |
| fd-sundhed (sundhed.fdaalborg.dk) | fd-sundhed-F006.502 (vores F022 arkiveret som dublet) | ✅ live 29/9, 0.5.0 categories="", Lens e935dd44 / 089a5c34 / 88aabb24 / 6a39388b, enrolleret. HSL-triplet-tokens mappet via aliaser; håndtaget løftet over mobil-bundmenu |
| broberg-ai | broberg-ai-F032 | ✅ live 29/9, 0.5.0 categories="", hide-reopen + footer-link, Lens a2651539 + 932e4ff3, enrolleret. Banner dækkede «Rediger»-bjælken → F014.17 (0.5.1) |
| cms (docs.webhouse.app, www.webhouse.dk, webhouse.app) | cms-F204 | ✅ live 29/9, 0.5.0 categories="", Lens mod prod 2fe321ce / e4abe9be / 50ecd68c, enrolleret. Ingen privatlivsside på nogen af dem |
| how | how-F007 | dispatch'et |
| pitch | pitch-F054 | dispatch'et |
| sanneandersen | sanneandersen-F142 | dispatch'et |
| vn-leker | vn-leker-F002 | dispatch'et |
| fd-ishoej | fd-ishoej-F006 | dispatch'et |
| fysio-dk-aalborg | fysio-dk-aalborg-F004 | dispatch'et |
| fysiodk-aalborg-sport | fysiodk-aalborg-sport-F030 | dispatch'et |
| anna | anna-F002 | dispatch'et |
| happy-little-place | happy-little-place-F042 | dispatch'et |
| kai | kai-F002 | dispatch'et |
| moovyy | moovyy-F037 | dispatch'et |
| storeform | storeform-F003 | dispatch'et |
| mailworker | mailworker-F011 | dispatch'et |
| helpdesk (helpdesk.broberg.ai) | (intercom) | ✅ live 29/9, 0.5.0 categories="", hide-reopen + links i konto-menu og fod, Lens 3b25a425, enrolleret. Christians ønske om synligt 🍪-ikon sendt som frivilligt |
| xrt81 | (intercom) | ✅ live på xrt81.com 29/9 (0.4.1, Lens d7f2c8de). Discovery-enrollment blokeret: nøgle tabt, reset kræver Christian |
| trail (trailmem.com + docs) | trail-F291 | ingen trackere; mangler privatlivsside → venter på Christian |
| cardmem.com | cardmem F375.1 | ✅ live 29/9 på den ikke-loggede forside (appen efter login: intet banner), 0.5.1 categories="", Lens f13fa42d + c42a8a25, durable artefakter, enrolleret. Lys --primary gav hvid tekst på lys knap → mappet til mørk tone |
| broberg-id | — | **UNDTAGET.** Christian 29/9, ordret: «intet cookie-banner på BID». Kun førsteparts login-cookies, ingen trackere (broberg-ids måling, intercom #872). |
| upmetrics, whop, camera9, brain, forager | — | målt: intet offentligt site / ingen trackere |

**Mønster i svarene:** interne apps bag login uden trackere siger «ikke lovkrav». Det er juridisk rigtigt for rent nødvendige cookies; ordren siger «alle live sites». Afgørelsen for dem er Christians.

## F014.16 — teksten må kun love det sitet bruger (29/9)

Målt af xrt81 (første site live): standardteksten sagde «cookies til statistik og marketing» på et site uden sporing — en usand påstand på hvert site uden trackere, og kategorierne kunne ikke fjernes. Og `el.texts = …` efter mount tegnede ikke igen.

- Attribut `categories` = de valgfrie kategorier sitet faktisk bruger (`"analytics"`, `"analytics marketing"`, `""`). Panelet viser kun dem; brødteksten bygges af dem. Uden attributten: præcis 0.4.1's tekst (strict equality-test).
- `texts` er en setter der tegner igen. Enkeltfelter kan overskrives; resten beholder standardteksten. Et eksplicit `texts.body` vinder.
- 0.5.0. Negativ kontrol: de 6 nye tests mod 0.4.1-koden → 5 røde.
