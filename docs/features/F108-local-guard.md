# F108 — @broberg/local-guard

**Udløst af:** auth-relay (#4644) kopierede lens-daemons lokale vagt; lens (#4656, 25/10 2026): «ja — en sikkerhedsvagt i to kopier er præcis den slags der glider fra hinanden.»

## Motivation
En lokal HTTP-dæmon (127.0.0.1) kan nås fra enhver hjemmeside brugeren besøger: DNS-rebinding lader en fremmed side tale med `localhost`, og en almindelig `<form>` kan sende en POST uden CORS-preflight. lens-daemon værner sig med to tjek: **Host** skal være loopback på dæmonens egen port (ellers 421), og **skrivninger** skal være `application/json` (ellers 415 — en formular kan ikke sætte den uden preflight). auth-relay har nu en kopi. To kopier af en sikkerhedsvagt driver fra hinanden.

## Scope
- Framework-fri kerne: `checkLocalRequest(req: Request, { port, allowHosts? }) → null | Response` (421/415 med navngiven grund).
- Tynde adaptere (Hono middleware; Bun.serve-wrapper) hvis begge forbrugere bruger dem.
- Porten gives ind (lens' ønske — dæmon og ARS kører på hver sin).
- Kilden er lens' version (packages/daemon/src i broberg-ai/lens); auth-relay's kopi sammenlignes linje for linje før udtræk, og afvigelser nævnes.

## Non-goals
- Auth/tokens (det er sso's).
- CORS-konfiguration ud over at afvise.

## Arkitektur
```
request → Host ∈ {127.0.0.1:port, localhost:port, [::1]:port}? else 421
        → method ∈ {POST,PUT,PATCH,DELETE} && content-type ≠ application/json? → 415
        → null (videre)
```

## Reuse
Discovery-søgning 25/10 («host header guard dns rebinding», «local daemon json content-type guard»): intet match. Kilden genbruges fra lens frem for at skrive ny.

## Afhængigheder
lens' kildefil (læses fra broberg-ai/lens). Bootstrap-publish af ny pakke kræver Christians OTP (ny npm-navn, se CLAUDE.md).

## Rollout
v0.1.0 → lens flytter i et patch-release → auth-relay flytter → begge kopier slettet.
