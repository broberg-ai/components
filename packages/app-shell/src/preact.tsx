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
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
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
  createFetchTenantAdapter,
  type TenantAdapter,
  type TenantMembershipRow,
  accountErrorKind,
  activeNavLabel,
  analyticsErrorKind,
  changePct,
  createFetchAnalyticsAdapter,
  fillDays,
  type AnalyticsAdapter,
  type AnalyticsData,
  type AnalyticsDay,
  AVATAR_TYPES,
  badgeLabel,
  checkAvatarFile,
  createFetchAccountAdapter,
  type AccountAdapter,
  type AccountProfile,
  initials,
  isActivePath,
  readFlag,
  readSet,
  relativeTime,
  safeNavigate,
  isExternal,
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
  "aria-label"?: string;
  title?: string;
  role?: "menuitem";
}) {
  const { href, onNavigate, onAfter, children, ...rest } = props;
  // F092.10 / D-d28547: a link that leaves the app opens in a new tab, and is
  // never handed to the app's router. Decided HERE, once, for every link the
  // shell renders — a rule that has to be remembered per link is forgotten.
  if (isExternal(href)) {
    return (
      <a {...rest} href={href} target="_blank" rel="noopener noreferrer" onClick={() => onAfter?.()}>
        {children}
      </a>
    );
  }
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
// lucide "panel-left" (ISC), the exact icon in shadcn's SidebarTrigger (F092.4).
const IconPanelLeft = () => svg(<><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M9 3v18" /></>, 16);
const IconBell = () => svg(<><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>, 19);
const IconLogOut = () => svg(<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></>, 14);
const IconUser = () => svg(<><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>, 14);

// ── Sidebar ────────────────────────────────────────────────────────────────

export interface SidebarProps {
  groups: PreactNavGroup[];
  footer?: PreactNavItem[];
  currentPath: string;
  onNavigate?: Navigate;
  /** Desktop: is the sidebar folded (to nothing, or to the icon rail — see `collapse`). */
  collapsed?: boolean;
  /**
   * F092.6 — what "folded" means on desktop, as shadcn's `collapsible`:
   * "offcanvas" hides the sidebar, "icon" keeps a 48px rail of item icons with
   * `brandMark` on top. Default: "icon" when `mobile` is "rail", else "offcanvas".
   */
  collapse?: "offcanvas" | "icon";
  /** The app's logo icon, shown at the top of the icon rail. */
  brandMark?: ComponentChildren;
  /** F092.7 — the app's start page: `header` and `brandMark` become links to it. */
  homeHref?: string;
  /** Accessible name of the brandMark link (it has no visible text). Default "Forside"/"Home". */
  homeLabel?: string;
  /** data-testid of the brand link in the sidebar head. */
  brandTestId?: string;
  /** Phone, drawer mode: is the drawer open. */
  mobileOpen?: boolean;
  onClose?: () => void;
  mobile?: "drawer" | "rail";
  /** Shown at the top of the sidebar (e.g. the brand on a phone). */
  header?: ComponentChildren;
  /** localStorage key for which groups are folded. */
  groupsKey?: string;
  /** localStorage key for which items with children are open (F092.5). */
  itemsKey?: string;
  lang: Lang;
}

export function Sidebar(p: SidebarProps) {
  const key = p.groupsKey ?? "broberg-app-shell.groups";
  const itemsKey = p.itemsKey ?? "broberg-app-shell.items";
  const mode = p.mobile ?? "drawer";
  const collapseMode = p.collapse ?? (mode === "rail" ? "icon" : "offcanvas");
  const isMobile = useIsMobile();
  // The rail: on a phone in rail mode, or on desktop when folded to icons.
  const railed = isMobile ? mode === "rail" : !!p.collapsed && collapseMode === "icon";

  const [folded, setFolded] = useState<Set<string>>(() => readSet(key));
  const toggleGroup = (label: string) => {
    const next = new Set(folded);
    next.has(label) ? next.delete(label) : next.add(label);
    setFolded(next);
    writeSet(key, next);
  };

  const all = [...p.groups.flatMap((g) => g.items), ...(p.footer ?? [])];
  const childActive = (it: PreactNavItem) => !!it.children?.some((c) => isActivePath(c.href, p.currentPath));
  // Open = what the user left open, plus any parent of the page they are on.
  const [openItems, setOpenItems] = useState<Set<string>>(() => {
    const s = readSet(itemsKey);
    for (const it of all) if (childActive(it)) s.add(it.id);
    return s;
  });
  const toggleItem = (id: string) => {
    const next = new Set(openItems);
    next.has(id) ? next.delete(id) : next.add(id);
    setOpenItems(next);
    writeSet(itemsKey, next);
  };

  // F092.6 — the rail's flyout for an item with children.
  const [flyout, setFlyout] = useState<{ id: string; top: number; left: number } | null>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!flyout) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFlyout(null);
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (flyoutRef.current && t && flyoutRef.current.contains(t)) return;
      if (t instanceof Element && t.closest(`[data-flyout-for="${flyout.id}"]`)) return;
      setFlyout(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [flyout]);
  useEffect(() => {
    if (!railed) setFlyout(null);
  }, [railed]);

  const close = () => {
    setFlyout(null);
    p.onClose?.();
  };

  const leaf = (it: PreactNavItem, sub = false) => {
    const active = isActivePath(it.href, p.currentPath);
    const badge = badgeLabel(it.badge);
    return (
      <NavLink
        key={it.id}
        href={it.href}
        onNavigate={p.onNavigate}
        onAfter={close}
        class={"bas-item" + (sub ? " bas-item--sub" : "") + (active ? " is-active" : "")}
        data-testid={`sidebar-item-${it.id}`}
        aria-current={active ? "page" : undefined}
        aria-label={railed && !sub ? it.label : undefined}
        title={it.label}
      >
        {active && !sub ? <span class="bas-item__bar" /> : null}
        {it.icon ? <span class="bas-item__icon">{it.icon}</span> : null}
        <span class="bas-item__label">{it.label}</span>
        {badge ? <span class="bas-item__count" data-testid={`sidebar-badge-${it.id}`}>{badge}</span> : null}
      </NavLink>
    );
  };

  const parent = (it: PreactNavItem) => {
    const children = it.children!;
    const onPage = childActive(it) || isActivePath(it.href, p.currentPath);
    const open = railed ? flyout?.id === it.id : openItems.has(it.id);
    const onClick = (e: JSX.TargetedMouseEvent<HTMLButtonElement>) => {
      if (!railed) return toggleItem(it.id);
      if (flyout?.id === it.id) return setFlyout(null);
      const r = e.currentTarget.getBoundingClientRect();
      setFlyout({ id: it.id, top: r.top, left: r.right + 6 });
    };
    return (
      <div class="bas-itemgroup" key={it.id}>
        <button
          type="button"
          class={"bas-item bas-item--parent" + (onPage ? " is-parent-active" : "")}
          data-testid={`sidebar-item-${it.id}-toggle`}
          data-flyout-for={it.id}
          aria-expanded={open}
          aria-label={railed ? it.label : undefined}
          title={it.label}
          onClick={onClick}
        >
          {onPage && railed ? <span class="bas-item__bar" /> : null}
          {it.icon ? <span class="bas-item__icon">{it.icon}</span> : null}
          <span class="bas-item__label">{it.label}</span>
          <span class="bas-item__chev">
            <IconChevron open={open} />
          </span>
        </button>
        {!railed && open ? <div class="bas-sub">{children.map((c) => leaf(c, true))}</div> : null}
        {railed && flyout?.id === it.id ? (
          <div
            ref={flyoutRef}
            class="bas-flyout"
            data-testid={`sidebar-flyout-${it.id}`}
            role="menu"
            aria-label={it.label}
            style={{ top: `${flyout.top}px`, left: `${flyout.left}px` }}
          >
            <div class="bas-flyout__title">{it.label}</div>
            {children.map((c) => leaf(c, true))}
          </div>
        ) : null}
      </div>
    );
  };

  const item = (it: PreactNavItem) => (it.children?.length ? parent(it) : leaf(it));

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
          (p.collapsed ? " is-collapsed" : "") +
          (railed ? " is-railed" : "")
        }
        data-testid="sidebar-root"
        data-mobile={mode}
        data-collapse={collapseMode}
        aria-label="Navigation"
      >
        {p.header || p.brandMark ? (
          <div class="bas-sidebar__head">
            {p.header ? (
              <div class="bas-sidebar__brand">
                {p.homeHref ? (
                  <NavLink href={p.homeHref} onNavigate={p.onNavigate} onAfter={close} class="bas-home" data-testid={p.brandTestId ?? "sidebar-brand-home"}>
                    {p.header}
                  </NavLink>
                ) : (
                  p.header
                )}
              </div>
            ) : null}
            {p.brandMark ? (
              <div class="bas-sidebar__mark" data-testid="sidebar-brand-mark">
                {p.homeHref ? (
                  <NavLink
                    href={p.homeHref}
                    onNavigate={p.onNavigate}
                    onAfter={close}
                    class="bas-home"
                    data-testid="brand-mark-home"
                    aria-label={p.homeLabel ?? TEXT[p.lang].home}
                    title={p.homeLabel ?? TEXT[p.lang].home}
                  >
                    {p.brandMark}
                  </NavLink>
                ) : (
                  p.brandMark
                )}
              </div>
            ) : null}
          </div>
        ) : null}
        <nav class="bas-sidebar__nav">
          {p.groups.map((g) => {
            const open = railed || !folded.has(g.label);
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
  // F092.9 — a click anywhere outside the bell and its panel closes it (not
  // only a click that happens to land on the overlay: Lens 332fdd8c clicked a
  // dropzone straight through it), and Escape hands focus back to the bell.
  const bellRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!state.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && shell.escape() === "close") {
        e.preventDefault();
        bellRef.current?.focus();
      }
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (t && (panelRef.current?.contains(t) || bellRef.current?.contains(t))) return;
      shell.close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [state.open, shell]);

  // F092.9 — Christian: «Marker alle læst på klokken skal automatisk lukke
  // dropdown det har jeg fået rettet 300 gange i diverse apps». Close only when
  // it WORKED: a panel that closes on a failure hides that nothing was marked.
  const [markAllFailed, setMarkAllFailed] = useState(false);
  useEffect(() => {
    if (!state.open) setMarkAllFailed(false);
  }, [state.open]);
  const onMarkAll = async () => {
    setMarkAllFailed(false);
    try {
      await shell.markAllSeen();
    } catch {
      setMarkAllFailed(true);
      return;
    }
    shell.close();
  };
  const label = badgeLabel(state.count);
  const onRow = async (n: NotificationRow) => {
    shell.close();
    if (n.seenAt == null && source) {
      await source.markSeen([n.id]);
      await shell.refresh();
    }
    const target = safeNavigate(n.navigate);
    if (target && isExternal(target)) {
      // F092.10 — leaves the app: a new tab, never the app's router.
      if (typeof window !== "undefined") window.open(target, "_blank", "noopener,noreferrer");
    } else if (target) {
      if (onNavigate) onNavigate(target);
      else if (typeof window !== "undefined") window.location.assign(target);
    }
  };
  const seen = (n: NotificationRow) => n.seenAt != null || state.clearedIds.includes(n.id);

  return (
    <div class="bas-bell">
      <button
        type="button"
        ref={bellRef}
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
            ref={panelRef}
            class={"bas-panel " + (mobile ? "bas-panel--sheet" : "bas-panel--drop")}
            role="dialog"
            aria-label={shell.labels.panel}
            data-testid={mobile ? "notifications-drawer" : "notifications-dropdown"}
          >
            <div class="bas-panel__head">
              <h3>{t.notifications}</h3>
              <button type="button" class="bas-link" data-testid="notifications-mark-all" onClick={() => void onMarkAll()} disabled={!state.count}>
                {shell.labels.markAll}
              </button>
            </div>
            {markAllFailed ? (
              <p class="bas-panel__note is-error" role="alert" data-testid="notifications-mark-all-error">
                {t.couldNotMarkAll}
              </p>
            ) : null}
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
  /**
   * F092.11 — a «Sprog»/«Language» row with a segmented control, like the
   * appearance rows. The app owns the language; the shell shows and reports it.
   */
  language?: { value: string; options: { id: string; label: string }[]; onChange: (id: string) => void };
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

function Segmented<T extends string>(props: { testid: string; value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; label?: string }) {
  // Arrow keys move between the options (D-4cd764); Enter/Space are the native
  // button's own, so choosing needs nothing extra.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const buttons = [...(e.currentTarget as HTMLElement).querySelectorAll("button")];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    const next = (i + (e.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]!.focus();
  };
  return (
    <div class="bas-seg" data-testid={props.testid} role="group" aria-label={props.label} onKeyDown={onKeyDown}>
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
            <NavLink href={p.accountHref} onNavigate={p.onNavigate} onAfter={() => setOpen(false)} class="bas-mi" data-testid="user-menu-account" role="menuitem">
              <IconUser />
              <span>{t.account}</span>
            </NavLink>
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
          {p.language ? (
            <>
              {p.appearance === false ? <div class="bas-sep" /> : null}
              <div class="bas-prefs">
                <div class="bas-pref">
                  <span>{t.language}</span>
                  <Segmented
                    testid="user-menu-language"
                    label={t.language}
                    value={p.language.value}
                    options={p.language.options.map((o) => [o.id, o.label] as const)}
                    onChange={p.language.onChange}
                  />
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
  /** F092.7 — when set, the brand is a link to the app's start page. */
  homeHref?: string;
  /** Called after the brand link was followed (AppShell closes the drawer). */
  onHome?: () => void;
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
        {p.brand ? (
          <div class="bas-topbar__brand">
            {p.homeHref ? (
              <NavLink href={p.homeHref} onNavigate={p.onNavigate} onAfter={p.onHome} class="bas-home" data-testid="brand-home">
                {p.brand}
              </NavLink>
            ) : (
              p.brand
            )}
          </div>
        ) : null}
        {p.actions ? <div class="bas-topbar__actions">{p.actions}</div> : null}
        <div class="bas-spacer" />
        <NotificationBell source={p.notifications} onNavigate={p.onNavigate} lang={p.lang} />
        {p.user ? <UserMenu user={p.user} {...p.userMenu} onNavigate={p.onNavigate} lang={p.lang} /> : null}
      </div>
    </header>
  );
}

// ── Page header + tabs ─────────────────────────────────────────────────────

/**
 * Optional `title` (0.2.1): inside AppShell the page title already sits in the
 * content header, so a page can use PageHeader for its description and actions
 * alone — no second, and no empty, <h1>.
 */
export function PageHeader(p: { eyebrow?: ComponentChildren; title?: ComponentChildren; description?: ComponentChildren; actions?: ComponentChildren }) {
  return (
    <div class="bas-pagehead" data-testid="page-header">
      <div class="bas-pagehead__text">
        {p.eyebrow ? <div class="bas-pagehead__eyebrow">{p.eyebrow}</div> : null}
        {p.title != null && p.title !== "" ? <h1 class="bas-pagehead__title">{p.title}</h1> : null}
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
  /** Phone behaviour: a slide-in drawer, or a 60px icon rail. */
  mobile?: "drawer" | "rail";
  /**
   * F092.6 — desktop fold: "offcanvas" hides the sidebar, "icon" keeps a 48px
   * icon rail with `brandMark` on top. Default: "icon" when `mobile` is "rail".
   */
  collapse?: "offcanvas" | "icon";
  /** The app's logo icon for the top of the icon rail. */
  brandMark?: ComponentChildren;
  /**
   * F092.8 — "inset" (default, shadcn dashboard-01): no full-width top bar; the
   * brand heads the sidebar, and the content's top row is sidebar button ·
   * title · actions · bell · user menu. "topbar": the 0.2.x full-width bar.
   */
  layout?: "inset" | "topbar";
  /** F092.7 — the app's start page. Brand and brandMark become links to it; on a phone the click closes the drawer. */
  homeHref?: string;
  /** Accessible name for the brandMark link. Default "Forside"/"Home". */
  homeLabel?: string;
  /**
   * F092.4 — the page title in the content header, after the sidebar button.
   * Absent: the label of the active nav item (a sub-item wins over its parent).
   */
  title?: ComponentChildren;
  /** localStorage key prefix for the folded sidebar, folded groups and open items. */
  storageKey?: string;
  /** Required: the shell ships no default language (see @broberg/notifications/shell). */
  lang: Lang;
  children?: ComponentChildren;
}

export function AppShell(p: AppShellProps) {
  const prefix = p.storageKey ?? "broberg-app-shell";
  const mode = p.mobile ?? "drawer";
  const layout = p.layout ?? "inset";
  const inset = layout === "inset";
  const collapse = p.collapse ?? (mode === "rail" ? "icon" : "offcanvas");
  const [collapsed, setCollapsed] = useState(() => readFlag(`${prefix}.collapsed`, false));
  const [drawer, setDrawer] = useState(false);
  const isMobile = useIsMobile();
  const t = TEXT[p.lang];
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    writeFlag(`${prefix}.collapsed`, next);
  };
  // F092.4 — ONE sidebar button: the drawer on a phone, the fold on desktop.
  const drawerMode = isMobile && mode === "drawer";
  const onTrigger = () => (drawerMode ? setDrawer(!drawer) : toggle());
  const expanded = drawerMode ? drawer : !collapsed;
  const triggerLabel = drawerMode ? (drawer ? t.closeMenu : t.openMenu) : collapsed ? t.expand : t.collapse;
  const heading = p.title ?? activeNavLabel(p.groups, p.footer, p.currentPath);
  return (
    <div class="bas-root" data-testid="app-shell" data-mobile={mode} data-layout={layout}>
      {inset ? null : (
      <TopBar
        brand={p.brand}
        homeHref={p.homeHref}
        onHome={() => setDrawer(false)}
        actions={p.actions}
        notifications={p.notifications}
        user={p.user}
        userMenu={p.userMenu}
        onNavigate={p.onNavigate}
        lang={p.lang}
      />
      )}
      <div class="bas-row">
        <Sidebar
          groups={p.groups}
          footer={p.footer}
          currentPath={p.currentPath}
          onNavigate={p.onNavigate}
          collapsed={collapsed}
          collapse={collapse}
          brandMark={p.brandMark}
          homeHref={p.homeHref}
          homeLabel={p.homeLabel}
          mobileOpen={drawer}
          onClose={() => setDrawer(false)}
          mobile={mode}
          header={inset || mode === "drawer" ? p.brand : undefined}
          brandTestId={inset ? "brand-home" : undefined}
          groupsKey={`${prefix}.groups`}
          itemsKey={`${prefix}.items`}
          lang={p.lang}
        />
        <main class="bas-main" data-testid="app-content">
          <div class="bas-contenthead" data-testid="content-header">
            <button
              type="button"
              class="bas-iconbtn bas-trigger"
              data-testid="sidebar-trigger"
              aria-label={triggerLabel}
              aria-expanded={expanded}
              title={triggerLabel}
              onClick={onTrigger}
            >
              <IconPanelLeft />
            </button>
            {heading ? (
              <>
                <span class="bas-contenthead__sep" data-testid="content-header-separator" aria-hidden="true" />
                <h1 class="bas-contenthead__title" data-testid="content-header-title">
                  {heading}
                </h1>
              </>
            ) : null}
            {inset ? (
              <>
                <div class="bas-spacer" />
                {p.actions ? <div class="bas-contenthead__actions">{p.actions}</div> : null}
                <NotificationBell source={p.notifications} onNavigate={p.onNavigate} lang={p.lang} />
                {p.user ? <UserMenu user={p.user} {...p.userMenu} onNavigate={p.onNavigate} lang={p.lang} /> : null}
              </>
            ) : null}
          </div>
          {p.children}
        </main>
      </div>
    </div>
  );
}

// ── Account page (F095.3) ──────────────────────────────────────────────────

export interface AccountPageProps {
  lang: Lang;
  /** Default: `createFetchAccountAdapter()` → /api/account/profile* (@broberg/sso accountRoutes). */
  adapter?: AccountAdapter;
  /**
   * Where «Log ind igen» goes — a FULL page load, so the app's login flow runs.
   * Default `/auth/login?returnTo=<current path>` (no prompt=login — that forces
   * re-proof and is a redirect-loop trap, F084.108). Broberg ID issues
   * no refresh token, so about an hour after login every change answers 401
   * reauth: that is a normal state here, not an error.
   */
  reauthHref?: string;
  /**
   * F095.5 — called with the profile AS THE SERVER NOW HOLDS IT after every
   * successful change (name saved, picture uploaded, picture removed), so the
   * host can update the shell's user menu at once. Not called on load or on a
   * failed save.
   */
  onProfileChange?: (profile: AccountProfile) => void;
}

/** `/auth/login?returnTo=<this page>` — back here after signing in. */
export function defaultReauthHref(): string {
  const here = typeof location === "undefined" ? "/" : location.pathname + location.search;
  return `/auth/login?returnTo=${encodeURIComponent(here)}`;
}

type Notice = { kind: "ok" | "error"; text: string } | null;

/**
 * The user's own name and picture, edited inside the app (F095.3).
 *
 * EVERYTHING SHOWN AFTER A SAVE IS THE SERVER'S ANSWER, never what was typed
 * (CLAUDE.md «Et gem-felt SKAL bevises at gemme»): if Broberg ID trims or
 * changes the name, the field shows that. On a failed save the field keeps the
 * typed text, so nothing is lost and the error says why.
 */
export function AccountPage({ lang, adapter, reauthHref, onProfileChange }: AccountPageProps) {
  const t = TEXT[lang];
  const api = useMemo(() => adapter ?? createFetchAccountAdapter(), [adapter]);
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"load" | "name" | "avatar" | null>("load");
  const [notice, setNotice] = useState<Notice>(null);
  const [reauth, setReauth] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const apply = (p: AccountProfile) => {
    setProfile(p);
    setDraft(p.name ?? "");
  };
  const fail = (err: unknown, fallback: string) => {
    const kind = accountErrorKind(err);
    if (kind === "reauth") {
      setReauth(true);
      setNotice(null);
      return;
    }
    const text = kind === "tooLarge" ? t.pictureTooLarge : kind === "wrongType" ? t.pictureWrongType : fallback;
    setNotice({ kind: "error", text });
  };

  useEffect(() => {
    let live = true;
    setBusy("load");
    api.load().then(
      (p) => live && (apply(p), setBusy(null)),
      (e) => live && (fail(e, t.couldNotLoadProfile), setBusy(null)),
    );
    return () => {
      live = false;
    };
  }, [api]);

  const run = async (what: "name" | "avatar", op: () => Promise<AccountProfile>, okText: string) => {
    setBusy(what);
    setNotice(null);
    try {
      const p = await op();
      apply(p);
      onProfileChange?.(p);
      setNotice({ kind: "ok", text: okText });
    } catch (e) {
      fail(e, t.couldNotSave);
    } finally {
      setBusy(null);
    }
  };

  const onSaveName = (e: Event) => {
    e.preventDefault();
    if (busy || reauth || unchanged) return;
    // A failed save leaves `draft` as typed: apply() runs only on success.
    void run("name", () => api.saveName(draft), t.saved);
  };

  const onFile = (e: JSX.TargetedEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = ""; // the same file can be chosen again after an error
    if (!file || busy || reauth) return;
    const bad = checkAvatarFile(file);
    if (bad) {
      setNotice({ kind: "error", text: bad === "tooLarge" ? t.pictureTooLarge : t.pictureWrongType });
      return;
    }
    void run("avatar", () => api.uploadAvatar(file), t.pictureSaved);
  };

  const onRemove = () => {
    setConfirming(false);
    void run("avatar", () => api.removeAvatar(), t.pictureRemoved);
  };

  const locked = reauth || busy !== null || profile === null;
  // Nothing to save until the name differs from what the server holds (trimmed:
  // BID trims, so a trailing space is not a change).
  const unchanged = draft.trim() === (profile?.name ?? "").trim();
  const user: ShellUser = { name: profile?.name ?? undefined, email: profile?.email ?? undefined, picture: profile?.picture ?? undefined };

  return (
    <section class="bas-account" data-testid="account-page" aria-busy={busy !== null}>
      {reauth ? (
        <div class="bas-account__note is-reauth" role="alert" data-testid="account-reauth">
          <span data-testid="account-reauth-text">{t.reauth}</span>
          <button
            type="button"
            class="bas-account__btn is-primary"
            onClick={() => window.location.assign(reauthHref ?? defaultReauthHref())}
            data-testid="account-reauth-signin"
          >
            {t.signInAgain}
          </button>
        </div>
      ) : null}
      {notice ? (
        <p
          class={"bas-account__note " + (notice.kind === "ok" ? "is-ok" : "is-error")}
          role={notice.kind === "ok" ? "status" : "alert"}
          data-testid={notice.kind === "ok" ? "account-ok" : "account-error"}
        >
          {notice.text}
        </p>
      ) : null}
      {busy === "load" ? <p class="bas-account__muted" data-testid="account-loading">{t.loadingProfile}</p> : null}
      {profile ? (
        <>
          <div class="bas-account__who">
            <span class="bas-account__avatar" data-testid="account-avatar" data-picture={profile.picture ?? ""}>
              <Avatar key={profile.picture ?? "none"} user={user} size={72} />
            </span>
            <div class="bas-account__whotext">
              <div class="bas-account__name" data-testid="account-name">{profile.name ?? ""}</div>
              <div class="bas-account__email" data-testid="account-email">{profile.email ?? ""}</div>
            </div>
          </div>
          <div class="bas-account__row">
            <input
              ref={fileRef}
              type="file"
              accept={AVATAR_TYPES.join(",")}
              hidden
              tabIndex={-1}
              onChange={onFile}
              data-testid="account-avatar-file"
            />
            <button type="button" class="bas-account__btn" disabled={locked} onClick={() => fileRef.current?.click()} data-testid="account-avatar-upload">
              {busy === "avatar" ? t.saving : t.changePicture}
            </button>
            {profile.picture && !confirming ? (
              <button type="button" class="bas-account__btn is-quiet" disabled={locked} onClick={() => setConfirming(true)} data-testid="account-avatar-remove">
                {t.removePicture}
              </button>
            ) : null}
            {profile.picture && confirming ? (
              <span class="bas-account__confirm" role="group" data-testid="account-avatar-remove-confirmation">
                <span>{t.confirmRemovePicture}</span>
                <button type="button" class="bas-account__btn is-danger" disabled={locked} onClick={onRemove} data-testid="account-avatar-remove-confirm">
                  {t.remove}
                </button>
                <button type="button" class="bas-account__btn is-quiet" onClick={() => setConfirming(false)} data-testid="account-avatar-remove-cancel">
                  {t.cancel}
                </button>
              </span>
            ) : null}
          </div>
          <form class="bas-account__form" onSubmit={onSaveName} data-testid="account-name-form">
            <label class="bas-account__label" for="bas-account-name">{t.name}</label>
            <div class="bas-account__row">
              <input
                id="bas-account-name"
                class="bas-account__input"
                type="text"
                autocomplete="name"
                value={draft}
                readOnly={reauth}
                aria-readonly={reauth}
                onInput={(e) => {
                  setDraft(e.currentTarget.value);
                  if (notice?.kind === "ok") setNotice(null);
                }}
                data-testid="account-name-input"
              />
              <button type="submit" class="bas-account__btn is-primary" disabled={locked || unchanged} data-testid="account-name-save">
                {busy === "name" ? t.saving : t.save}
              </button>
            </div>
          </form>
          {profile.account_url ? (
            <NavLink href={profile.account_url} class="bas-account__link" data-testid="account-bid-link">
              {t.bidSecurity}
            </NavLink>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

// ── Analytics page (F097.1) ────────────────────────────────────────────────

export interface AnalyticsPageProps {
  lang: Lang;
  /** Default: `createFetchAnalyticsAdapter()` → GET /api/analytics?days=N (@upmetrics/sdk/hono analyticsRoutes). */
  adapter?: AnalyticsAdapter;
  /** The period buttons, in days. Default 7 / 30 / 90. */
  periods?: number[];
  /** The period shown first. Default 30 (or the first of `periods` when 30 is not one of them). */
  initialDays?: number;
}

type AnalyticsLoad =
  | { state: "loading" }
  | { state: "ok"; days: number; data: AnalyticsData }
  | { state: "error"; reason: "unconfigured" | "unavailable" };

/**
 * The app's own visitors, page views, page views per day and most visited
 * pages, from Upmetrics through the app's backend (F097.1). A backend that is
 * not set up or does not answer says so — it never shows zeros that would read
 * as a quiet month.
 */
export function AnalyticsPage({ lang, adapter, periods = [7, 30, 90], initialDays }: AnalyticsPageProps) {
  const t = TEXT[lang];
  const api = useMemo(() => adapter ?? createFetchAnalyticsAdapter(), [adapter]);
  const [days, setDays] = useState(initialDays ?? (periods.includes(30) ? 30 : periods[0]!));
  const [load, setLoad] = useState<AnalyticsLoad>({ state: "loading" });
  const locale = lang === "da" ? "da-DK" : "en-GB";
  const num = (n: number) => n.toLocaleString(locale);

  useEffect(() => {
    // A late answer for a period the user has already left is dropped.
    let live = true;
    setLoad({ state: "loading" });
    api.load(days).then(
      (data) => live && setLoad({ state: "ok", days, data }),
      (e) => live && setLoad({ state: "error", reason: analyticsErrorKind(e) }),
    );
    return () => {
      live = false;
    };
  }, [api, days]);

  return (
    <section class="bas-analytics" data-testid="analytics-page" aria-busy={load.state === "loading"}>
      <div class="bas-analytics__periods" role="group" aria-label={t.analyticsPeriod}>
        {periods.map((d) => (
          <button
            key={d}
            type="button"
            class={"bas-analytics__period" + (d === days ? " is-active" : "")}
            aria-pressed={d === days}
            onClick={() => setDays(d)}
            data-testid={`analytics-period-${d}`}
          >
            {t.analyticsDays.replace("{n}", String(d))}
          </button>
        ))}
      </div>

      {load.state === "loading" ? <p class="bas-analytics__muted" data-testid="analytics-loading">{t.analyticsLoading}</p> : null}
      {load.state === "error" ? (
        <p class="bas-analytics__note" role="alert" data-testid="analytics-error" data-reason={load.reason}>
          {load.reason === "unconfigured" ? t.analyticsUnconfigured : t.analyticsUnavailable}
        </p>
      ) : null}
      {load.state === "ok" ? (
        <>
          <div class="bas-analytics__tiles">
            {(["visitors", "pageviews"] as const).map((k) => {
              const c = changePct(load.data.totals[k], load.data.prev[k]);
              return (
                <div key={k} class="bas-analytics__tile" data-testid={`analytics-${k}`}>
                  <div class="bas-analytics__label">{k === "visitors" ? t.analyticsVisitors : t.analyticsPageviews}</div>
                  <div class="bas-analytics__value" data-testid={`analytics-${k}-value`}>{num(load.data.totals[k])}</div>
                  <div class="bas-analytics__muted" data-testid={`analytics-${k}-change`}>
                    {c === null ? t.analyticsNoPrev : t.analyticsVsPrev.replace("{pct}", `${c > 0 ? "+" : ""}${c}`)}
                  </div>
                </div>
              );
            })}
          </div>
          <AnalyticsSeries data={fillDays(load.data.series, load.days)} t={t} locale={locale} num={num} />
          <div class="bas-analytics__card" data-testid="analytics-top-pages">
            <h2 class="bas-analytics__h">{t.analyticsTopPages}</h2>
            {load.data.topPages.length === 0 ? (
              <p class="bas-analytics__muted" data-testid="analytics-top-pages-empty">{t.analyticsEmpty}</p>
            ) : (
              <ol class="bas-analytics__pages">
                {load.data.topPages.map((p) => (
                  <li key={p.value} class="bas-analytics__page">
                    <span class="bas-analytics__path" title={p.value}>{p.value}</span>
                    <span class="bas-analytics__count">{num(p.count)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}

/** "2026-10-06" → "6. okt." — the key is a calendar date, so it is formatted as one (UTC, no shift). */
function dayLabel(day: string, locale: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "UTC" });
}

function AnalyticsSeries({ data, t, locale, num }: { data: AnalyticsDay[]; t: (typeof TEXT)[Lang]; locale: string; num: (n: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.pageviews));
  const empty = data.every((d) => d.pageviews === 0);
  return (
    <div class="bas-analytics__card" data-testid="analytics-series">
      <h2 class="bas-analytics__h">{t.analyticsOverTime}</h2>
      {empty ? (
        <p class="bas-analytics__muted" data-testid="analytics-series-empty">{t.analyticsEmpty}</p>
      ) : (
        <>
          <div class="bas-analytics__bars" aria-hidden="true">
            {data.map((d) => (
              <div key={d.day} class="bas-analytics__col" title={`${dayLabel(d.day, locale)}: ${num(d.pageviews)}`} data-day={d.day}>
                <div class="bas-analytics__bar" style={{ height: d.pageviews === 0 ? "0" : `max(2px, ${(d.pageviews / max) * 100}%)` }} />
              </div>
            ))}
          </div>
          <div class="bas-analytics__axis" aria-hidden="true">
            <span>{dayLabel(data[0]!.day, locale)}</span>
            <span>{dayLabel(data[data.length - 1]!.day, locale)}</span>
          </div>
          {/* The same numbers as a table, for a screen reader (the bars are decoration for it). */}
          <table class="bas-analytics__sr" data-testid="analytics-series-table">
            <caption>{t.analyticsOverTime}</caption>
            <thead>
              <tr>
                <th scope="col">{t.analyticsDay}</th>
                <th scope="col">{t.analyticsPageviews}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.day}>
                  <td>{dayLabel(d.day, locale)}</td>
                  <td>{num(d.pageviews)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

// ── Tenant switcher (F029.10) ──────────────────────────────────────────────

export interface TenantSwitcherProps {
  lang: Lang;
  /** The slug the app is in right now — the app knows it (from tenantMiddleware). */
  activeSlug: string;
  /** Default: `createFetchTenantAdapter()` → GET /api/me/memberships (@broberg/tenant/hono tenantRoutes). */
  adapter?: TenantAdapter;
  /**
   * Switch through the APP's own route — navigate to `/t/<slug>/…`, or set the
   * preference and reload. A rejection keeps the current organisation and shows
   * why; the switcher never pretends a switch happened.
   */
  onSwitch: (slug: string) => Promise<void> | void;
  /**
   * The role in the user's own words («Medarbejder», «Administrator»). Roles
   * are the app's vocabulary, so the switcher cannot translate them. Without
   * it no role is shown — a raw «member» in a Danish UI is worse than nothing.
   */
  roleLabel?: (role: string) => string;
}

/** Space kept between a popover and the screen edge. */
const EDGE = 16;

/**
 * The user's own organisations, the active one marked, and a switch. Only the
 * memberships the backend returns are listed — never a typed or guessed slug.
 * With one organisation it is a plain label, not a menu.
 */
export function TenantSwitcher({ lang, activeSlug, adapter, onSwitch, roleLabel }: TenantSwitcherProps) {
  const t = TEXT[lang];
  const api = useMemo(() => adapter ?? createFetchTenantAdapter(), [adapter]);
  const [rows, setRows] = useState<TenantMembershipRow[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [switchFailed, setSwitchFailed] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  // The switcher sits among the app's actions, not at the screen edge, so a
  // menu anchored to it can run off either side on a phone. Measure it and
  // shift it back inside, EDGE px from the edge (appkit, 393 px, Lens b0ff5fb2).
  useLayoutEffect(() => {
    const el = menu.current;
    if (!open || !el) return;
    el.style.transform = "";
    const r = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth || window.innerWidth;
    let dx = 0;
    if (r.right > vw - EDGE) dx = vw - EDGE - r.right;
    if (r.left + dx < EDGE) dx = EDGE - r.left;
    if (dx !== 0) el.style.transform = `translateX(${Math.round(dx)}px)`;
  }, [open, rows, loadFailed, switchFailed]);

  const load = () => {
    setLoadFailed(false);
    api.load().then(setRows, () => setLoadFailed(true));
  };
  useEffect(load, [api]);

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

  const active = rows?.find((r) => r.tenant.slug === activeSlug);
  const label = active?.tenant.name ?? activeSlug;

  const pick = async (slug: string) => {
    if (slug === activeSlug || busy) return;
    setBusy(slug);
    setSwitchFailed(false);
    try {
      await onSwitch(slug);
      setOpen(false);
    } catch {
      setSwitchFailed(true);
    } finally {
      setBusy(null);
    }
  };

  // One organisation, and it is the active one: nothing to switch to.
  if (rows && rows.length <= 1 && !loadFailed) {
    return (
      <div class="bas-tenant" data-testid="tenant-switcher">
        <span class="bas-tenant__label" data-testid="tenant-switcher-label">{label}</span>
      </div>
    );
  }

  return (
    <div class="bas-tenant" ref={root} data-testid="tenant-switcher">
      <button
        type="button"
        class={"bas-tenant__btn" + (open ? " is-open" : "")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t.tenantSwitch}
        onClick={() => setOpen((v) => !v)}
        data-testid="tenant-switcher-button"
      >
        <span class="bas-tenant__label" data-testid="tenant-switcher-label">{label}</span>
      </button>
      {open ? (
        <div class="bas-menu bas-tenant__menu" ref={menu} role="menu" data-testid="tenant-switcher-menu">
          {loadFailed ? (
            <div class="bas-tenant__note" role="alert" data-testid="tenant-switcher-load-error">
              <span>{t.tenantLoadFailed}</span>
              <button type="button" class="bas-mi" onClick={load} data-testid="tenant-switcher-retry">{t.tenantRetry}</button>
            </div>
          ) : null}
          {switchFailed ? (
            <p class="bas-tenant__note is-error" role="alert" data-testid="tenant-switcher-switch-error">
              {t.tenantSwitchFailed.replace("{name}", label)}
            </p>
          ) : null}
          {(rows ?? []).map((r) => {
            const isActive = r.tenant.slug === activeSlug;
            const suspended = r.tenant.status === "suspended";
            return (
              <button
                key={r.tenant.id}
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                class={"bas-mi bas-tenant__item" + (isActive ? " is-active" : "")}
                disabled={suspended || busy !== null}
                onClick={() => void pick(r.tenant.slug)}
                data-testid={`tenant-switcher-item-${r.tenant.slug}`}
              >
                <span class="bas-tenant__name">{r.tenant.name}</span>
                {suspended || isActive || roleLabel ? (
                  <span class="bas-tenant__role" data-testid={`tenant-switcher-role-${r.tenant.slug}`}>
                    {suspended ? t.tenantSuspended : isActive ? t.tenantActive : roleLabel!(r.role)}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

// ── F092.13 — ConfirmDialog ──────────────────────────────────────────────────
// The fleet's confirm window, so no app reaches for window.confirm() or a
// native <dialog> (D-4cd764). Built for appkit's «Slet» in a data-table row.
//
// Two choices that go beyond the obvious, both about the destructive case:
//  · it opens with focus on CANCEL, the safe button, so a stray Enter does
//    not delete anything;
//  · while `busy`, neither Escape nor a click outside closes it. The request
//    has already gone; a window that vanished would let the user believe they
//    had cancelled a deletion that is in fact happening.
export interface ConfirmDialogProps {
  open: boolean;
  title: ComponentChildren;
  body?: ComponentChildren;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button, for an action that cannot be undone. */
  destructive?: boolean;
  /** The confirm action is running: buttons disabled, the window cannot be dismissed. */
  busy?: boolean;
  /** Shown inside the window; the window stays open so the user can retry or cancel. */
  error?: ComponentChildren;
  onConfirm: () => void;
  onCancel: () => void;
  /** Prefix for every data-testid. Default "confirm-dialog". */
  testId?: string;
}

let confirmDialogSeq = 0;

export function ConfirmDialog(p: ConfirmDialogProps) {
  const t = p.testId ?? "confirm-dialog";
  const panel = useRef<HTMLDivElement>(null);
  const cancelBtn = useRef<HTMLButtonElement>(null);
  const ids = useMemo(() => {
    const n = ++confirmDialogSeq;
    return { title: `bas-confirm-title-${n}`, body: `bas-confirm-body-${n}` };
  }, []);
  // Read through a ref so the key handler, registered once per open, sees the
  // CURRENT busy/onCancel rather than the values from the moment it opened.
  const live = useRef(p);
  live.current = p;

  // useLayoutEffect, not useEffect (F092.14): Preact runs useEffect after paint,
  // and appkit measured 153 ms before focus reached Cancel. In that gap the ⋮
  // trigger still had focus, its own handler swallowed Escape, and the dialog had
  // no listener yet — so an Escape right after opening did nothing.
  useLayoutEffect(() => {
    if (!p.open) return;
    const before = document.activeElement as HTMLElement | null;
    cancelBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (!live.current.busy) live.current.onCancel();
        return;
      }
      if (e.key !== "Tab" || !panel.current) return;
      const focusable = [...panel.current.querySelectorAll<HTMLElement>("button:not([disabled])")];
      if (focusable.length === 0) { e.preventDefault(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panel.current.contains(active))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !panel.current.contains(active))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (before && typeof before.focus === "function" && document.contains(before)) before.focus();
    };
  }, [p.open]);

  if (!p.open) return null;
  return (
    <div
      class="bas-confirm-backdrop"
      data-testid={`${t}-backdrop`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !p.busy) p.onCancel();
      }}
    >
      <div
        ref={panel}
        class="bas-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={ids.title}
        aria-describedby={p.body ? ids.body : undefined}
        aria-busy={p.busy ? "true" : undefined}
        data-testid={t}
      >
        <h2 class="bas-confirm__title" id={ids.title} data-testid={`${t}-title`}>{p.title}</h2>
        {p.body ? <div class="bas-confirm__body" id={ids.body} data-testid={`${t}-body`}>{p.body}</div> : null}
        {p.error ? <div class="bas-confirm__error" role="alert" data-testid={`${t}-error`}>{p.error}</div> : null}
        <div class="bas-confirm__actions">
          <button ref={cancelBtn} type="button" class="bas-confirm__btn" disabled={p.busy} data-testid={`${t}-cancel`} onClick={() => p.onCancel()}>
            {p.cancelLabel ?? "Annuller"}
          </button>
          <button
            type="button"
            class={`bas-confirm__btn is-primary${p.destructive ? " is-danger" : ""}${p.busy ? " is-busy" : ""}`}
            disabled={p.busy}
            data-testid={`${t}-confirm`}
            onClick={() => p.onConfirm()}
          >
            {p.busy ? <span class="bas-confirm__spinner" aria-hidden="true" /> : null}
            {p.confirmLabel ?? "Bekræft"}
          </button>
        </div>
      </div>
    </div>
  );
}
