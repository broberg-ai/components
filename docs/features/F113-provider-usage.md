# F113 — @broberg/provider-usage

**Ejerens ordre 7/11 2026:** «Skriv planen og byg UpCloud først du skal nok løbende få nøgler til alt relevant for at vi kan hente data til pakken.»

## Motivation
Ejeren 7/11 (via fysio.work #49100): «Det bedste ville være at vi kan query account data fra vores providers. Fly, Upcloud, Supabase, Scaleway.» To forbrugere har brug for det samme svar — hvad koster netop denne ressource i denne periode:
- **cardmem Operate** viser i dag kun plan-estimater for UpCloud og Supabase.
- **fysio.work** vil videresælge moduldatabaser som leverandørpris + 30 % (deres F006.32/F006.36).
Uden en fælles pakke skriver begge deres egen UpCloud-integration, og den driver.

## Målt før planen (fysio.work F006.36, 7/11)
| Leverandør | Faktureret pris pr. ressource | Status |
|---|---|---|
| UpCloud | Ja: `GET /1.3/account/billing/summary/{YYYY-MM}` + `resource_billing_summary/{id}/{YYYY-MM}` (resource_id, amount, hours, plan, zone, daily_sums, EUR, løbende) | Endpoint dokumenteret; med den delte managed-db-underkonto 404/403 — kræver en konto med billing-ret |
| Scaleway | Ja på papiret: FinOps Beta `charges` + `consumptions` | Ikke målt (ingen nøgle) |
| Cloudflare R2 | Pris pr. produkt pr. dag (Alpha); pr. bucket kun mængder | Ikke målt |
| Supabase | Nej — kun listepris pr. projekt + antal kald | Målt |
| Fly | Nej — kun billingStatus/creditBalance pr. org | Målt |

**Sikkerhedsfund (fysio.work):** UpCloud-tokens har ingen scopes. Den delte underkontos `GET /database` returnerer produktionsdatabasernes adgangskoder i klartekst. Derfor kalder pakken KUN de billing-adresser, den har brug for — aldrig `/database` eller noget, der kan returnere hemmeligheder — og kun GET.

## Design
Én grundform for alle leverandører:
```ts
interface UsageLine {
  provider: "upcloud" | "scaleway" | "cloudflare" | "supabase" | "fly";
  resourceId: string; resourceType: string; // fx "managed_database", "server", "storage"
  period: { from: string; to: string };     // ISO-dato, inkl./ekskl. som angivet
  amount: number; currency: "EUR" | "USD" | ...;
  basis: "billed" | "estimated";            // ALDRIG udeladt — en skønnet pris må ikke ligne en faktureret
  complete: boolean;                         // false = løbende måned, ikke lukket
  details?: { hours?: number; plan?: string; zone?: string; daily?: { date: string; amount: number }[] };
  fetchedAt: string;
}
```
- **Kun kostpris.** Avance (fx +30 %) og pris til kunden hører hos forbrugeren (D-bdbb73: priser ændres kun på ejerens ord og ét sted).
- **Ærlig om huller:** en leverandør uden billing-API giver enten `basis: "estimated"` (listepris × forbrug) eller ingen linje — aldrig et tal, der ligner faktureret.
- **Ship dark:** uden nøgle svarer en leverandør `{ ok: false, reason: "not_configured" }`; en nøgle uden billing-ret svarer `"no_billing_access"` (UpCloud 403/404), aldrig en tom liste, der ligner «ingen forbrug».
- Ingen lagring: pakken henter; forbrugeren gemmer.
- Fly bygges på `@broberg/deploy-core`'s FlyClient, hvis/når der kommer et estimat.

## Stories
- **F113.1** Pakken + UpCloud (faktureret): grundform, UpCloud-klient (kun billing-GET), fejltyper, tests mod målte svarformer, bootstrap-udgivelse + Trusted Publisher, Discovery-række. Live-bevis når ejeren har lagt en UpCloud-nøgle med billing-ret i vaulten.
- **F113.2** Scaleway (faktureret, FinOps) — når der er en `BillingReadOnly`-nøgle.
- **F113.3** Cloudflare R2 — mængder pr. bucket × prisliste, markeret `estimated`; produkt-totaler som `billed`.
- **F113.4** Supabase + Fly — `estimated` fra listepris × forbrug, eller ingen linje.

## Non-goals
- Opkrævning af kunder, avance og prissætning (forbrugerens).
- Skrive-nøgler eller noget kald, der ændrer en konto.
- PDF-fakturalæsning (Supabase-fakturaer i mail) — eget kort, hvis ønsket.

## Nøgler (ejeren opretter, kun i leverandørens kontrolpanel)
- UpCloud: en underkonto med KUN «read billing details» (ellers er et hovedkonto-token fuldt skrivende).
- Scaleway: IAM-application med `BillingReadOnly`.
- Cloudflare: account-token med «Billing Read» + «Account Analytics Read».
Alle i cardmem-vaulten; pakken læser dem fra env, aldrig fra kode.

## Reuse
Discovery 7/11 (billing, usage, cost, upcloud, invoice): intet. cardmem Operate har plan-estimater for UpCloud/Supabase — F113.4 løfter estimat-logikken ind her i stedet for at genopfinde den. FlyClient fra @broberg/deploy-core.

## Rollout
F113.1 udgives som 0.1.0 (bootstrap + Trusted Publisher straks). Release-rapport til cardmem og fysio.work som en mulighed, ikke en opgave.
