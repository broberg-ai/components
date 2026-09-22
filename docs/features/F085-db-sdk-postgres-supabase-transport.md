# F085 — Flåden må ikke være Turso-only: en PostgreSQL/Supabase-transport til `@broberg/db-sdk`

> **Status:** backlog. **Intet bygges før åbent spørgsmål 1 er besvaret** — se nedenfor.
> **Ordren:** Christian, 22. september 2026: *«ja gør det og klargør at vi får bygget en postGreSQL adapter så vi ikke kun har turso.»*

---

## Åbne spørgsmål — 2 til Christian

De står øverst med vilje, fordi svaret på nr. 1 afgør om der overhovedet kan skrives kode.

### 1. HVOR skal adapteren bygges? (blokerende)

`@broberg/db-sdk` ejes ikke af `components`. Målt 22/9 2026:

| | |
|---|---|
| npm | én udgivelse, `v0.1.0`, 8. juni 2026 — ingen siden |
| GitHub | `broberg-ai/db-sdk`, sidst rørt **8. juni 2026**, samme dag |
| agent-session | **ingen** — der er ingen at sende opgaven til |
| lokal klon | findes ikke på nogen af flådens maskiner |

Tre veje, og det er en ejerbeslutning, ikke min:

**(a) Genopliv `broberg-ai/db-sdk`** — start en session på repoet, byg adapteren dér. Pakken bliver hvor den er, ejerskabet er klart. Prisen: endnu et repo med endnu en udgivelsespipeline, og historikken siger at det repo ikke holdes varmt af sig selv.

**(b) Fold pakken ind i `components` som `packages/db-sdk`.** Vi har allerede 39 pakker, en OIDC-publiceringspipeline på tags, en testport og en session der kører hver dag. `@broberg/ai-sdk` — som db-sdk's egen dokumentation udpeger som sin forbillede-model — bor i sit eget repo, så det er ikke et argument i sig selv. Prisen: navnet `@broberg/db-sdk` skal have en ny Trusted Publisher, og `src`/`own` i registret skal rettes.

**(c) Lad den ligge, og lad Postgres-apps bruge drizzles egen Postgres-driver direkte.** Det ærlige alternativ: hvis den delte værdi kun er forbindelses-config plus en health-probe, er en SDK måske ikke prisen værd. Skrevet her frem for udeladt, fordi et «byg det» der aldrig blev holdt op mod «byg det ikke» er en beslutning ingen har truffet.

**Min anbefaling: (b).** Begrundelsen er ikke smag, den er målt: et repo der ikke er rørt i 3½ måned og ikke har en session, er ikke et sted hvor en fælles kapacitet holdes i live. `components` har porten, pipelinen og den daglige session i forvejen. Men det er hans kald.

### 2. Hvilken forbruger piloterer den?

En transport uden en app der faktisk kører på den, er utestet uanset hvor grøn suiten er. Supabase bærer allerede fire apps ifølge registrets infranote — `sanne`, `xrt81`, `fds`, `fdaa`. Skal en af dem migreres som pilot, eller bygges adapteren mod en frisk Supabase-instans indtil en app er klar?

---

## Motivation

**Flåden er delt i to, og den delte SDK dækker kun den ene halvdel.**

- Turso/libSQL: `@broberg/db-sdk`, Buddy Cloud.
- Supabase/Postgres: `sanne`, `xrt81`, `fds`, `fdaa` — fire kundeapps.

Hele begrundelsen for en delt data-SDK er Christians egen prøve fra genbrugsreglen: *hvis jeg vil skifte leverandør, retter jeg det så ÉT sted eller sytten?* I dag er svaret sytten for alt hvad der ikke er Turso — fordi der ikke er nogen indgang at rette.

## Det målte fund: et løfte der er ældre end koden

Hele pakken er **52 linjer JS** omkring `@libsql/client`, med tre funktioner: `createClient`, `createReplica`, `health`.

Pakkens beskrivelse siger *«Turso/libSQL today; Postgres/Supabase transports later»*, og en kommentar i koden lover ordret:

> *«Add it under src/backends/ and widen the Backend type; the public API stays the same.»*

**Målt i den udgivne 0.1.0-tarball er den sætning forkert tre steder**, og hver af dem tvinger en brydende ændring:

| Sted | Hvorfor det ikke kan udvides |
|---|---|
| `createClient()` | Returnerer `Client` — **importeret og re-eksporteret fra `@libsql/client`**. En Postgres-klient er ikke den type. |
| `health()` | Kører `select sqlite_version()`. Findes ikke i Postgres. |
| `createReplica()` | Embedded replica er et libSQL-begreb uden Postgres-pendant med samme semantik. |

`Backend` er en union med ét medlem (`'libsql'`), og en anden værdi kaster. Det er **ærligt** — den fejler lukket frem for at foregive — men det betyder at der ikke er noget at udvide. En Postgres-transport er en omskrivning af den offentlige flade.

> **Mønsteret er værd at navngive, for vi fandt det to gange samme dag.** `broberg-id`s `config.ts` lover en `libsql://`-URL og læser `BID_DATABASE_AUTH_TOKEN` mens `@libsql/client` aldrig importeres. `db-sdk` lover Supabase «later» med en begrundelse der ikke holder. **Et løfte der er ældre end koden læses af den næste som om vejen allerede findes halvvejs** — og det koster en fejlsøgning hver gang.

## Arkitektur-skitse

Den bærende beslutning er **hvad `createClient` returnerer**, for alt andet følger af den.

**Forkastet — beholde `@libsql/client`s `Client` som returtype.** Så kan en Postgres-transport per definition ikke svare. Det er den nuværende tilstand, og den er grunden til at epicen findes.

**Forkastet — to separate indgange (`createClient` + `createPgClient`).** Ikke-brydende og billigt, men det leverer ikke det pakken findes for: en forbruger der vil skifte leverandør skal stadig ændre sine kaldesteder. To facader er ikke én facade.

**Foreslået — en smal fælles flade, med en nødudgang.**

```ts
interface DbClient {
  execute(sql: string, args?: unknown[]): Promise<DbResult>
  batch(statements: …): Promise<DbResult[]>
  close(): Promise<void>
}
```

- `createClient()` returnerer `DbClient` — ikke en leverandørs egen type.
- **Nødudgangen er obligatorisk, ikke pynt.** En forbruger der har brug for noget transport-specifikt (`client.sync()` på en embedded replica, Postgres' `LISTEN/NOTIFY`) skal kunne nå den rå klient — ellers bliver facaden en tvangstrøje og nogen omgår den, hvilket er præcis den drift vi bygger den for at undgå.
- `createReplica()` **bliver libSQL-only og siges at være det i typen**, frem for at få en tom Postgres-gren der kaster. En funktion der kun giver mening for én transport er ikke en mangel — det er en ærlig asymmetri, og den skal stå i typesystemet.
- `health()` kan ikke være én forespørgsel. Den skal spørge transporten. Returværdien bør bære **hvilken transport der faktisk svarede** — ikke kun `{ok, version}` — så en forbruger kan se hvor data ligger frem for at udlede det af sin egen config. (Samme lektie som `@broberg/ai-sdk`: læs `usage.provider` af SVARET, ikke af tabellen over hvad der burde ske.)

**Versionering:** det er et **major-bump**. Under `1.0.0` er npm's caret patch-only, så en brydende ændring udgivet som `0.1.1` ville blive trukket ind automatisk hos enhver `^0.1.0`-forbruger. Enten `0.2.0` (caret beskytter) eller `1.0.0` (ærligst, og pakken har alligevel brug for at kunne love noget). **Ikke en patch.**

## Scope

**I scope:** en Postgres/Supabase-transport bag den fælles flade · den fælles `DbClient`-type + nødudgang til den rå klient · `health()` pr. transport, der siger hvem der svarede · migreringsnotat til `0.1.0`-forbrugere · rettelse af pakkens egen beskrivelse og kodekommentar, så løftet matcher koden · en test der beviser at **begge** transporter opfylder den samme flade.

**Non-goals:** ORM og skema (`drizzle` bliver i forbrugeren) · migreringsværktøj · Supabase auth (→ `@broberg/auth`) · Supabase storage (→ `@broberg/media`) · connection pooling ud over hvad driveren selv giver · at migrere nogen app som del af denne epic.

## Reuse

Discovery-tjek kørt 22/9 2026 før planen blev skrevet.

| Kapacitet | Findes der noget? | Beslutning |
|---|---|---|
| Database-transport | `@broberg/db-sdk` v0.1.0 — **libSQL only**, målt i tarballen | **Udvid den.** Det er hele epicen. Hånd-rullede Postgres-klienter pr. repo er præcis den drift genbrugsreglen findes for |
| Postgres-driver | `drizzle-orm` + `postgres`/`pg` — modne, brede | **Genbrug.** SDK'en skal pakke en eksisterende driver ind, aldrig skrive en wire-protokol |
| Supabase-opsætning | Registrets infranote: region `arn`, cookie-domæne-fælden bag proxy, service-role-nøglen server-side | **Genbrug noten.** Den bærer to fælder der allerede har kostet nogen tid |
| Facade-mønsteret | `@broberg/ai-sdk` (tiers + `usage` på svaret) og `@broberg/media` (`createMedia()` over udskiftelige leverandører) | **Genbrug formen.** `@broberg/media` er den nærmeste parallel og er bevist: én facade, flere leverandører, ingen leverandørtype i den offentlige flade |

## Afhængigheder

- **Blokeret af åbent spørgsmål 1** (hvor bygges den). Ingen kode før svaret.
- Ingen afhængighed til `components`' egne pakker.
- `broberg-id` (F084) er en *interesseret* part, ikke en afhængighed: de overvejer Turso til BID og fik 22/9 det ærlige svar at db-sdk's modenhed ikke bærer flådens login endnu.

## Rollout

1. Svar på åbent spørgsmål 1 → repo besluttet.
2. Den fælles `DbClient`-flade + libSQL-transporten portet til den. **Grøn suite + eksisterende forbruger uændret, før Postgres røres.**
3. Postgres/Supabase-transporten, mod en rigtig instans i `arn` — ikke mod en attrap. *En attrap af en fremmed part er venlig af konstruktion.*
4. Begge transporter kørt mod **samme** kontrakt-suite. En transport der kun består sin egen test beviser ingenting om facaden.
5. Major-bump + migreringsnotat. `0.1.0` trækkes ikke tilbage.
6. Pilot-app migreres (åbent spørgsmål 2), og **først derefter** meldes transporten som live i registret — `shipped` betyder at nogen kører på den, ikke at den er udgivet.
7. Registret opdateres: `ver`, beskrivelsen, og `kw` udvides med postgres/supabase **først når det er sandt**.

## Hvad der IKKE er bevist i denne plan

- At `drizzle`s Postgres-adapter kan sidde oven på den foreslåede `DbClient`-flade uden at miste noget. Ikke prøvet.
- At Buddy Cloud er den eneste `0.1.0`-forbruger. Den står som pilot i pakkens beskrivelse; jeg har ikke talt forbrugere i flåden.
- Hvorvidt embedded replicas har en Postgres-pendant der er god nok til at retfærdiggøre en fælles `createReplica`. Antaget nej, ikke undersøgt.
