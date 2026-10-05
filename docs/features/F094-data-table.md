# F094 — `@broberg/data-table`

**Kilde:** Christian 5/10 via appkit (#1696, appkit-F015.1): «En af de mere fantastiske ting der er i shadcn/ui er deres data tables … vi skal have det med som standard til at vise tabeller i stack b apps». Fem skærmbilleder af shadcn dashboard-01. Mobil (#1702): «Husk cards på mobile».

## Krav (fra appkit-F015.1)
Sortering ved klik på kolonnehoved · søgning · sidevisning (rækker pr. side, side x af y, første/forrige/næste/sidste) · multi-select med vælg-alle og halv-tilstand og «x af y valgt» · «Tilpas kolonner» (huskes) · træk-håndtag med mus, touch og tastatur → onReorder · ⋮-menu pr. række med skillelinje og rød destruktiv handling · celletyper: mærke, status med ikon, højrestillet tal, vælger-celle med flueben → onCellChange · mobil = kort, ingen vandret rulning.

Begrænsninger: Preact uden shadcn og uden preact/compat (D-7598d1); ingen native select/dialog, tastatur overalt (D-4cd764); data-testid på alt interaktivt; kun @broberg/theme-tokens.

## Design (forslag)
- **Kerne uden framework** (`@broberg/data-table`): rækkemodel, sortering, søgning, sidevisning, valg, kolonne-synlighed og flyt-række som rene funktioner. Preact-del (`@broberg/data-table/preact`) tegner.
- **Motor:** vi skriver de fem tabel-operationer selv (~200 linjer, rene funktioner med tests) i stedet for `@tanstack/table-core`. Grund: table-core er bygget til en adapter pr. framework, og vi skal kun bruge en lille del; en afhængighed der styrer state lader sig dårligt mutationsteste herfra. Afgøres i F094.1 og kan vændes, hvis det viser sig forkert.
- **Træk-og-slip:** pointer events (mus og touch i én kode) + tastatur (mellemrum løfter, pile flytter, mellemrum slipper, Escape fortryder), med live-region til skærmlæser. Ingen afhængighed; dnd-kit kræver React.
- **Dropdowns og menuer** («Tilpas kolonner», ⋮-menu, vælger-celle, rækker pr. side): genbruger `@broberg/ui-controls-core` (`selectKeyReducer`, `makeOutsideClickHandler`).
- **Faner med tal over tabellen:** genbruger app-shells `PageTabs` (får evt. et `count` pr. fane) — ikke en ny komponent.
- **Mobil (<768 px):** hver række er et kort med kolonnerne stablet; afkrydsning, håndtag og ⋮-menu i kortets top. Ingen vandret rulning nogen steder.
- **Gemning:** appen ejer data; tabellen kalder `onReorder`, `onCellChange`, `onSelectionChange`, `rowActions`.

## Stories
F094.1 kerne + desktop-tabel · F094.2 træk-og-slip · F094.3 mobil-kort · F094.4 eksempelside, Lens 393/1440, udgivelse 0.1.0.

## Reuse
Discovery 5/10: søgning på table / data table / drag and drop / dropdown / menu / checkbox gav intet. Genbrug: `@broberg/ui-controls-core` (tastatur + klik-udenfor), `@broberg/theme` (tokens), `@broberg/app-shell` (PageTabs). Bygges her (components ejer delte UI-pakker, D-a84d0a).