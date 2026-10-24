# F107 — @broberg/phone: udgående telefonopkald via 46elks

> Christian 24/10 2026 via buzzalert (#4378): «ja til 1, 2 og 3 — kør videre», hvor 3 er telefoni-pakken. Første forbruger: Buzz (vagthavende vækkes om natten og kvitterer).

## Åbne spørgsmål — måles mod 46elks' egen dokumentation FØR der kodes
1. **Dansk oplæsning (TTS):** har 46elks selv tekst-til-tale på dansk, eller skal vi afspille en lydfil vi selv genererer? Hvis det sidste: hvilken EU-route (`@broberg/ai-sdk`, ingen persondata ud af EU) laver dansk tale, og hvor hostes filen?
2. **Kvittering:** 46elks' IVR-handling (`ivr` + `digits` + `next`) — præcis JSON-form og hvordan det trykkede ciffer kommer tilbage til os (webhook-krop).
3. **Leveringsstatus:** hvilke slut-tilstande 46elks rapporterer (svaret, optaget, intet svar, fejl), og hvordan hook'en autentificeres, så en fremmed ikke kan falske «kvitteret».
4. **Region:** 46elks er svensk (EU). Bekræft hvor opkald og data behandles.

## Hvorfor
En alarm der ikke bliver set, skal ringe. SMS og push kan sove igennem; et opkald vækker. Buzz har brug for: ring op, læs alarmen op på dansk, «tryk 1 for at kvittere», og få at vide om det lykkedes. `@broberg/voice` er lydopkald *i* appen (LiveKit), ikke telefonnettet. Uden en fælles pakke bygger Buzz en rå 46elks-integration — netop det flådereglen forbyder.

## Scope
- Server-side: `createPhone({ username, password })` → `{ status, call(to, { text, from?, ackDigit?, webhookUrl }), parseWebhook(req) }`.
- Opkaldet læser `text` op (dansk), beder om ét ciffer, og rapporterer via webhook: `answered | busy | no-answer | failed`, plus `acknowledged: true` når det rigtige ciffer blev trykket.
- Samme kontrakt-stil som `@broberg/webpush`/`@broberg/nativepush`/`@broberg/sms`: kaster aldrig, fejl med `kind` (`auth | payload | transient`), `status` ved opstart `ready | no-keys | invalid-keys`, ship-dark uden nøgler.
- Webhook-verifikation, så en kvittering ikke kan forfalskes.
- Telefonnummer er persondata: ingen logning af nummer i klar tekst (maskeret), EU-udbyder.

### Non-goals
- Indgående opkald, køer, viderestilling.
- Opkald mellem app-brugere (det er `@broberg/voice`).
- SMS (det er `@broberg/sms`; en 46elks-SMS-provider dér er et separat kort hvis ønsket).

## Reuse
- Discovery-kilden (scripts/inventory-data.mjs) 24/10: ingen pakke ringer over telefonnettet. `@broberg/voice` = LiveKit-huddle i appen; `@broberg/sms` = SMS via danske/EU-udbydere. Kontrakten (resultat, status, ship-dark, webhook-verifikation, idempotens) genbruges i form fra `@broberg/sms` og `@broberg/nativepush`.
- Dansk TTS, hvis 46elks ikke har det: via `@broberg/ai-sdk` (EU-route) — aldrig en rå provider.

## Stories
- F107.1 — afklar de åbne spørgsmål mod 46elks' dokumentation, byg `@broberg/phone` 0.1.0 med tests mod en falsk 46elks.

## Udrulning
1. Bygget og testet mod en lokal falsk 46elks.
2. Første `v0.1.0` kræver Christians npm-login (bootstrap) + Trusted Publisher.
3. Live-bevis kræver en 46elks-konto/nøgle og et nummer at ringe til (fra Buzz/ejeren).
4. Release-rapport til buzzalert.
