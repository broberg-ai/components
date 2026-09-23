# F085 — Flåden må ikke være Turso-only: en PostgreSQL/Supabase-transport til `@broberg/db-sdk`

> **Status:** i gang. Åbent spørgsmål 1 er besvaret — se nedenfor.
> **Ordren:** Christian, 22. september 2026: *«ja gør det og klargør at vi får bygget en postGreSQL adapter så vi ikke kun har turso.»*

---

## Åbne spørgsmål — 1 til Christian

### ~~1. HVOR skal adapteren bygges?~~ BESVARET 23/9 2026

> Christian: *«Det skal fortsat placeres i det repo»* — altså **(a): `broberg-ai/db-sdk`**.

Bygges i `broberg-ai/db-sdk`, af `components`-sessionen (klonet til `~/.buddy/repos/db-sdk`). Kortene bliver på `components`-boardet. Beslutningen er foreslået til Decision Register (`01a0cf03-1032-7401-aed3-69251f90d9db`), så næste session ikke genforeslår (b).

Fravalgt, og hvorfor det stadig står her: **(b) fold ind i `components`** var min anbefaling (port, pipeline og daglig session findes her). **(c) byg den ikke** efterlader flåden Turso-only. Prisen ved (a), som vi nu betaler bevidst: repoet har ingen testport i CI i dag — `publish.yml` kører `bun test`, men kun ved et tag, og den eneste test springer over uden Turso-nøgler. Det lukkes i F085.2 (AC8).

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

## Målt 23/9: hvad den eneste forbruger faktisk kalder

Den eneste `0.1.0`-forbruger i flåden er **buddy** (`apps/server`, `"@broberg/db-sdk": "^0.1.0"`). GitHub-kodesøgning i `broberg-ai` gav nul træf, så tallet er fra de lokale kloner på `cb-2` — ikke en fuld optælling.

Hvad buddy kalder på klienten, målt ved grep i `src/db/cloud.ts` og `src/corpus/mirror.ts`:

| Kald | Bruges |
|---|---|
| `execute("sql")` | ja, mest (DDL, `PRAGMA`, `SELECT`) |
| `execute({ sql, args })` | ja |
| `batch(stmts, 'write')` | ja |
| `res.rows[i]['kolonne']` | ja — navngiven kolonne-adgang |
| `sync()` / `createReplica` | **nej** |
| drizzle oven på db-sdk-klienten | **nej** — buddys drizzle kører på sin lokale SQLite |

**To konsekvenser for designet:**

1. **Flade-formen er givet af forbrugeren.** `DbClient` skal have `execute(string | {sql,args})` og `batch(stmts, mode?)`, og rækker med navngiven adgang. Så kan buddy opgradere uden at røre sine kaldesteder — kun `^0.1.0` → `^0.2.0`.
2. **SQL-dialekten er IKKE portabel, og facaden må ikke lade som om.** buddys SQL er SQLite (`PRAGMA table_info`, `?`-pladsholdere). Postgres bruger `$1`. At oversætte `?` → `$n` i SDK'en er en fælde (et `?` i en streng-literal eller en JSON-operator bliver omskrevet). Facaden forener **forbindelse, udførelse, resultat-form og helbred** — ikke dialekten. Det skal stå i README'en med de ord, ellers genskaber vi præcis det løfte-ældre-end-koden F085 blev oprettet for.

**Og en Supabase-fælde der skal forsegles fra start:** Supabases forbindelses-pooler i transaktions-tilstand (port `6543`) og prepared statements, som `postgres.js` bruger som standard.

> **MÅLT 23/9 2026 (F085.3), og det var ikke den fejl planen forudsagde.** Mod et rigtigt Supabase-projekt (Gen2Code, eu-north-1), 40 samtidige forespørgsler med prepared statements SLÅET TIL: transaktions-pooleren **hang** efter 5–8 svar — ingen fejlbesked, 3 af 3 kørsler. Session-pooleren og den direkte forbindelse svarede 40/40. Én ad gangen bestod ALT, også med prepared statements til — så en sekventiel suite kan ikke se fælden, og en hængning uden tidsgrænse bliver aldrig rød. Forseglet med et samtidigheds-tilfælde (60 forespørgsler, 90 s frist) der kører gennem den rigtige pooler i CI; negativ kontrol: `prepare: true` → «HUNG: 60 concurrent queries did not finish in 90s».
>
> Testadgangen er en isoleret rolle, `db_sdk_contract`, der kun ejer sit eget skema og hverken kan læse eller skrive i projektets eksisterende tabeller (målt). Ingen eksisterende adgangskode er ændret. Adresserne ligger i vaulten under `components`.

## Opdeling i stories

| Story | Hvad | Blokeret af |
|---|---|---|
| **F085.2** | `DbClient`-fladen, libSQL portet til den, Postgres-transport, én kontrakt-suite mod begge — kørt mod en **rigtig** Postgres (lokal container + CI-service), ikke en attrap. CI-testport på hver push. | intet |
| **F085.3** | Samme kontrakt-suite mod en rigtig Supabase i `arn` via pooleren · udgivelse som `0.2.0` · migreringsnotat · registret opdateret | ~~en Supabase-instans~~ — Gen2Code, Christian 23/9 |
| **F085.4** | Pilot-app migreret; først derefter `shipped` for Postgres i registret | åbent spørgsmål 2 |

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

- ~~Blokeret af åbent spørgsmål 1~~ — besvaret 23/9: `broberg-ai/db-sdk`.
- F085.3 (rigtig Supabase i `arn`) kræver en Supabase-instans. Om en af de fire eksisterende må bruges til en prøvetabel, eller der skal oprettes en ny, er infra og derfor Christians.
- F085.4 (pilot) er blokeret af åbent spørgsmål 2.
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
