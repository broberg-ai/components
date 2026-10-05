# F096 — `@broberg/byok`: kunden kobler sin egen AI-nøgle på

> Epic · high · M (4–6 dage) · Backlog

## Summary
En fælles pakke, så apps som CMS, HelpDesk, Trail og Mailworker kan lade kundens administrator vælge AI-udbyder og indsætte kundens egen API-nøgle. Appens AI-funktioner kører derefter på kundens nøgle gennem `@broberg/ai-sdk`, og kunden vælger dermed selv, om data behandles i EU eller US. Nøglen gemmes krypteret i appens egen database og vises aldrig igen.

## Motivation
Christian 5/10: «flere af vores apps skal kunne tillade dette eks. CMS, HelpDesk, Trail. Mailworker og sikkert flere andre så kunderne kan hooke op med præcis den AI de gerne vil anvende til funktioner der kører inden i apps. Det overdrager også snasvaert til dem selv om de vil behandle data i US eller EU hvad AI angår.»

I dag kører al AI i appene på flådens egne nøgler via `@broberg/ai-sdk` med flådens standard-udbydere (Mistral EU for tekst, men US for video/embedding). Kunden kan hverken vælge udbyder, betale selv eller garantere sin egen databopæl. Uden en fælles pakke ville hver app bygge sin egen nøgle-formular, sin egen kryptering og sin egen forbindelse til udbyderne — fire kopier af noget sikkerhedsfølsomt.

## Solution
BYOK bygges OVEN PÅ `@broberg/ai-sdk`, ikke ved siden af: SDK'ets adaptere tager allerede `apiKey`/`baseUrl` pr. udbyder (målt i 0.50.1: openaiAdapter, anthropicAdapter, mistralAdapter, geminiAdapter, deepseekAdapter, openrouterAdapter, makeOpenAICompatibleAdapter …). `@broberg/byok` ejer det der omgiver nøglen: et udbyder-katalog med region, krypteret lagring, test af forbindelsen, en server-route og et indstillingspanel — og bygger til sidst en `ai`-klient for kunden, så appens kald ikke ændrer form.

**Er der noget hemmeligt i pakken?** Nej — koden er offentlig som resten af `@broberg/*`. Det hemmelige er NØGLERNE, og de ligger aldrig i pakken: de krypteres i den enkelte apps database med appens egen hovednøgle, og efter gem ser hverken kunden, appen eller en log dem igen (kun maskeret, fx `sk-…a1b2`).

## Reuse
- **AI-kald:** `@broberg/ai-sdk` (0.50.1) — BYOK leverer kundens adaptere til `createAI`; ingen rå udbyder-SDK eller fetch (CLAUDE.md: «ALL LLM/AI calls go through @broberg/ai-sdk»).
- **Redaktion af nøgler i fejl og logs:** `@broberg/secret-scan` (redactSecrets) — genbruges.
- **Indstillingspanelets UI:** `@broberg/app-shell` (TEXT/lang-mønster, NavLink) og `@broberg/ui-controls-core` (custom select: `selectKeyReducer`, `makeOutsideClickHandler`) — genbruges; ingen native `<select>`.
- **Server-route:** hono, samme mønster som `@broberg/sso/hono`.
- **Nøgle-lagring/kryptering:** Discovery 5/10 (`byok`, `own key`, `tenant key`, `encrypt secret`): intet match — `@broberg/apikey` er INDGÅENDE nøgler til vores API'er (hash), ikke udgående kunde-nøgler der skal kunne dekrypteres. **Build** i `@broberg/byok` (WebCrypto AES-256-GCM, ingen ny afhængighed).
- **Multi-tenant:** Discovery har «Multi-tenant management» som capstone uden pakke — BYOK tager et `tenantId` som streng og antager intet om appens tenant-model.

## Design
Design-konsultation (F280.10) for components: **`silent`** — DESIGN.md har ingen regler for et indstillingspanel af denne slags. Stilhed er ikke tilladelse: panelet følger nærmeste eksisterende flade (app-shell's UserMenu-rækker og AccountPage fra F095.3: tokens, segment-kontroller, inline-feedback), og de faste regler der altid gælder: **ingen sidelæns rulning ved 393 px** (et langt nøgle-prefix ombrydes/afkortes, rulles aldrig), **ingen native dialog eller form-control** (udbyder-vælgeren er en custom select), **en knaptekst ombrydes aldrig**. Beslutningen om hvordan en «hemmelig værdi» vises (skrive-kun felt, maskeret efter gem, «Erstat» i stedet for «Vis») foreslås tilbage til guiden, når F096.4 er Lens-bevist.

## Scope

### In scope
- `packages/byok` → `@broberg/byok`: kerne (katalog, sealing, config-model), `/hono` (routes), `/preact` (indstillingspanel).
- Udbyder-katalog: OpenAI, Anthropic, Mistral, Google Gemini, DeepSeek, OpenRouter og «OpenAI-kompatibel» (egen baseUrl — Azure OpenAI, selv-hostet vLLM/Ollama). Hver med region (`eu` / `us` / `cn` / `self-hosted` / `depends`) og en kort tekst om hvor data behandles.
- Pr. kunde: valgt udbyder, krypteret nøgle, evt. baseUrl, model pr. tier (fast/smart/cheap, valgfri), og om BYOK er slået til.
- Test af forbindelsen med et minimalt kald gennem ai-sdk (fx en 1-token chat), med tydelig fejl ved forkert nøgle/manglende kredit.
- `aiForTenant(tenantId)` → en `AiClient` fra ai-sdk, bygget med kundens adapter og **uden fallback til flådens nøgler**.
- Omkostninger mærkes `byok` + tenantId i ai-sdk's cost-sink, så vi kan se at vi ikke betaler.
- Pilot i én app og række på Discovery.

### Out of scope
- At ændre ai-sdk's tier-tabel eller standard-udbydere for kunder UDEN BYOK.
- Fakturering af kunden for AI-forbrug på FLÅDENS nøgler (en anden sag).
- Kryptering med eksternt KMS (AWS/GCP) i v1 — hovednøglen er en app-hemmelighed (env), roteres manuelt.
- Udrulning til alle apps — hver app adopterer selv efter piloten.
- Billede-, video-, tale-udbydere (fal, BFL, ElevenLabs, Azure Speech) i v1 — kun tekst/chat/vision/embedding.
- At gemme nøglen hos os (components/cardmem) centralt — den bliver i appens database.

## Architecture

### Kerne (`@broberg/byok`)
```ts
type ProviderId = "openai" | "anthropic" | "mistral" | "gemini" | "deepseek" | "openrouter" | "openai-compatible";
interface ProviderInfo { id: ProviderId; name: string; region: "eu" | "us" | "cn" | "self-hosted" | "depends"; where: { da: string; en: string }; needsBaseUrl: boolean; keyHint?: RegExp }
const PROVIDERS: readonly ProviderInfo[];

interface ByokConfig { enabled: boolean; provider: ProviderId; baseUrl?: string; models?: Partial<Record<"fast"|"smart"|"cheap"|"vision"|"embedding", string>>; keyMask: string; sealedKey: string; updatedAt: number }
interface ByokStore { get(tenantId): Promise<ByokConfig|undefined>; set(tenantId, c): Promise<void>; delete(tenantId): Promise<void> }  // appens DB

seal(key: string, masterKey: string): Promise<string>   // AES-256-GCM, tilfældig IV, versionsprefix
open(sealed: string, masterKey: string): Promise<string>
mask(key: string): string                                 // "sk-…a1b2"
```

### Fra konfiguration til AI-klient
```ts
aiForTenant(tenantId, { store, masterKey, fallback?: AiClient }): Promise<AiClient>
```
Bygger `createAI({ … })` med netop kundens adapter (`openaiAdapter({ apiKey })` osv. fra ai-sdk) og tier-map peget på kundens modeller. **Er BYOK slået til og nøglen fejler, kastes en navngiven fejl — der falder IKKE tilbage til flådens nøgle** (det ville sende kundens data til en anden udbyder/region uden kundens viden). `fallback` bruges KUN når kunden ikke har slået BYOK til.

Afhængighed til ai-sdk (ejer: ai-sdk-sessionen): bekræft at `createAI` kan få injicerede adaptere og en tier-map, og at fallback-kæder kan slås helt fra pr. klient. Mangler noget, udvides ai-sdk (ikke work-around her).

### Server (`@broberg/byok/hono`)
`byokRoutes({ store, masterKey, tenantOf(c), canManage(c) })`:
- `GET /` → `{ enabled, provider, baseUrl, models, keyMask, updatedAt }` (aldrig nøglen)
- `PUT /` → gem (ny nøgle valgfri; tom = behold den gemte), svar = det gemte, læst tilbage fra store
- `POST /test` → prøv nøglen (ny eller gemt) med et minimalt kald; `{ ok, provider, model, latencyMs }` eller `{ ok:false, error }` med navngiven årsag
- `DELETE /` → slå fra og slet nøglen
Kun for kundens administrator (`canManage`), 403 ellers.

### Panel (`@broberg/byok/preact`)
`<ByokSettings lang endpoint? />`: slå-til, custom udbyder-vælger med regions-mærke (EU/US/…) og én linje om hvor data behandles, nøglefelt (skrive-kun; efter gem kun maske + «Erstat nøgle»), baseUrl når udbyderen kræver det, valgfri model pr. tier, «Test forbindelse», «Gem» med læs-tilbage.

## Stories
- **F096.1** — Kerne: udbyder-katalog med region, AES-256-GCM sealing/open/mask, config-model og store-interface.
- **F096.2** — `aiForTenant()` + test-kald gennem ai-sdk, uden tavs fallback; omkostninger mærket `byok`.
- **F096.3** — `byokRoutes()` til hono (GET/PUT/POST test/DELETE), kun admin, aldrig nøglen i et svar.
- **F096.4** — `ByokSettings`-panel (Preact) med custom udbyder-vælger, regions-mærke, skrive-kun nøglefelt, test og gem.
- **F096.5** — Udgivelse 0.1.0, Discovery-række og pilot i én app (forslag: helpdesk), Lens ved 393/1440.

## Acceptance criteria
1. En gemt nøgle står i appens database KUN som ciffertekst; et GET-svar, en fejlbesked og en log indeholder den aldrig — målt i route-tests på de rå svar og med redactSecrets på fejlstierne.
2. Med BYOK slået til går et `ai.chat` fra appen til KUNDENS udbyder med kundens nøgle — målt med en fake udbyder på den udgående request (Authorization-header og host, streng lighed), ikke på SDK-funktionens returværdi.
3. Fejler kundens nøgle, får appen en navngiven fejl, og der går INTET kald til flådens udbyder — målt ved at flådens fake udbyder har 0 requests.
4. Panelet gemmer, og efter genindlæsning viser det den gemte udbyder, region og maske (aldrig nøglen) — målt i piloten med Lens og læst tilbage fra GET.
5. Ingen sidelæns rulning ved 393 px og ingen native form-controls i panelet — Lens med DOM-kritiker.

## Dependencies
- `@broberg/ai-sdk`: injicerede adaptere + mulighed for at slå fallback fra pr. klient (bekræftes med ai-sdk-sessionen før F096.2).
- F095.3 (AccountPage) som nærmeste eksisterende mønster for et indstillingspanel med læs-tilbage — ikke blokerende.

## Rollout
Ship dark: uden `byokRoutes` monteret og uden en gemt konfiguration ændrer intet sig i en app (flådens nøgler som i dag). Pilot i én app bag en indstilling, derefter adopterer CMS, Trail og Mailworker i deres egne sessioner. Rollback: slå BYOK fra for kunden (DELETE) — appen er tilbage på flådens nøgler.

## Open Questions
1. **Når en kunde IKKE har slået BYOK til: kører AI på flådens nøgler som i dag (og betaler vi), eller skal nogle apps kræve BYOK for at AI-funktionerne virker?** — Christians beslutning.
2. **Hvilken app er pilot?** Forslag: helpdesk (AI-svar på kundehenvendelser er et tydeligt personhenførbart tilfælde, hvor EU/US betyder mest).
3. Må en kunde pege på en selv-hostet model (OpenAI-kompatibel baseUrl) — dvs. vores server sender data til en adresse kunden vælger? Det er netop pointen for nogle kunder, men det skal være et bevidst valg. Forslag: ja, kun https, og adressen vises tydeligt i panelet.

## Effort estimate
**M** — 4–6 dage (kerne 1, aiForTenant 1, routes 1, panel 1–2, pilot 1).