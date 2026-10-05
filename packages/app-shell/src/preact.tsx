/** @jsxImportSource preact */
// @broberg/app-shell/preact — the fleet's app shell for Stack B (F092).
//
// Lifted in shape from cardmem (apps/web/src/components/ui: top-nav, app-sidebar,
// notification-bell, user-menu, page-header, page-tabs; origin/main af80f192)
// and trail (the original), rewritten as props-in components: nothing here
// knows about any app's auth, router or data. Styling is css/app-shell.css,
// on @broberg/theme's tokens, so every palette × light/dark × flat/layered works.
//
// Use the whole thing:
//   <AppShell brand={…} groups={…} currentPath={path} user={…} notifications={source}
//             accountHref="https://id.broberg.ai/account" onSignOut={…}>{page}</AppShell>
// or compose the parts (Sidebar, TopBar, NotificationBell, UserMenu,
// PageHeader, PageTabs) in your own layout.

import type { ComponentChildren, JSX } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { createBellShell } from "@broberg/notifications/shell";
import {
  getBackdrop,
  getPalette,
  getPreference,
  getSurfaces,
  onBackdropChange,
  onPaletteChange,
  onSurfacesChange,
  onThemeChange,
  PALETTE_LABELS,
  PALETTES,
  setBackdrop,
  setPalette,
  setPreference,
  setSurfaces,
  type Backdrop,
  type Palette,
  type Surfaces,
  type ThemePreference,
} from "@broberg/theme";
import {
  badgeLabel,
  initials,
  isActivePath,
  readFlag,
  readSet,
  relativeTime,
  TEXT,
  writeFlag,
  writeSet,
  type Lang,
  type NavGroup,
  type NavItem,
  type NotificationRow,
  type NotificationSource,
} from "./index";

export * from "./index";

type Icon = ComponentChildren;
export type PreactNavItem = NavItem<Icon>;
export type PreactNavGroup = NavGroup<Icon>;
/** Called instead of a full page load when given. Return false to let the browser navigate. */
export type Navigate = (href: string) => void;

const MOBILE_QUERY = "(max-width: 767px)";

/** True below 768px. Follows the window as it resizes. */
export function useIsMobile(): boolean {
  const get = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(MOBILE_QUERY).matches;
  const [mobile, setMobile] = useState(get);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(MOBILE_QUERY);
    const on = () => setMobile(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return mobile;
}

/** An <a> that hands the click to `onNavigate` (SPA) when given, else a normal link. */
function NavLink(props: {
  href: string;
  onNavigate?: Navigate;
  onAfter?: () => void;
  class?: string;
  children: ComponentChildren;
  "data-testid"?: string;
  "aria-current"?: "page";
  title?: string;
}) {
  const { href, onNavigate, onAfter, children, ...rest } = props;
  return (
    <a
      {...rest}
      href={href}
      onClick={(e: JSX.TargetedMouseEvent<HTMLAnchorElement>) => {
        if (onNavigate && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
          e.preventDefault();
          onNavigate(href);
        }
        onAfter?.();
      }}
    >
      {children}
    </a>
  );
}

// ── Icons (inline, so the package has no icon dependency) ─────────────────
const svg = (d: ComponentChildren, size = 18) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {d}
  </svg>
);
const IconMenu = () => svg(<path d="M4 6h16M4 12h16M4 18h16" />, 20);
const IconChevron = ({ open }: { open?: boolean }) => (
  <span class={"bas-chev" + (open ? " is-open" : "")}>{svg(<path d="m9 18 6-6-6-6" />, 12)}</span>
);
const IconCollapse = () => svg(<path d="m15 18-6-6 6-6" />, 15);
const IconExpand = () => svg(<path d="m9 18 6-6-6-6" />, 15);
const IconBell = () => svg(<><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>, 19);
const IconLogOut = () => svg(<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></>, 14);
const IconUser = () => svg(<><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>, 14);

// ── Sidebar ────────────────────────────────────────────────────────────────

export interface SidebarProps {
  groups: PreactNavGroup[];
  footer?: PreactNavItem[];
  currentPath: string;
  onNavigate?: Navigate;
  /** Desktop: collapsed to nothing (drawer mode) or to the icon rail (rail mode). */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  /** Phone, drawer mode: is the drawer open. */
  mobileOpen?: boolean;
  onClose?: () => void;
  mobile?: "drawer" | "rail";
  /** Shown at the top of the sidebar (e.g. the brand on a phone). */
  header?: ComponentChildren;
  /** localStorage key for which groups are folded. */
  groupsKey?: string;
  lang: Lang;
}

export function Sidebar(p: SidebarProps) {
  const t = TEXT[p.lang];
  const key = p.groupsKey ?? "broberg-app-shell.groups";
  const [folded, setFolded] = useState<Set<string>>(() => readSet(key));
  const toggleGroup = (label: string) => {
    const next = new Set(folded);
    next.has(label) ? next.delete(label) : next.add(label);
    setFolded(next);
    writeSet(key, next);
  };
  const mode = p.mobile ?? "drawer";
  const close = () => p.onClose?.();
  const item = (it: PreactNavItem) => {
    const active = isActivePath(it.href, p.currentPath);
    const badge = badgeLabel(it.badge);
    return (
      <NavLink
        key={it.id}
        href={it.href}
        onNavigate={p.onNavigate}
        onAfter={close}
        class={"bas-item" + (active ? " is-active" : "")}
        data-testid={`sidebar-item-${it.id}`}
        aria-current={active ? "page" : undefined}
        title={it.label}
      >
        {active ? <span class="bas-item__bar" /> : null}
        {it.icon ? <span class="bas-item__icon">{it.icon}</span> : null}
        <span class="bas-item__label">{it.label}</span>
        {badge ? <span class="bas-item__count" data-testid={`sidebar-badge-${it.id}`}>{badge}</span> : null}
      </NavLink>
    );
  };
  return (
    <>
      {mode === "drawer" ? (
        <div class={"bas-backdrop" + (p.mobileOpen ? " is-open" : "")} data-testid="sidebar-backdrop" onClick={close} />
      ) : null}
      <aside
        class={
          "bas-sidebar" +
          ` is-mobile-${mode}` +
          (p.mobileOpen ? " is-open" : "") +
          (p.collapsed ? " is-collapsed" : "")
        }
        data-testid="sidebar-root"
        data-mobile={mode}
        aria-label="Navigation"
      >
        <div class="bas-sidebar__head">
          {p.header ? <div class="bas-sidebar__brand">{p.header}</div> : <span />}
          {p.onToggleCollapse ? (
            <button type="button" class="bas-iconbtn bas-collapse" data-testid="sidebar-collapse" aria-label={t.collapse} title={t.collapse} onClick={p.onToggleCollapse}>
              <IconCollapse />
            </button>
          ) : null}
        </div>
        <nav class="bas-sidebar__nav">
          {p.groups.map((g) => {
            const open = !folded.has(g.label);
            const slug = g.label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
            return (
              <div class="bas-group" key={g.label}>
                <button type="button" class="bas-group__label" data-testid={`sidebar-group-${slug}`} aria-expanded={open} onClick={() => toggleGroup(g.label)}>
                  <IconChevron open={open} />
                  <span>{g.label}</span>
                </button>
                {open ? g.items.map(item) : null}
              </div>
            );
          })}
        </nav>
        {p.footer?.length ? <div class="bas-sidebar__foot">{p.footer.map(item)}</div> : null}
      </aside>
    </>
  );
}

// ── Notification bell ──────────────────────────────────────────────────────
//
// Driven by @broberg/notifications' createBellShell: one count however many
// bells, Escape acts on the innermost layer, and the ids "mark all read"
// actually cleared are held for the visit. This component is only the DOM.

export interface NotificationBellProps {
  /** Where the data comes from. Absent: the bell is still there, with an empty list. */
  source?: NotificationSource;
  onNavigate?: Navigate;
  /** Required on purpose: a default would make "nobody chose" look like a choice. */
  lang: Lang;
}

export function NotificationBell({ source, onNavigate, lang }: NotificationBellProps) {
  const t = TEXT[lang];
  const mobile = useIsMobile();
  const [error, setError] = useState<string | null>(null);
  const lastCount = useRef(0);
  const shell = useMemo(
    () =>
      createBellShell({
        labels: { bell: t.notifications, panel: t.notifications, markAll: t.markAllRead, seeAll: t.seeAll, empty: t.noNotifications, close: t.close },
        countUnseen: async () => {
          if (!source) return 0;
          try {
            lastCount.current = await source.countUnseen();
            setError(null);
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
          return lastCount.current;
        },
        loadRows: async () => {
          if (!source) return [];
          try {
            return await source.loadRows();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            return [];
          }
        },
        markAllSeen: async () => (source ? source.markAllSeen() : []),
      }),
    [source, lang],
  );
  const [state, setState] = useState(shell.getState());
  useEffect(() => shell.subscribe(setState), [shell]);
  useEffect(() => {
    setState(shell.getState());
    void shell.refresh();
    return source?.subscribe?.(() => {
      if (shell.getState().open) void shell.open(shell.getState().anchor);
      else void shell.refresh();
    });
  }, [shell, source]);
  useEffect(() => {
    if (!state.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && shell.escape() === "close") e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [state.open, shell]);

  const label = badgeLabel(state.count);
  const onRow = async (n: NotificationRow) => {
    shell.close();
    if (n.seenAt == null && source) {
      await source.markSeen([n.id]);
      await shell.refresh();
    }
    if (n.navigate) {
      if (onNavigate) onNavigate(n.navigate);
      else if (typeof window !== "undefined") window.location.assign(n.navigate);
    }
  };
  const seen = (n: NotificationRow) => n.seenAt != null || state.clearedIds.includes(n.id);

  return (
    <div class="bas-bell">
      <button
        type="button"
        class="bas-iconbtn"
        data-testid="topbar-notifications"
        aria-label={t.notifications}
        aria-expanded={state.open}
        onClick={(e: JSX.TargetedMouseEvent<HTMLButtonElement>) => {
          const r = e.currentTarget.getBoundingClientRect();
          void shell.toggle({ top: r.top, right: r.right, bottom: r.bottom, left: r.left, width: r.width, height: r.height } as never);
        }}
      >
        <IconBell />
        {label ? (
          <span class="bas-bell__count" data-testid="topbar-notifications-count">
            {label}
          </span>
        ) : null}
      </button>
      {state.open ? (
        <>
          <div class={"bas-overlay" + (mobile ? " is-dim" : "")} data-testid="notifications-backdrop" onClick={() => shell.close()} />
          <div
            class={"bas-panel " + (mobile ? "bas-panel--sheet" : "bas-panel--drop")}
            role="dialog"
            aria-label={shell.labels.panel}
            data-testid={mobile ? "notifications-drawer" : "notifications-dropdown"}
          >
            <div class="bas-panel__head">
              <h3>{t.notifications}</h3>
              <button type="button" class="bas-link" data-testid="notifications-mark-all" onClick={() => void shell.markAllSeen()} disabled={!state.count}>
                {shell.labels.markAll}
              </button>
            </div>
            <div class="bas-panel__list" data-testid="notifications-list">
              {error && state.rows.length === 0 ? (
                <p class="bas-panel__note is-error" data-testid="notifications-error">
                  {t.couldNotLoad}
                </p>
              ) : state.rows.length === 0 ? (
                <p class="bas-panel__note" data-testid="notifications-empty">
                  {shell.labels.empty}
                </p>
              ) : (
                state.rows.map((n) => (
                  <button
                    type="button"
                    key={n.id}
                    class={"bas-note" + (seen(n) ? " is-read" : "")}
                    data-testid="notification-row"
                    data-id={n.id}
                    onClick={() => void onRow(n)}
                  >
                    <span class="bas-note__text">
                      <span class="bas-note__title">{n.title}</span>
                      {n.body ? <span class="bas-note__body">{n.body}</span> : null}
                      <span class="bas-note__time">{relativeTime(n.createdAt, lang)}</span>
                    </span>
                    {!seen(n) ? <span class="bas-note__dot" /> : null}
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

// ── User menu ──────────────────────────────────────────────────────────────

export interface ShellUser {
  name?: string;
  email?: string;
  /** Broberg ID OIDC `picture`. Without it: initials. Never Gravatar (D-1dc849). */
  picture?: string;
}
export interface UserMenuItem {
  id: string;
  label: string;
  icon?: Icon;
  href?: string;
  onSelect?: () => void;
}
export interface UserMenuProps {
  user: ShellUser;
  /** «Konto» → Broberg ID's account page. */
  accountHref?: string;
  items?: UserMenuItem[];
  onSignOut?: () => void | Promise<void>;
  onNavigate?: Navigate;
  /** Show Theme · Palette · Surfaces · Backdrop. Default true. */
  appearance?: boolean;
  lang: Lang;
}

export function Avatar({ user, size = 28 }: { user: ShellUser; size?: number }) {
  const [broken, setBroken] = useState(false);
  const style = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px`;
  if (user.picture && !broken) {
    return <img class="bas-avatar" style={style} src={user.picture} alt="" referrerpolicy="no-referrer" onError={() => setBroken(true)} data-testid="avatar-picture" />;
  }
  return (
    <span class="bas-avatar bas-avatar--initials" style={style} data-testid="avatar-initials" aria-hidden="true">
      {initials(user.name, user.email)}
    </span>
  );
}

function Segmented<T extends string>(props: { testid: string; value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void }) {
  return (
    <div class="bas-seg" data-testid={props.testid} role="group">
      {props.options.map(([v, label]) => (
        <button type="button" key={v} aria-pressed={props.value === v} data-testid={`${props.testid}-${v}`} onClick={() => props.onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function UserMenu(p: UserMenuProps) {
  const t = TEXT[p.lang];
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const [pref, setPref] = useState<ThemePreference>(() => getPreference());
  const [palette, setPal] = useState<Palette>(() => getPalette());
  const [surfaces, setSurf] = useState<Surfaces>(() => getSurfaces());
  const [backdrop, setBack] = useState<Backdrop>(() => getBackdrop());

  useEffect(() => {
    const offs = [
      onThemeChange(() => setPref(getPreference())),
      onPaletteChange(setPal),
      onSurfacesChange(setSurf),
      onBackdropChange(setBack),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const firstName = (p.user.name ?? "").trim().split(/\s+/)[0] || p.user.email || "";
  const signOut = async () => {
    setBusy(true);
    try {
      await p.onSignOut?.();
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <div class="bas-usermenu" ref={root}>
      <button
        type="button"
        class={"bas-userbtn" + (open ? " is-open" : "")}
        data-testid="topbar-user-menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={p.user.email ?? p.user.name ?? t.account}
        onClick={() => setOpen((v) => !v)}
      >
        <Avatar user={p.user} />
        <span class="bas-userbtn__name">{firstName}</span>
      </button>
      {open ? (
        <div class="bas-menu" role="menu" data-testid="topbar-user-menu-dropdown">
          <div class="bas-menu__who">
            <Avatar user={p.user} size={36} />
            <div class="bas-menu__whotext">
              {p.user.name ? <div class="bas-menu__name">{p.user.name}</div> : null}
              {p.user.email ? <div class="bas-menu__email">{p.user.email}</div> : null}
            </div>
          </div>
          <div class="bas-sep" />
          {p.accountHref ? (
            <a class="bas-mi" href={p.accountHref} data-testid="user-menu-account" role="menuitem">
              <IconUser />
              <span>{t.account}</span>
            </a>
          ) : null}
          {(p.items ?? []).map((it) =>
            it.href ? (
              <NavLink key={it.id} href={it.href} onNavigate={p.onNavigate} onAfter={() => setOpen(false)} class="bas-mi" data-testid={`user-menu-${it.id}`}>
                {it.icon ?? null}
                <span>{it.label}</span>
              </NavLink>
            ) : (
              <button
                key={it.id}
                type="button"
                class="bas-mi"
                role="menuitem"
                data-testid={`user-menu-${it.id}`}
                onClick={() => {
                  setOpen(false);
                  it.onSelect?.();
                }}
              >
                {it.icon ?? null}
                <span>{it.label}</span>
              </button>
            ),
          )}
          {p.appearance !== false ? (
            <>
              <div class="bas-sep" />
              <div class="bas-prefs">
                <div class="bas-pref">
                  <span>{t.theme}</span>
                  <Segmented
                    testid="user-menu-theme"
                    value={pref as "light" | "dark" | "system"}
                    options={[["light", t.light], ["dark", t.dark], ["system", t.system]] as const}
                    onChange={(v) => {
                      setPreference(v);
                      setPref(v);
                    }}
                  />
                </div>
                <div class="bas-pref">
                  <span>{t.palette}</span>
                  <Segmented testid="user-menu-palette" value={palette} options={PALETTES.map((x) => [x, PALETTE_LABELS[x]] as const)} onChange={setPalette} />
                </div>
                <div class="bas-pref">
                  <span>{t.surfaces}</span>
                  <Segmented testid="user-menu-surfaces" value={surfaces} options={[["flat", t.flat], ["layered", t.layered]] as const} onChange={setSurfaces} />
                </div>
                <div class="bas-pref">
                  <span>{t.backdrop}</span>
                  <Segmented testid="user-menu-backdrop" value={backdrop} options={[["neurons", t.neurons], ["plain", t.plain]] as const} onChange={setBackdrop} />
                </div>
              </div>
            </>
          ) : null}
          {p.onSignOut ? (
            <>
              <div class="bas-sep" />
              <button type="button" class="bas-mi is-danger" role="menuitem" data-testid="topbar-sign-out" disabled={busy} onClick={() => void signOut()}>
                <IconLogOut />
                <span>{t.signOut}</span>
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ── Top bar ────────────────────────────────────────────────────────────────

export interface TopBarProps {
  brand?: ComponentChildren;
  /** Anything app-specific (project switcher, search) between brand and bell. */
  actions?: ComponentChildren;
  /** Drawer mode on a phone: show the hamburger and call this. */
  onOpenMenu?: () => void;
  notifications?: NotificationSource;
  user?: ShellUser;
  userMenu?: Omit<UserMenuProps, "user" | "lang" | "onNavigate">;
  onNavigate?: Navigate;
  lang: Lang;
}

/** Brand left, actions, then the notification bell and the user menu ALWAYS last, in that order. */
export function TopBar(p: TopBarProps) {
  const t = TEXT[p.lang];
  return (
    <header class="bas-topbar" data-testid="topbar-root">
      <div class="bas-topbar__inner">
        {p.onOpenMenu ? (
          <button type="button" class="bas-iconbtn bas-hamburger" data-testid="sidebar-toggle" aria-label={t.openMenu} onClick={p.onOpenMenu}>
            <IconMenu />
          </button>
        ) : null}
        {p.brand ? <div class="bas-topbar__brand">{p.brand}</div> : null}
        {p.actions ? <div class="bas-topbar__actions">{p.actions}</div> : null}
        <div class="bas-spacer" />
        <NotificationBell source={p.notifications} onNavigate={p.onNavigate} lang={p.lang} />
        {p.user ? <UserMenu user={p.user} {...p.userMenu} onNavigate={p.onNavigate} lang={p.lang} /> : null}
      </div>
    </header>
  );
}

// ── Page header + tabs ─────────────────────────────────────────────────────

export function PageHeader(p: { eyebrow?: ComponentChildren; title: ComponentChildren; description?: ComponentChildren; actions?: ComponentChildren }) {
  return (
    <div class="bas-pagehead" data-testid="page-header">
      <div class="bas-pagehead__text">
        {p.eyebrow ? <div class="bas-pagehead__eyebrow">{p.eyebrow}</div> : null}
        <h1 class="bas-pagehead__title">{p.title}</h1>
        {p.description ? <p class="bas-pagehead__desc">{p.description}</p> : null}
      </div>
      {p.actions ? <div class="bas-pagehead__actions">{p.actions}</div> : null}
    </div>
  );
}

export interface PageTab {
  id: string;
  label: ComponentChildren;
  /** Path mode: the tab's own route. Query mode: ignored (?tab=id is used). */
  href?: string;
}

/**
 * Tabs as routes. `mode: "query"` puts the tab in `?tab=<id>` on the current
 * path (first tab when absent); `mode: "path"` gives each tab its own href.
 */
export function PageTabs(p: { tabs: PageTab[]; currentUrl: string; mode?: "query" | "path"; onNavigate?: Navigate }) {
  const mode = p.mode ?? "query";
  const url = new URL(p.currentUrl, "http://x");
  const activeId =
    mode === "query"
      ? url.searchParams.get("tab") ?? p.tabs[0]?.id
      : p.tabs.find((tab) => tab.href && isActivePath(tab.href, url.pathname))?.id;
  return (
    <div class="bas-tabs" role="tablist" data-testid="page-tabs">
      {p.tabs.map((tab) => {
        let href = tab.href ?? "";
        if (mode === "query") {
          const u = new URL(url.toString());
          u.searchParams.set("tab", tab.id);
          href = u.pathname + u.search;
        }
        const active = tab.id === activeId;
        return (
          <NavLink key={tab.id} href={href} onNavigate={p.onNavigate} class={"bas-tab" + (active ? " is-active" : "")} data-testid={`page-tab-${tab.id}`} aria-current={active ? "page" : undefined}>
            {tab.label}
          </NavLink>
        );
      })}
    </div>
  );
}

// ── App shell ──────────────────────────────────────────────────────────────

export interface AppShellProps {
  brand?: ComponentChildren;
  actions?: ComponentChildren;
  groups: PreactNavGroup[];
  footer?: PreactNavItem[];
  currentPath: string;
  onNavigate?: Navigate;
  /** The notification centre's source. The bell is shown either way. */
  notifications?: NotificationSource;
  user?: ShellUser;
  userMenu?: Omit<UserMenuProps, "user" | "lang" | "onNavigate">;
  /** Phone behaviour: a slide-in drawer behind a hamburger, or a 60px icon rail. */
  mobile?: "drawer" | "rail";
  /** localStorage key prefix for the collapsed sidebar and folded groups. */
  storageKey?: string;
  /** Required: the shell ships no default language (see @broberg/notifications/shell). */
  lang: Lang;
  children?: ComponentChildren;
}

export function AppShell(p: AppShellProps) {
  const prefix = p.storageKey ?? "broberg-app-shell";
  const mode = p.mobile ?? "drawer";
  const [collapsed, setCollapsed] = useState(() => readFlag(`${prefix}.collapsed`, false));
  const [drawer, setDrawer] = useState(false);
  const t = TEXT[p.lang];
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    writeFlag(`${prefix}.collapsed`, next);
  };
  return (
    <div class="bas-root" data-testid="app-shell" data-mobile={mode}>
      <TopBar
        brand={p.brand}
        actions={p.actions}
        onOpenMenu={mode === "drawer" ? () => setDrawer(true) : undefined}
        notifications={p.notifications}
        user={p.user}
        userMenu={p.userMenu}
        onNavigate={p.onNavigate}
        lang={p.lang}
      />
      <div class="bas-row">
        <Sidebar
          groups={p.groups}
          footer={p.footer}
          currentPath={p.currentPath}
          onNavigate={p.onNavigate}
          collapsed={collapsed}
          onToggleCollapse={toggle}
          mobileOpen={drawer}
          onClose={() => setDrawer(false)}
          mobile={mode}
          header={mode === "drawer" ? p.brand : undefined}
          groupsKey={`${prefix}.groups`}
          lang={p.lang}
        />
        {collapsed && mode === "drawer" ? (
          <button type="button" class="bas-iconbtn bas-expand" data-testid="sidebar-expand" aria-label={t.expand} title={t.expand} onClick={toggle}>
            <IconExpand />
          </button>
        ) : null}
        <main class="bas-main" data-testid="app-content">
          {p.children}
        </main>
      </div>
    </div>
  );
}
