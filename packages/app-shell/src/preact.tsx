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
  activeNavLabel,
  badgeLabel,
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
