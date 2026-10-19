# F102 — @broberg/seal: fælles kryptering af gemte hemmeligheder

## Motivation
Christian 20/10 2026: «Lav den fælles krypteringspakke». Udløst af jam #3582: Jam (F023 BYOK-chat) skal gemme kundens EGNE AI-nøgler krypteret i sin Postgres — AES-256-GCM, envelope, nøglerotation — og spurgte om en fælles primitiv. Der findes ingen: `@broberg/apikey` er indgående nøgler, sikkerhedsgennemgangen 11/10 fandt ingen AES-GCM i components, og cardmems Secrets Vault er en tjeneste, ikke en pakke. Næste app med samme behov ville ellers rulle sin egen — præcis den drift reuse-reglen findes for.

## Scope (v0.1.0)
- `createSealer({ keys, current })` — `keys` = nøglering `{ [version]: base64-nøgle (32 bytes) }`, `current` = versionen nye værdier forsegles med.
- `seal(plaintext, { aad })` → en tekststreng (egnet til en `text`-kolonne). **Envelope:** en ny tilfældig data-nøgle (DEK) pr. værdi krypterer indholdet (AES-256-GCM); DEK'en krypteres med nøgleringens nøgle (KEK) for `current`. Formatet bærer KEK-versionen.
- `open(sealed, { aad })` → klartekst. **AAD er påkrævet** (fx `${tenantId}:${felt}`): en forseglet værdi kopieret til en anden række/kunde kan ikke åbnes dér.
- Rotation: tilføj ny version i `keys`, sæt `current` → nye værdier bruger den; gamle åbnes stadig. `needsRewrap(sealed)` + `rewrap(sealed, { aad })` pakker DEK'en om med den nye KEK uden at røre indholdet; når alt er rewrapped, fjernes den gamle version.
- `generateKey()` (32 tilfældige bytes, base64) og `keysFromEnv("1:…,2:…")`.
- Web Crypto (`crypto.subtle`) — virker i Node 20+, Bun, Deno og edge. Ingen runtime-afhængigheder.
- Fejl er navngivne og afslører aldrig nøgle eller indhold: forkert AAD/manipuleret værdi, ukendt nøgleversion, forkert nøglelængde, ukendt format.

## Non-goals
- KMS-integration (AWS/GCP/Azure) — KEK'en kommer fra miljøet i v0.1. Formatet tillader en KMS-wrappet KEK senere.
- Databaseadapter eller kolonnetype — værdien er en streng; appen ejer sin tabel.
- Hashing af adgangskoder, signering, indgående API-nøgler (andre pakker).

## Arkitektur
Format: `seal1.<kekVersion>.<b64u wrapIv>.<b64u wrappedDek>.<b64u iv>.<b64u ciphertext+tag>`. DEK wrappes med AES-GCM (KEK), AAD = `seal1|<kekVersion>|<aad>` for indholdet og `seal1|dek|<kekVersion>` for wrap. 96-bit tilfældige IV'er.

## Reuse
Discovery/roster tjekket 20/10: ingen `@broberg/*`-pakke krypterer data i hvile (én søgning på aes-gcm/encrypt i `scripts/inventory-data.mjs`: 0). Bygger på platformens Web Crypto, intet tredjepartsbibliotek.

## Rollout
Ny pakke: første `0.1.0` udgives lokalt med ejerens OTP (CLAUDE.md «npm publish — bootstrap»), derefter Trusted Publisher + job i `publish.yml`. Roster-række i `scripts/inventory-data.mjs`. Release-rapport til jam (første forbruger).
