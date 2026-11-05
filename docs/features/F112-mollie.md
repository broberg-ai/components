# F112 — @broberg/mollie: betalinger med tre-vejs fordeling vi selv styrer

**Bestilt af:** Christian 5/11 2026: «Ja, skriv udkastet til Mollie og byg @broberg/mollie» — efter research med kravet «vi SKAL kunne styre fordeling mellem alle partner os, udvikler, klinik». Første forbruger: fysio.work (platform + App Store).

## Hvad researchen fastslog (kilder i fysio.work docs/research/2026-11-05-mollie-tre-vejs-fordeling.md)
- Tre-vejs fordeling kræver Mollie **Connect for Marketplaces** + **delayed routing** (`POST /v2/payments/{id}/routes` efter betalt). DKK virker kun her.
- Routes er faste beløb — procenter regnes af os.
- Subscriptions API bærer ingen routing → vi trækker selv månedlige betalinger (`sequenceType=recurring`) og fordeler hver.
- Om routing virker på recurring-betalinger er IKKE dokumenteret → spurgt skriftligt (Comms-udkast til marketplaces@mollie.com).
- Pris (mollie.com/dk/pricing, 5/11): danske forbrugerkort 1,20 % + 1,80 kr; Connect/routing ikke prissat offentligt.

## Arkitektur
1. **Fordelingsmotor** (`computeSplit`, F112.1) — udbyder-uafhængig, ren funktion: regler (procent og/eller fast beløb pr. modtager) → præcise beløb i minor units; summen er altid præcis betalingen; afrundingsrest til en navngivet modtager (standard platformen). Det er HER fordelingen styres — ikke hos Mollie.
2. **Mollie-udfører** (F112.2) — tynd klient mod Mollie v2 REST med `fetch` (injicerbar), ingen SDK-afhængighed: kunder, første betaling (mandat), månedlige træk, `routePayment` (idempotent: læser eksisterende routes først, kun når betalt), refusion med `reverseRouting`/`routingReversals`, webhooks (klassisk fetch-back + ny HMAC-signatur).
3. Ship dark: uden `MOLLIE_API_KEY` → `enabled:false`, ingen crash.

## Non-goals
- Selve forretningsreglerne (30/70, priser) — dem ejer fysio.work (D-bdbb73: priser/gebyrer kun på ejerens ordre).
- Planlæggeren af de månedlige træk (cron) — forbrugerens; pakken leverer kaldet.
- Stripe-udfører / fælles `@broberg/payments`-facade — ejeren valgte @broberg/mollie. Fordelingsmotoren er udbyder-uafhængig, så den kan løftes ud senere.

## Reuse
Discovery: `@broberg/stripe` er eneste betalingspakke (to-parts: application fee + én destination). Mønstre genbrugt derfra: ship-dark-klient, ægte webhook-verifikation, «pakken ejer formen, appen ejer tallene». Ingen eksisterende pakke dækker Mollie eller tre-vejs fordeling.

## Bevis
Tests mod falsk Mollie + mutationer. **Ikke live-verificeret** før der findes en Mollie test-nøgle (og routing er slået til af Mollie) — står i README.
