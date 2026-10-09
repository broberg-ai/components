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
| `TenantSwitcher` | The user's own organisations, the active one marked, switching through the app's route (0.7.1). |
| `AnalyticsPage` | The app's own visitors, page views, page views per day and most visited pages, from Upmetrics (0.6.0). |

## 0.9.2 — ConfirmDialog listens from the first frame (F092.14)

0.9.1 carried the same change but never reached npm: its publish run was stopped by a flaky test in this package (happy-dom followed an external link to the live site; now switched off). 0.9.2 is the first published version with the fix.

### What changed

Focus on Cancel and the Escape listener are now set in `useLayoutEffect`, at commit, not in `useEffect` after paint. appkit measured (Lens, real Chromium) that focus reached Cancel 153 ms after the window appeared; an Escape inside that gap went to the ⋮ trigger that still had focus and did nothing. No API change.

## 0.9.0 — ConfirmDialog: the confirm window instead of `window.confirm()` (F092.13)

Asked for by appkit for «Slet» in a `@broberg/data-table` row. No native `confirm()` or `<dialog>` (D-4cd764).

```tsx
import { ConfirmDialog } from "@broberg/app-shell/preact";

<ConfirmDialog
  open={!!pending}
  title="Slet dokument?"
  body={`«${pending?.title}» slettes permanent.`}
  confirmLabel="Slet"
  destructive
  busy={deleting}
  error={deleteError}
  onConfirm={() => remove(pending!.id)}
  onCancel={() => setPending(null)}
  testId="doc-delete"
/>
```

- `role="alertdialog"`, `aria-modal`, title and body wired with aria-labelledby/describedby. Closed renders nothing.
- **Focus starts on Cancel**, the safe button, so a stray Enter deletes nothing. Tab stays inside the window, and focus returns to whatever had it before (the ⋮ button).
- **Escape or a click on the backdrop cancels**; a click inside the window does not.
- **While `busy`**, both buttons are disabled and neither Escape nor the backdrop closes it: the request has already gone, and a window that vanished would let the user think they had cancelled a deletion that is happening. The confirm button shows a spinner.
- `error` appears inside the window as `role="alert"`; the window stays open so the user can retry or cancel. You decide when to close it (set `open` false on success).
- `destructive` makes the confirm button red. Labels default to Danish («Bekræft» / «Annuller»).
- testids: `<testId>`, `-backdrop`, `-title`, `-body`, `-error`, `-cancel`, `-confirm` (default prefix `confirm-dialog`).
- Styled in `css/app-shell.css` (`bas-confirm*`) on theme tokens only.

Purely additive: nothing that rendered in 0.8.0 renders differently.

## 0.8.0 — TenantSwitcher on a phone (F029.10, found by appkit's pilot)

- **The menu stays on screen.** It is anchored to the switcher, which sits among
  your actions rather than at the edge, so at 393 px it ran off the right side.
  It is now measured when it opens and shifted back inside, 16 px from the edge.
- **Changed output: no raw role.** Roles are your app's words, so the switcher
  cannot translate them, and a bare «member» in a Danish UI is worse than nothing.
  Pass `roleLabel={(role) => …}` to show them; without it, other rows show no role.
  The active row still says «aktiv», and a suspended one still says so.
- **On a phone the switcher takes at most 40% of the width**, and the organisation
  name is cut with «…» before the page title is.

## 0.7.1 — TenantSwitcher: the user's own organisations (F029.10)

0.7.0 was tagged but never reached npm: the secret gate stopped it on a test fixture key, now listed in `.gitleaksignore`.

```tsx
import { TenantSwitcher } from "@broberg/app-shell/preact";
<TenantSwitcher lang="da" activeSlug={tenant.slug} onSwitch={(slug) => location.assign(`/t/${slug}`)} />
```

- **Only the user's own memberships** are listed, from `GET /api/me/memberships`, which is
  `tenantRoutes` in `@broberg/tenant/hono`. A slug is never typed or guessed.
- **The active organisation is marked.** A suspended one is shown and cannot be chosen.
- **`onSwitch` is the app's own route**: navigation, or setting the preference and reloading.
  If it rejects, the switcher says «Kunne ikke skifte organisation. Du er stadig i …», keeps the
  current organisation and leaves the menu open. It never pretends a switch happened.
- **With one organisation** it is a plain label, not a menu. A failed load says so and offers a retry.
- It reuses the user menu's popover: Escape and a click outside close it. There is no native
  `<select>`, every control has a `data-testid`, and a long name is cut off instead of widening the bar.

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


## 0.10.0 — the user menu in the sidebar's footer, with radio groups and zoom (F092.15)

For a KAI-style shell (Scout's approved design): the user sits at the bottom of the sidebar and the menu opens upward. Everything is additive — without the new props nothing changes.

```tsx
<AppShell
  userMenuPlacement="sidebar-footer"          // default "topbar" = as before
  user={{ name, email, picture, subtitle: "Administrator · Enhed Nord" }}
  userMenu={{
    items: [{ id: "search", label: "Søg", hint: "⌘K", onSelect: openSearch }],   // hint: shown right-aligned; the app owns the shortcut
    sections: [
      { id: "org", label: "Organisation", items: [{ id: "acme", label: "Acme A/S", checked: true }, { id: "beta", label: "Beta ApS" }] },
      { id: "area", label: "Scout", items: [{ id: "chat", label: "Scout Chat", checked: true }, { id: "admin", label: "Scout Admin" }] },
    ],
    onSectionSelect: (sectionId, itemId) => …,   // radio groups; a pick closes the menu. The app owns the choice.
    zoom: { value: 100, onChange: setZoom },      // − / % / +; min 50, max 200, step 10 by default. The app applies it.
  }}
  …
/>
```

- Theme, palette, surfaces and backdrop were already in the menu (`appearance`); language too (`language`).
- testids: `sidebar-user-menu` (the button in the footer), `sidebar-user-subtitle`, `user-menu-section-<s>` and `user-menu-section-<s>-<i>`, `user-menu-zoom-out` / `-value` / `-in`. The panel keeps `topbar-user-menu-dropdown`.
- In the sidebar the panel is `position: fixed` at the button, so the sidebar cannot clip it. The open phone drawer now uses `transform: none` instead of `translateX(0)` — any transform makes the drawer the containing block for fixed children and cut the menu off at its edge. Same animation; nothing else moves.
- Try it: `pnpm --filter app-shell-example dev` → http://127.0.0.1:5195.
