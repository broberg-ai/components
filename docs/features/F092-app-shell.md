# F092 — `@broberg/app-shell`

> **INTERIM PLAN — åbne spørgsmål øverst.** Stories med AC skrives, når cardmem og trail har vist deres skal (#35949, #35950). Ingen kode før da.

## Åbne spørgsmål

1. Hvilke filer er skallen i trail/apps/admin (originalen) og cardmem/apps/web («ported from trail»), og hvor har de divergeret?
2. Hvad er app-specifikt (navigationsindhold, ruter) vs. genbrugelig kerne (layout, kollaps, mobil-drawer, tilstand gemt)?
3. Stak A (React/Next) samtidig eller efter stak B?

## Input modtaget 4/10

**cardmem (#1626, læst ud af import-graf, ikke runtime-verificeret):** skallen er `app.tsx:664-705` (`.app-shell-root` → TopNav + `.app-shell-row`{AppSidebar + main} + MobileBottomNav, collapsed-state), `components/ui/top-nav.tsx` (121), `app-sidebar.tsx` (556), `nav-model.ts` (145; FORMEN GROUPS→items{path,icon,label,badge} er kernen, indholdet er cardmems), `user-menu.tsx` (507), `mobile-bottom-nav.tsx` (102), `brand.tsx`, `page-header.tsx` + `page-tabs.tsx` (faner som ruter), `lib/navigate.ts`; CSS `.app-sidebar*`, `.user-menu-*`, `app-shell-*` i styles.css.
- App-specifikt, IKKE med: ProjectSwitcher, SuperPill, ShortcutsButton, CaptureMenu; i sidebaren aktivt projekt, lens-fejltal, skjul/vis pr. item, favoritter; i menuen tenant/chat/zoom-sektionerne.
- Foreslået kerne: **AppShell** (layout, kollaps, mobil-drawer + backdrop, bundnav), **Sidebar** (grupper, sammenklappelige grupper, fod; data som props; slots til header og badges), **TopBar** (brand-slot venstre, actions-slot, brugermenu ALTID yderst til højre), **UserMenu** (avatar, navn/e-mail, items som props, tema-sektion fra `@broberg/theme`, log-ud-callback), **PageHeader + PageTabs**.
- Afhængighed der skal løsnes: user-menu/top-nav importerer cardmems auth og mcp direkte → props/callbacks.
- Migrering: cardmem først, mål 0 visuel diff (Lens-baseline før/efter).

**broberg-id (#1625):** BID-tokenet har `sub, name, email, email_verified, picture`. Avatar = OIDC `picture`; upload bor i BID. **Gravatar sender en hash af e-mailen til USA**, så standarden i brugermenuen bør være initialer, med Gravatar som tilvalg.

**trail (#1627, målt i filerne):** originalen er `apps/admin/src/app.tsx` (TopNav + TrailSidebar + panel-ruter), `top-nav.tsx` (164; logo, tenant-pille, brain-brødkrumme, ⌘K, brugermenu), `trail-sidebar.tsx` (432; 240px ↔ 60px ikon-skinne, 4 grupper + fod, kollaps i localStorage, starter som skinne på telefon), `user-menu.tsx` (370). Divergens:
1. **Brugermenuen er allerede konvergeret** til cardmems form og rækkefølge (trail F311.5): identitet → kontoindstillinger → Theme · Palette · Surfaces · Backdrop · Language · Sound → log ud. App-egne punkter (cardmem: zoom/chat; trail: søg/lab på telefon) bliver props.
2. **Sidebaren betyder to ting:** trail kun INDE i en brain (global navigation i topbjælken); cardmem global, med Standard/Advanced-filter, live-badges og målt højde.
3. **Telefon:** trail = ikon-skinne; cardmem = hamburger-drawer + bundnavigation. → **Produktvalg for Christian** (vises i mockuppen).
4. Topbjælke: trail tenant-pille + brødkrumme; cardmem projektvælger + hamburger → begge er slots.

Trails råd [Likely]: struktur fra trail (topbar + collapsible sidebar + menu-slot), datamodel fra cardmem (`nav-model.ts`: GROUPS→items).

**Rettelse fra Christian via cardmem (#1628): klokken (notifikationscenter) SKAL med i skabelonen.** Kilde: cardmem `components/ui/notification-bell.tsx` (537; knap + panel/portal, mobil-variant via `use-is-mobile.ts`). Kun datakilden er cardmems (aktivt projekt, fetch/SSE, read-sync). Kerne: klokke, badge, panel, markér-som-læst, mobil-layout. Foreslået snit: `NotificationBell({ items, unreadCount, onOpen, onMarkRead, onMarkAllRead, renderItem? })`. Placering: i TopBar lige til venstre for brugermenuen.

**Christian, skarpere (#1629): «Klokken er notifications — det SKAL være en standard del af skabelonen.»** Det betyder:
- **Ikke et valgfrit slot.** TopBar har klokken med som STANDARD i både stak A og B.
- **En standard-datakontrakt** leveres af pakken: `Notification { id, title, body?, href?, created_at, read_at }`.
- **En minimal standard-kilde**, så en ny app har et virkende notifikationscenter fra første dag og kun skal pege den på sin backend.
- Reference for kontrakten: cardmem `GET /api/notifications` + SSE read-sync (cardmem F175).

## Næste skridt

Mockup i cardmem (begge telefon-varianter side om side) → Christians valg → stories med AC → kode. Mål for migrering: cardmem og trail med 0 visuel diff (Lens-baseline før/efter).

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
