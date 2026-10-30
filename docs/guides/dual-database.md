# To databaser — primær + reserve med logisk replikering

> Fast mønster for flåden (F109.1). Bestilt af ejeren via fd-sundhed (28/10 2026) og broberg-id (29/10 2026).
> Alt herunder er MÅLT i drift hos en af de to — kilden står ved hvert punkt.
> Kendte brugere: fd-sundhed, broberg-id (BID). vnleker får samme opsætning.

## Det ene, man skal forstå først

**Logisk replikering kopierer DATA, ikke SKEMA.** En kolonne, der lægges i primæren, kommer ikke af sig selv i reserven.

Får primæren en kolonne, som reserven mangler, sker dette:

1. Abonnementet i reserven **stopper** ved første række, det ikke kan placere.
2. Primæren **holder WAL tilbage** til replikerings-slottet, fordi reserven ikke kvitterer.
3. Når efterslæbet når `max_slot_wal_keep_size`, **opgives slottet**. Reserven er tabt og skal bygges helt op igen.

*Målt hos fd-sundhed 28/10:* to nye kolonner i prod, ikke i reserven → **5 timers stilstand**, slottet **128 MB fra at blive opgivet**.

## 1. Én dør for skemaændringer

Ingen skemaændring må gå direkte i én af baserne (fx Supabase MCP `apply_migration` mod primæren). Alle går gennem **ét script/én udrulnings-trin**, der rammer begge.

**Rækkefølgen har to målte svar — vælg bevidst:**

| | fd-sundhed: **reserven først** | BID: **primæren først, så reserven** |
|---|---|---|
| Sådan | Migrér-scriptet kører filen på reserven (`ON_ERROR_STOP`, én transaktion). Fejler den, **røres primæren ikke**. | `release_command` ved hver udrulning: prod først, så reserve + `refresh publication`. |
| Fordel | Reserven kan aldrig komme bagud på skemaet. | En login-rettelse venter aldrig på kopien. |
| Ulempe | En udrulning kan stoppes af kopien. | Reserven kan være bagud, indtil nogen reagerer. **Derfor SKAL en fejl på reserven alarmere** — ikke kun logges (BID lukkede netop det hul i F084.204). |
| Reference | `broberg-ai/fd-sundhed@4870a075` · `scripts/migrer.sh` | `broberg-ai/broberg-id` · `docs/RESERVE-DB.md` |

Det, begge varianter deler, er det, der betyder noget: **én dør, og en reserve der ikke fik ændringen, alarmerer.** Om flåden skal have én standard-rækkefølge, er ejerens valg (står som åbent spørgsmål i F109).

**Detaljer, der gælder begge:**

- **Ny tabel:** efter migreringen på reserven: `ALTER SUBSCRIPTION … REFRESH PUBLICATION WITH (copy_data = true);` — ellers replikeres den nye tabel ikke.
- **Udbyder-specifikke dele** (fx grants til roller, som kun findes i Supabase): læg dem i en separat `--reserve`-fil, så reserve-migreringen ikke fejler på en rolle, den ikke har (fd-sundhed).
- **Værktøjs-tabeller uden for skemaet:** hver tabel, et værktøj opretter selv (BID's `dbSwitchMarker`), skal også stå i skemafilerne. Ellers fejler nødgendannelsen (*målt hos BID 26/10*).

## 2. Mål sundheden fra primærens side

Primæren ved, om reserven følger med. Spørg den, ikke reserven:

```sql
-- efterslæb i bytes pr. slot
SELECT slot_name, active, wal_status,
       pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn) AS lag_bytes
FROM pg_replication_slots;
-- og pg_stat_replication for sidste svar
```

**Røde tilstande (BID):** slot mangler · slot inaktivt · `wal_status = 'lost'` · intet svar i over 300 s · efterslæb over 64 MB.
**fd-sundhed** bruger efterslæb over 100 MB som rød. Supabase opgiver slottet ved ca. 512 MB, så begge tærskler giver god tid.

**Alarm på efterslæb, ikke kun på stilstand.** En reserve, der kører men sakker bagud, er det, der ender med et opgivet slot. Hold efterslæb og netværksfejl adskilt i alarmen — de kræver forskellig handling.

**Egen rute:** kør sundhedstjekket på fx `/health/reserve`. **Aldrig** på den rute, platformen bruger til at afgøre om maskinen er rask — ellers genstarter Fly en sund app, fordi reserven har det dårligt (BID).

## 3. Hvem får besked, og hvornår

- **Et menneske får besked, når reserven har været usund i 10 minutter i træk:** én mail pr. episode. Et kort blink giver ingen mail (BID).
- **Undtagelse — med det samme, uden de 10 minutter:** fejler skemaopdateringen af reserven under en udrulning, alarmerer BID **straks**, og alarmen står, indtil en senere opdatering lykkes (`migration_failed` i `src/reserve-watch.ts`). Det er den del, der lukker hullet i «primæren først»: reserven kan være bagud, men aldrig uden at nogen ved det.
- **Episoden gemmes i databasen**, fordi der kører flere maskiner — ellers sender hver maskine sin egen mail (BID).
- **Tjek, at alarmen har en modtager.** BID's alarm stod uden modtager i drift (29/10).

## 4. Uret: cronjobs.webhouse.net, ikke GitHubs tidsplan

GitHubs egen `schedule` er upålidelig til vagter: *målt hos BID — 5 kørsler på 19 timer.* Brug `cronjobs.webhouse.net` som ur til vagter og daglige tjek.

## 5. IP-vagten: mål igen, før den handler

En vagt, der skifter adgang (fx åbner reservens IP-liste ved et nedbrud), skal **måle igen efter ca. 90 s**, før den gør noget. Et enkelt fejlet målepunkt er ikke et nedbrud (BID, F084.197).
Reference: `broberg-id` · `src/reserve-ip-guard.ts` (de 90 s) · `fd-sundhed` · `apps/web/src/lib/reserve/reserve-ip-guard.ts`.

## Tjekliste før en app går i drift med en reserve

- [ ] Alle skemaændringer går gennem ét script/udrulnings-trin, der rammer begge baser
- [ ] Rækkefølgen er valgt bevidst, og en fejl på reserven alarmerer
- [ ] Ny tabel → `REFRESH PUBLICATION` er en del af scriptet
- [ ] Værktøjs-tabeller står i skemaet
- [ ] `/health/reserve` måler slot, `wal_status`, sidste svar og efterslæb fra primærens side
- [ ] Et menneske får én mail pr. episode efter 10 min usund — og modtageren er sat
- [ ] Vagten kører på cronjobs.webhouse.net
- [ ] En gendannelse er prøvet mod en tom instans

## Kilder

- fd-sundhed #5350 (28/10 2026) · `broberg-ai/fd-sundhed@4870a075`: `scripts/migrer.sh`, `apps/web/src/lib/reserve/reserve-ip-guard.ts`
- broberg-id #5360 (29/10 2026) · `broberg-ai/broberg-id`: `docs/RESERVE-DB.md`, `docs/noedplan-database.md`, `docs/OEJEBLIKKELIGT-SKIFT.md`, `src/reserve-health.ts`, `src/reserve-watch.ts`
- neon.com/docs/guides/logical-replication-schema-changes · wiki.postgresql.org/wiki/Logical_replication_of_DDLs

Se også: [Høj tilgængelighed — 3 maskiner på 2 regioner](ha-multi-region.md).
