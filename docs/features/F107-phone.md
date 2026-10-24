# F107 — @broberg/phone: udgående telefonopkald via 46elks

> Christian 24/10 2026 via buzzalert (#4378): «ja til 1, 2 og 3 — kør videre», hvor 3 er telefoni-pakken. Første forbruger: Buzz (vagthavende vækkes om natten og kvitterer).

## Besvaret 24/10 fra 46elks' egen dokumentation (var åbne spørgsmål)
1. **Dansk oplæsning:** 46elks har INGEN tekst-til-tale i drift — docs/voice-play: «We are working on a TTS feature, let us know if you're interested in trying it out.» → opkaldet afspiller en lydfil. Den laves med `@broberg/ai-sdk` `ai.tts` (Azure Speech, dansk stemme, region `westeurope`, MP3 — målt i ai-sdk src/providers/azure.ts). Appen hoster filen og giver pakken URL'en; pakken kalder ikke selv en AI-tjeneste.
2. **Kvittering:** docs/voice-ivr: `{"ivr": <lyd-url>, "digits": 1, "timeout": 1–30 (std. 10), "repeat": std. 3, "next": <url>}`. 46elks POSTer til `next`: `callid`, `from`, `result` (de tastede cifre, eller `"failed"`), og `why` (`"noinput"`) når result er failed.
3. **Status ved opkaldets slutning:** docs/call-actions: `whenhangup` modtager `id`, `state` (**kun** `success` · `failed` · `busy`), `start` (når der blev svaret), `duration`, `cost`, `actions[]`. Der findes ingen separat «intet svar»-tilstand; `failed` uden `start` = blev aldrig taget [ikke live-bevist]. `whenhangup` skal med i selve opkaldet for også at få besked, når det ikke kommer igennem (docs/make-call).
   **Autentificering:** 46elks signerer IKKE webhooks. docs/ip-addresses anbefaler IP-firewall: `176.10.154.199`, `85.24.146.132`, `185.39.146.243`, `2001:9b0:2:902::199` (kan ændre sig; 46elks mailer kunderne). → Pakken lægger en hemmelig token i hver webhook-URL og afviser en hook uden den; IP-listen kan bruges som ekstra lag.
4. **Region:** 46elks' data-protection: «Personal data should stay inside the European Union» (medmindre kunden selv beder om andet), på 46elks-ejede servere. Telefonnumre er nævnt som persondata.

## Hvorfor
En alarm der ikke bliver set, skal ringe. SMS og push kan sove igennem; et opkald vækker. Buzz har brug for: ring op, læs alarmen op på dansk, «tryk 1 for at kvittere», og få at vide om det lykkedes. `@broberg/voice` er lydopkald *i* appen (LiveKit), ikke telefonnettet. Uden en fælles pakke bygger Buzz en rå 46elks-integration — netop det flådereglen forbyder.

## Scope
- Server-side: `createPhone({ username, password, from, webhookSecret })` → `{ status, call(to, { audioUrl, ackDigit?, webhookBase }), parseHangup(body, url), parseIvr(body, url) }`.
- Opkaldet afspiller `audioUrl` (dansk, lavet med `ai.tts`), beder om ét ciffer, og rapporterer via webhooks: `answered | busy | failed` (+ `neverAnswered` når `start` mangler), og `acknowledged: true` når det rigtige ciffer blev trykket.
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
