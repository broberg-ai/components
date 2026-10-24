# F106 — @broberg/nativepush: push til native apps (APNs + FCM)

> Christian 24/10 2026: «ja, opret kortet og byg den ud fra buddys kode». Første forbruger: Buzz (buzzalert F007.2).

## Hvorfor
`@broberg/webpush` er Web Push (VAPID) og når kun browsere og hjemskærms-web-apps. En app fra App Store / Google Play — Buzz' alarm-app — skal have push gennem Apples APNs og Googles FCM. Kun dér findes kritiske alarmer (bryder igennem lydløs / forstyr ikke på iPhone) og high-priority data-beskeder til fuldskærmsalarm på Android. buddy har allerede en APNs-sender (`apps/server/src/push/apns.ts`, F086.6), men den bor inde i buddy. Uden en fælles pakke bygger Buzz en tredje kopi.

## Scope
- Én server-side sender: `createNativePushSender({ apns?, fcm? })` → `{ status, send(targets, message) }`.
- **APNs**: token-auth (.p8, ES256 JWT, genbruges <60 min), HTTP/2 over `node:http2`, én forbindelse pr. `send`. Sandbox/produktion vælges eksplicit. `interruption-level` (passive · active · time-sensitive · critical), `sound` inkl. `{critical:1, volume}`, `mutable-content`, `apns-collapse-id`, udløb.
- **FCM HTTP v1**: service-account (RS256 JWT → OAuth2-token, cachet), `android.priority: high`, `data`-only besked mulig (appen viser fuldskærm selv).
- **Resultat som webpush 0.5+**: `{ sent, dead, failed[{platform, token, statusCode, kind: auth|payload|transient, reason}], allFailed }`. Kun `dead` må slettes: APNs **410 Unregistered**, FCM **UNREGISTERED**. `BadDeviceToken` er IKKE dead (den betyder ofte sandbox/produktion-forveksling — at slette ville tømme tabellen på en konfig-fejl).
- `status` pr. platform ved opstart: `ready | no-keys | invalid-keys` (nøglen parses synkront med `node:crypto`).
- Ship-dark: ingen nøgler → ingen crash; sends til den platform går i `failed` med `kind:auth`, `reason:no-keys`.
- Kaster aldrig ind i kalderens request. Ingen DB — kalderen ejer tokens.

### Non-goals
- Klient-registrering (Capacitor-plugin, Tauri). Appen henter selv sit token.
- Notification Service Extension-koden i iOS-appen.
- At søge Apples Critical Alerts-entitlement (ejerens skridt).
- Retry/kø. Kalderen beslutter på `kind`.

## Arkitektur
`packages/nativepush/src/`: `apns.ts` (JWT + h2-request, porteret fra buddy), `fcm.ts` (OAuth + v1-send), `index.ts` (sender, status, fan-out, klassificering), `types.ts`. Kun `node:crypto` + `node:http2` + global `fetch` — ingen runtime-afhængigheder. Testbar via `apnsHost` (h2c lokal server) og indsprøjtet `fetch`.

## Reuse
- Discovery-tjek 24/10 (scripts/inventory-data.mjs = Discovery's kilde): ingen pakke dækker APNs/FCM; webpush-rækken siger selv «NOT native APNs/FCM — future @broberg/nativepush».
- **Genbrug:** buddys `apns.ts` (ES256-JWT uden DER-unwrap, 50-min token-cache, h2-request, `mutable-content`). Porteres hertil; buddy kan derefter skifte til pakken.
- **Form:** webpush' resultat- og status-kontrakt (sent/dead/failed/allFailed, ready/no-keys/invalid-keys), så forbrugere kender den.

## Stories
- F106.1 — pakken: APNs + FCM, resultat/status, tests, README, første udgivelse.

## Afhængigheder og udrulning
1. Bygget og testet mod lokale mock-servere (APNs h2c, FCM via fetch).
2. Første `v0.1.0` kræver bootstrap-publish fra Christians npm-login (2FA) + Trusted Publisher, derefter OIDC som alle andre.
3. Live-bevis kræver fra Buzz/ejeren: .p8-nøgle + Team/Key ID + bundle id, en FCM-service-account og et rigtigt enhedstoken. Critical-lyden kan først bevises med Apples entitlement.
4. Release-rapport til buzzalert (og buddy) ved udgivelse.
