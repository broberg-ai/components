# @broberg/app-shell

The fleet's app shell — the frame every app was copying: a collapsible sidebar,
a top bar with the **notification bell and the user menu as standard**, and a
page header with tabs. Framework-free core + Preact (Stack B). React (Stack A)
follows. Lifted in shape from cardmem and trail (F092).

```ts
import "@broberg/theme/css/palettes.css";
import "@broberg/app-shell/css/app-shell.css";
import { AppShell, PageHeader, PageTabs, createFetchNotificationSource } from "@broberg/app-shell/preact";

const notifications = createFetchNotificationSource({ url: "/api/notifications" });

<AppShell
  brand={<Logo />}
  groups={[{ label: "Overview", items: [{ id: "home", label: "Home", href: "/", icon: <HomeIcon /> }] }]}
  footer={[{ id: "settings", label: "Settings", href: "/settings" }]}
  currentPath={path}
  onNavigate={navigate}                 // SPA navigation; omit for normal links
  notifications={notifications}
  user={{ name, email, picture }}       // picture = Broberg ID's OIDC `picture`
  userMenu={{ accountHref: "https://id.broberg.ai/account", onSignOut }}
  mobile="drawer"                       // or "rail"
  collapse="icon"                       // desktop fold: "offcanvas" (default) or an icon rail
  brandMark={<LogoIcon />}              // top of the icon rail
  homeHref="/"                          // brand + brandMark link to the start page
  title="Dokumenter"                    // optional: else the active nav item's label
  lang="da"
>
  <PageHeader eyebrow="Settings" title="Indstillinger" />
  <PageTabs tabs={[{ id: "general", label: "Generelt" }, { id: "team", label: "Team" }]} currentUrl={url} />
  …
</AppShell>
```

Set up `@broberg/theme` first (`initTheme`, `initPalette`, `prePaintScript`) —
the user menu reads and writes theme, palette, surfaces and backdrop through it.

## The parts

| Export | What it is |
|---|---|
| `AppShell` | Top bar + sidebar + `<main>` with a content header (sidebar button · rule · page title, as shadcn dashboard-01); remembers the fold, folded groups and open items (`storageKey`). |
| `Sidebar` | Groups (foldable, remembered) + footer, from data. Items can have `children` (one level) that open and close. Active item from `currentPath`. Badges, 99+. |
| `TopBar` | Brand left, `actions` slot, then **the bell and the user menu, always last, in that order**. |
| `NotificationBell` | Unread count, panel (dropdown on desktop, bottom sheet on a phone), mark one / all read. |
| `UserMenu` | Avatar, name + email, **Konto** → Broberg ID, your items, Theme · Palette · Surfaces · Backdrop, sign out. |
| `PageHeader`, `PageTabs` | Eyebrow/title/description/actions; tabs as routes (`?tab=` or one path per tab). |
| `Avatar` | `picture` when given, otherwise initials. |

## 0.2.0 — one sidebar button, sub-items, an icon rail, the logo goes home (F092.4–.7)

**Breaking:** the three sidebar buttons are now ONE. `sidebar-collapse` («<» in
the sidebar), `sidebar-expand` («>» when folded) and `sidebar-toggle` (the
hamburger) are gone; `Sidebar` no longer takes `onToggleCollapse`.

- **The sidebar button** (`sidebar-trigger`, lucide `PanelLeft`, 16px in a 28px
  ghost button) sits at the far left of a content header at the top of `<main>`,
  then a 16px rule, then the page title as `<h1>` — shadcn dashboard-01's
  site-header. Desktop: folds the sidebar, remembered. Phone: opens the drawer.
  `aria-expanded` and `aria-label` follow the state.
- **The title** is `title`, else the label of the active nav item (a sub-item
  beats its parent). No title → no empty `<h1>`. If you also render
  `PageHeader`, that is a second `<h1>`; use one or the other as your page title.
- **Sub-items:** `NavItem.children` (one level). The parent is a button with a
  chevron that turns 90° (`sidebar-item-<id>-toggle`, `aria-expanded`); the
  children sit indented behind a thin rule. Open items are remembered; the
  parent of the current page starts open and is marked.
- **`collapse="icon"`** folds to a 48px rail instead of hiding: `brandMark` on
  top, each item's icon with its label as `aria-label` and tooltip, the current
  page marked. A parent opens its children in a flyout
  (`sidebar-flyout-<id>`), closed by Escape or a click outside. Default:
  `"icon"` when `mobile="rail"`, else `"offcanvas"`.
- **`homeHref`** makes the brand (top bar and drawer) and the `brandMark` links
  to the start page (`brand-home`, `sidebar-brand-home`, `brand-mark-home`),
  through `onNavigate`; cmd/ctrl-click opens a tab as usual, and on a phone the
  click closes the drawer. `homeLabel` names the icon-only `brandMark` link
  (default «Forside»/«Home»).

## Phone: `mobile="drawer"` or `mobile="rail"`

- **drawer** (cardmem): the sidebar button opens the sidebar over a backdrop; a tap on the backdrop or on a link closes it.
- **rail** (trail): the sidebar is a 60px icon rail; the sidebar button is hidden (there is nothing to fold).

## Notifications are standard — on @broberg/notifications

The bell is always in the top bar; with no source it shows an empty list, not
nothing. It does not invent a second notification contract: rows are
`NotificationRow` from **@broberg/notifications** (the fleet's shape, the same
field names @broberg/webpush sends), and the panel is driven by that package's
`createBellShell` — one count however many bells, Escape on the innermost layer,
and the ids "mark all read" cleared held for the visit. Put
`createNotifications` behind your endpoint and the server's one counting rule
(muted kinds excluded) is what the badge shows.

`createFetchNotificationSource({ url })` is the default source:

| call | request | response |
|---|---|---|
| rows + count | `GET {url}` | `{ items: NotificationRow[], unseen: number }` |
| mark seen | `POST {url}/seen` `{ ids }` | `{ clearedIds, count }` |
| mark all seen | `POST {url}/seen-all` | `{ clearedIds, count }` |

The server's `unseen` wins over counting rows. It re-counts on focus, on a
visible tab and every 60 s (`pollMs`). A failed load shows **«Kunne ikke hente
notifikationer»** — never «no notifications», because those two must not look
the same. `createMemoryNotificationSource(rows)` is for demos and tests; write
your own `NotificationSource` for SSE or anything else.

### A notification link is server data (0.1.1)

A row's `navigate` comes from your server and ends in `location.assign` (or your
`onNavigate`). Only a same-site path (`/…`, not `//…`) or an `http(s)` URL is
followed; `javascript:`, `data:` and anything else is refused, and the click only
marks the row seen. `safeNavigate(target)` is exported if you route links yourself.
0.1.0 followed any value — upgrade.

## `lang` is required

Every component that shows text takes `lang: "da" | "en"` with no default — the
rule @broberg/notifications' bell shell set for a measured reason: a default
makes "nobody chose" look like a choice, and an app shipped Danish strings for
months in an English UI that way.

## Avatar — no Gravatar

The avatar is Broberg ID's `picture`; without it, initials. There is no
Gravatar fallback (owner decision D-1dc849: no more US services than necessary —
Gravatar receives a hash of the user's email). A test fails if Gravatar enters
the source.

## Styling

`css/app-shell.css` uses only `@broberg/theme` tokens (`--bg`, `--fg`,
`--border`, `--surface-header`, `--surface-panel`, `--surface-work` …), so every
palette × light/dark × flat/layered works with no extra CSS. A test fails on any
colour literal in it. Classes are prefixed `bas-` so they cannot collide with an
app's own during a migration. Every control has a `data-testid`.

