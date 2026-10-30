# F109 — Fælles How-To til drift

**Status:** In progress · **Skrevet:** 2026-10-30 · **Bestilt af:** ejeren, via fd-sundhed (#5350) og broberg-id (#5360, #5368)

## Hvorfor

To apps har uafhængigt af hinanden betalt for den samme lærdom om en reserve-database, og en tredje (vnleker) skal have samme opsætning. fd-sundhed stod 28/10 med en replikering, der havde stået stille i 5 timer og var 128 MB fra at blive opgivet, fordi to nye kolonner kom i primæren og ikke i reserven. BID har målt resten: sundhedsmåling, alarmer, gendannelse og HA på tværs af regioner.

Ejerens ord: det skal stå som et **fast mønster på Discovery**, så den næste app læser det før den bygger — ikke efter den har mistet en reserve.

## Scope

- **F109.1** — `docs/guides/dual-database.md`: primær + reserve med logisk replikering. Skemaændringer, sundhed, alarm, gendannelse, IP-vagt.
- **F109.2** — `docs/guides/ha-multi-region.md`: 3 maskiner på 2 regioner (arn + ams), faste udgående adresser, pris og oppetid.
- Hver guide får et tip i Discovery-rosterens INFRA (`supabase` og `fly`), som peger på guiden — samme mønster som `docs/guides/foldables-pwa.md`.

## Non-goals

- Ingen fælles kode-pakke endnu. Begge apps har referenceimplementeringer; en pakke er en senere beslutning, når tredje app har brugt mønsteret.
- components vælger ikke på ejerens vegne, hvor apps er uenige (se nedenfor).

## Åbent spørgsmål til ejeren

**Rækkefølgen ved en skemaændring er der to målte svar på:**

- **fd-sundhed: reserven FØRST.** Fejler den, røres primæren ikke. Fordel: reserven kan aldrig komme bagud på skemaet. Ulempe: en udrulning kan stoppes af kopien.
- **BID: primæren først, så reserven.** En fejl på reserven stopper ikke udrulningen — men SKAL alarmere. Fordel: en login-rettelse venter aldrig på kopien. Ulempe: reserven kan være bagud indtil nogen reagerer på alarmen.

Begge deler den invariant, der betyder noget: **én dør for skemaændringer, og en reserve der ikke fik ændringen, alarmerer.** Guiden beskriver begge varianter med deres afvejning. Skal flåden have én standard, er det ejerens valg.

## Reuse

Ingen `@broberg/*`-pakke dækker reserve-databaser eller HA (Discovery-søgning). Guiderne henviser til referenceimplementeringerne i broberg-id og fd-sundhed i stedet for at kopiere deres kode.
