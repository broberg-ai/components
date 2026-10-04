# F092 — `@broberg/app-shell`

> **INTERIM PLAN — åbne spørgsmål øverst.** Stories med AC skrives, når cardmem og trail har vist deres skal (#35949, #35950). Ingen kode før da.

## Åbne spørgsmål

1. Hvilke filer er skallen i trail/apps/admin (originalen) og cardmem/apps/web («ported from trail»), og hvor har de divergeret?
2. Hvad er app-specifikt (navigationsindhold, ruter) vs. genbrugelig kerne (layout, kollaps, mobil-drawer, tilstand gemt)?
3. Stak A (React/Next) samtidig eller efter stak B?

## Hvorfor

Christian 4/10 (via appkit): appkit bliver en TYND starter (stak A Next + stak B lean); al genbrugelig kode ligger i offentlige `@broberg/*`-pakker. Skallen findes i dag i trail og cardmem (kopi), og helpdesk + nye apps vil ellers lave den tredje og fjerde.

## Ramme

- Kerne (framework-fri tilstand: kollapset/udvidet, mobil-drawer, gemt pr. bruger) + Preact-del (stak B) + React-del (stak A).
- Uden shadcn i stak B (appkit; D-353be1 opdatering afventer Christian).
- Bruger tokens fra `@broberg/theme` (palettes.css: `--surface-header`, `--surface-panel`, `--surface-work`, `--bg-card` …) og har en plads til brugermenuen (F034) øverst til højre.
- `data-testid` på hver interaktiv kontrol (F086-reglen).
- Mockup i cardmem før kode (F122).

## Rækkefølge (aftalt med appkit 4/10)

1. F092 app-skal + F034 brugermenu
2. F017 settings-skal
3. F009 team/roller/invitationer (afhænger af BIDs identitetsmodel)
4. F093 backup/restore til R2

Profilbillede (F012) foreslået lagt i BID, som allerede har avatarlager på `@broberg/media` (appkit bekræfter med broberg-id).

## Reuse

Discovery: ingen app-shell-pakke. Bygger på `@broberg/theme` 0.11 (tokens, palet, flader, baggrund). Kilde: trail/apps/admin + cardmem/apps/web.
