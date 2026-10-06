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
  layout="inset"                        // default; "topbar" = the 0.2.x full-width bar
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
| `AccountPage` | The user's own name and picture, edited inside the app (0.4.0). |
| `AnalyticsPage` | The app's own visitors, page views, page views per day and most visited pages, from Upmetrics (0.6.0). |

## 0.6.0 — AnalyticsPage: the app's own numbers from Upmetrics (F097.1)

```tsx
import { AnalyticsPage } from "@broberg/app-shell/preact";
<AnalyticsPage lang="da" />            // GET /api/analytics?days=N, periods 7 / 30 / 90
```

The server half is Upmetrics' own, in `@upmetrics/sdk` ≥0.11.0. The `uk_` key
stays on the server, and the route belongs behind your login:

```ts
import { analyticsRoutes } from "@upmetrics/sdk/hono";
import { getSession } from "@broberg/sso/hono";
// JSON 401, not sso.require: require REDIRECTS to login, which an API call cannot follow.
app.use("/api/analytics", sso.attach, (c, next) => (getSession(c) ? next() : c.json({ error: "unauthenticated" }, 401)));
app.route("/", analyticsRoutes());     // UPMETRICS_API_KEY from env, or analyticsRoutes({ projectKey })
```

- **Two totals** (visitors, page views) are shown against the previous period
  of the same length, with «Ingen sammenligning» when that period was 0.
- **Page views per day** draws every day of the period. Upmetrics only sends
  days with visits, and `fillDays` fills the rest on the **Europe/Copenhagen**
  calendar, as Upmetrics counts. A screen reader gets the same numbers as a table.
- **Most visited pages:** a long path is cut off with … inside its row and never
  widens the page.
- **No zeros that look real.** 503 `analytics_unconfigured` shows «Analytics er
  ikke sat op», and anything else (502, no answer, a body that is not analytics)
  shows «Upmetrics svarer ikke lige nu».
- `adapter` swaps the source; `periods` and `initialDays` change the buttons.
  This package does not depend on `@upmetrics/sdk`: the data type is structural.

## 0.5.0 — the user menu follows the account page (F095.5)

`onProfileChange(profile)` is called with the profile **as the server now holds
it** after a name save, a picture upload or a removal. It is never called on load
or after a failed save. Pass it to the shell's `user`, so the menu changes at once:

```tsx
const [user, setUser] = useState(sessionUser);
<AppShell user={user} …>
  <AccountPage lang="da" onProfileChange={(p) => setUser({ ...user, name: p.name ?? undefined, picture: p.picture ?? undefined })} />
</AppShell>
```

With `@broberg/sso` ≥0.11 the session cookie is re-signed with the new name and
picture as well, so the menu is also right after a reload. «Gem» is disabled
while the name (trimmed) equals what the server holds.

## 0.4.0 — AccountPage: name and picture, edited inside the app (F095.3)

The user changes their own name and profile picture without leaving for
id.broberg.ai. Purely additive: nothing else in the shell moved.

```tsx
import { AccountPage } from "@broberg/app-shell/preact";

<AccountPage lang="da" />                       // talks to /api/account (below)
<AccountPage lang="en" adapter={myAdapter} reauthHref="/login?next=/me" />
```

**Backend.** The default adapter speaks to `@broberg/sso`'s `accountRoutes()`
mounted on `/api/account` (this package does not import sso):

| Call | Request | Answer |
|---|---|---|
| `load()` | `GET /api/account/profile` | `{ sub, name, picture, email, account_url }` |
| `saveName(name)` | `POST /api/account/profile` `{ name }` | the profile |
| `uploadAvatar(file)` | `POST /api/account/profile/avatar`, raw bytes, `Content-Type` = the image's | the profile |
| `removeAvatar()` | `POST /api/account/profile/avatar/remove` | the profile |

Point it elsewhere with `createFetchAccountAdapter({ url })`, or pass any
`{ load, saveName, uploadAvatar, removeAvatar }` that resolves to the profile.
A non-2xx throws an `AccountError` (`status`, `code`) — a failed save never
looks saved.

**What the page shows after a save is the server's answer.** The name field
and the shown name are set from the response, never from what was typed — if
Broberg ID trims the name, the field shows the trimmed name. On a failed save
the error shows and the field keeps the typed text.

**Picture.** A custom button over a hidden `<input type=file
accept="image/png,image/jpeg,image/webp">`. Over 2 MB or another type is
refused with a message **before** anything is sent. Remove asks inline
(Fjern / Annuller), never `confirm()`. The avatar is round by CSS; no cropping
in v1.

**Signing in again is a normal state.** Broberg ID issues no refresh token, so
about an hour after login every change answers `401 reauth`. A 401 (or `403
insufficient_scope`) shows «Log ind igen for at rette» / "Sign in again to make
changes" with a button that does a full page load to `reauthHref` — default
`/auth/login?returnTo=<this page>` (no `prompt=login`: BID still has the
session and offers «Fortsæt som …») — and the fields go read-only.

**«Sikkerhed i Broberg ID»** links to `account_url` in a new tab.

**Test ids:** `account-page`, `account-avatar`, `account-avatar-file`,
`account-avatar-upload`, `account-avatar-remove`,
`account-avatar-remove-confirmation`, `account-avatar-remove-confirm`,
`account-avatar-remove-cancel`, `account-name`, `account-email`,
`account-name-input`, `account-name-save`, `account-ok`, `account-error`,
`account-reauth`, `account-reauth-signin`, `account-bid-link`.

## 0.3.0 — inset layout by default, links that leave open a new tab, a language row (F092.8, .10, .11)

**Breaking (visual):** `layout` now defaults to **`"inset"`**, shadcn
dashboard-01's layout: no full-width top bar. The brand heads the sidebar (and
folds away with it), and the content's top row is

`[sidebar button] | [title] ……… [actions] [bell] [user menu]`

The 0.2.x bar is `layout="topbar"`. The bell and user menu keep their testids
(`topbar-notifications`, `topbar-user-menu`) in both layouts — the names are
historical — and in inset the sidebar's brand link is `brand-home`.

- **External links open in a new tab** (D-d28547): every link the shell renders
  goes through one place, so an http(s) link to another origin — the account
  page at Broberg ID, a sidebar item, a menu item, a notification — gets
  `target="_blank" rel="noopener noreferrer"` and never reaches your router.
  Internal links (`/account` included) go through `onNavigate` as before.
  `isExternal(href)` is exported.
- **Language:** `userMenu.language = { value, options: [{ id, label }], onChange }`
  adds a «Sprog»/«Language» row with the same segmented control as Theme and
  Palette. The app owns the language; the shell shows and reports it. Arrow keys
  move between the options in every segmented row.

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
  beats its parent). No title → no empty `<h1>`. **0.2.1:** `PageHeader.title`
  is optional, so a page keeps its description and actions under the content
  header without repeating the title (dashboard-01 has the title only up top).
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

### The bell panel closes itself (0.2.3)

«Markér alle læst» closes the panel when it worked and leaves it open with an
error when it did not (`notifications-mark-all-error`) — a panel that closed on a
failure would hide that nothing was marked. A click anywhere outside the bell and
its panel closes it, and Escape closes it and puts focus back on the bell.

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

