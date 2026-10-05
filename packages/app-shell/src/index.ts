// @broberg/app-shell — the framework-free core of the fleet's app shell (F092).
//
// The shell every app in the fleet had been copying: sidebar + top bar +
// notification bell + user menu. cardmem and trail each had one ("ported from
// trail"), and helpdesk and the appkit starter would have made the third and
// fourth. This file holds what does not depend on a framework: the navigation
// data model, the notification contract and its sources, and the small rules
// both the Preact and React parts must agree on.
//
// Christian, 4 Oct 2026: notifications are a STANDARD part of the template, not
// an optional slot — so the contract and a default source live here, and a new
// app gets a working notification centre by pointing one URL at its backend.

// ── Navigation ─────────────────────────────────────────────────────────────

/** One sidebar entry. `icon` is whatever your framework renders (an element). */
export interface NavItem<Icon = unknown> {
  id: string;
  label: string;
  href: string;
  icon?: Icon;
  /** A count shown on the item (99+ above 99). 0/undefined shows nothing. */
  badge?: number;
  /**
   * Sub-items, ONE level (F092.5). An item with children is a toggle that opens
   * and closes them, not a link; its own `href` is used only to decide whether
   * it is on the current path.
   */
  children?: NavItem<Icon>[];
}
export interface NavGroup<Icon = unknown> {
  label: string;
  items: NavItem<Icon>[];
}

/**
 * Is this item the current page? Exact match for "/", otherwise the path is the
 * item or below it ("/board/123" is on "/board", "/boardroom" is not).
 */
export function isActivePath(href: string, currentPath: string): boolean {
  const path = (currentPath.split(/[?#]/)[0] || "/").replace(/\/+$/, "") || "/";
  const target = (href.split(/[?#]/)[0] || "/").replace(/\/+$/, "") || "/";
  if (target === "/") return path === "/";
  return path === target || path.startsWith(target + "/");
}

/**
 * A notification's `navigate` is SERVER DATA, and it ends in `location.assign`.
 * `javascript:` there runs code in the app, so only a same-site path or an
 * http(s) URL is followed; anything else returns null and the row just closes.
 */
export function safeNavigate(target: string | null | undefined): string | null {
  if (typeof target !== "string") return null;
  const t = target.trim();
  if (t.startsWith("/") && !t.startsWith("//") && !t.startsWith("/\\")) return t;
  try {
    const u = new URL(t);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * The label of the nav item the user is on, for the content header (F092.4).
 * Sub-items count, and the most specific match wins: on "/models/genesis" a
 * "Genesis" child beats its "Models" parent.
 */
export function activeNavLabel<Icon>(
  groups: NavGroup<Icon>[],
  footer: NavItem<Icon>[] | undefined,
  currentPath: string,
): string | undefined {
  let best: { label: string; len: number } | undefined;
  const visit = (it: NavItem<Icon>) => {
    if (it.href && isActivePath(it.href, currentPath)) {
      const len = it.href.length;
      if (!best || len > best.len) best = { label: it.label, len };
    }
    it.children?.forEach(visit);
  };
  for (const g of groups) g.items.forEach(visit);
  footer?.forEach(visit);
  return best?.label;
}

/** "99+" above 99, nothing for 0 or less. */
export function badgeLabel(n: number | undefined): string | null {
  if (!n || n <= 0) return null;
  return n > 99 ? "99+" : String(n);
}

// ── Persisted UI state ─────────────────────────────────────────────────────

/** Read a boolean flag from localStorage; storage errors read as `fallback`. */
export function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = typeof localStorage === "undefined" ? null : localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}
export function writeFlag(key: string, value: boolean): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* private mode / quota: the UI still works, it just does not remember */
  }
}
export function readSet(key: string): Set<string> {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(key);
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}
export function writeSet(key: string, value: Set<string>): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, JSON.stringify([...value]));
  } catch {
    /* see writeFlag */
  }
}

// ── Avatar ─────────────────────────────────────────────────────────────────

/**
 * Two initials for the avatar fallback: first letter of the first and the last
 * word, upper-cased. One word gives one letter; nothing gives "?".
 *
 * There is deliberately no Gravatar here (owner decision D-1dc849): the avatar
 * is the Broberg ID `picture`, and without one, initials. Gravatar would send a
 * hash of the user's email to a US service on every render.
 */
export function initials(name: string | undefined, email?: string): string {
  const source = (name ?? "").trim() || (email ?? "").split("@")[0] || "";
  const words = source.split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0]![0] ?? "";
  const last = words.length > 1 ? words[words.length - 1]![0] ?? "" : "";
  return (first + last).toUpperCase() || "?";
}

// ── Notifications ──────────────────────────────────────────────────────────
//
// REUSE, NOT A SECOND CONTRACT. The fleet already agreed the notification shape
// in @broberg/notifications (F074): `NotificationRow` — the same field names
// @broberg/webpush sends, end to end — and the server core that owns the ONE
// counting rule. The shell's bell renders that row and drives its panel with
// that package's `createBellShell`, so a server built on `createNotifications`
// and this bell speak the same language without an adapter.
//
// Christian, 4 Oct 2026: notifications are a STANDARD part of the template. So
// a source, and a default one, ship here: point one URL at your backend.

import type { NotificationRow } from "@broberg/notifications/types";
export type { NotificationRow } from "@broberg/notifications/types";

/** Where the bell gets its data. Swap it to point at any backend. */
export interface NotificationSource {
  /** The rows to show (newest first). */
  loadRows(): Promise<NotificationRow[]>;
  /** THE count — your server's, which may exclude muted kinds (F074's counting rule). */
  countUnseen(): Promise<number>;
  /** Returns the ids that actually transitioned to seen. */
  markSeen(ids: readonly string[]): Promise<string[]>;
  markAllSeen(): Promise<string[]>;
  /** Called with a callback that re-counts; return an unsubscribe. Optional. */
  subscribe?(onChange: () => void): () => void;
}

/**
 * The default source: a URL on your own backend, shaped after
 * @broberg/notifications' server core so `createNotifications` sits right
 * behind it.
 *
 *   GET  {url}           → { items: NotificationRow[], unseen: number }
 *   POST {url}/seen      { ids: string[] } → { clearedIds: string[], count: number }
 *   POST {url}/seen-all  → { clearedIds: string[], count: number }
 *
 * It re-counts when the window regains focus or the tab becomes visible, and on
 * a timer (default 60 s). A failed GET THROWS — the bell shows «could not
 * load», never an empty list: "could not fetch" and "nothing new" must not look
 * the same.
 */
export function createFetchNotificationSource(opts: {
  url: string;
  fetch?: typeof fetch;
  /** Re-count interval in ms. 0 turns it off. Default 60 000. */
  pollMs?: number;
  credentials?: RequestCredentials;
}): NotificationSource {
  const base = opts.url.replace(/\/+$/, "");
  const doFetch = (input: string, init?: RequestInit) =>
    (opts.fetch ?? fetch)(input, { credentials: opts.credentials ?? "include", ...init });
  const get = async (): Promise<{ items: NotificationRow[]; unseen: number }> => {
    const res = await doFetch(base, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json().catch(() => null)) as { items?: unknown; unseen?: unknown } | null;
    if (!body || !Array.isArray(body.items)) throw new Error("response has no items array");
    const items = body.items as NotificationRow[];
    const unseen = typeof body.unseen === "number" ? body.unseen : items.filter((n) => n.seenAt == null).length;
    return { items, unseen };
  };
  const post = async (path: string, body?: unknown): Promise<string[]> => {
    const res = await doFetch(`${base}${path}`, {
      method: "POST",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const r = (await res.json().catch(() => ({}))) as { clearedIds?: unknown };
    return Array.isArray(r.clearedIds) ? (r.clearedIds as string[]) : [];
  };
  return {
    loadRows: async () => (await get()).items,
    countUnseen: async () => (await get()).unseen,
    markSeen: (ids) => post("/seen", { ids }),
    markAllSeen: () => post("/seen-all"),
    subscribe(onChange) {
      if (typeof window === "undefined") return () => {};
      const onVisible = () => {
        if (document.visibilityState === "visible") onChange();
      };
      window.addEventListener("focus", onChange);
      document.addEventListener("visibilitychange", onVisible);
      const ms = opts.pollMs ?? 60_000;
      const timer = ms > 0 ? setInterval(onChange, ms) : null;
      return () => {
        window.removeEventListener("focus", onChange);
        document.removeEventListener("visibilitychange", onVisible);
        if (timer) clearInterval(timer);
      };
    },
  };
}

/** An in-memory source for demos and tests. */
export function createMemoryNotificationSource(initial: NotificationRow[] = []): NotificationSource & {
  push(n: NotificationRow): void;
  rows(): NotificationRow[];
} {
  let rows = initial.map((n) => ({ ...n }));
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  const mark = (pred: (n: NotificationRow) => boolean): string[] => {
    const now = Date.now();
    const cleared: string[] = [];
    rows = rows.map((n) => {
      if (n.seenAt == null && pred(n)) {
        cleared.push(n.id);
        return { ...n, seenAt: now };
      }
      return n;
    });
    if (cleared.length) emit();
    return cleared;
  };
  return {
    loadRows: async () => rows.map((n) => ({ ...n })),
    countUnseen: async () => rows.filter((n) => n.seenAt == null).length,
    markSeen: async (ids) => mark((n) => ids.includes(n.id)),
    markAllSeen: async () => mark(() => true),
    subscribe(onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    push(n) {
      rows = [n, ...rows];
      emit();
    },
    rows: () => rows.map((n) => ({ ...n })),
  };
}

/** "nu", "5 min", "3 t", "i går", "4 d" (da) or the English equivalents. */
export function relativeTime(ts: string | number, lang: "da" | "en", now = Date.now()): string {
  const ms = typeof ts === "number" ? ts : Date.parse(ts);
  if (!Number.isFinite(ms)) return "";
  const m = Math.floor((now - ms) / 60_000);
  if (m < 1) return lang === "da" ? "nu" : "now";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return lang === "da" ? `${h} t` : `${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return lang === "da" ? "i går" : "yesterday";
  return `${d} d`;
}

// ── Text ───────────────────────────────────────────────────────────────────

export const TEXT = {
  da: {
    openMenu: "Åbn menu",
    closeMenu: "Luk menu",
    couldNotMarkAll: "Kunne ikke markere alle som læst. Prøv igen.",
    home: "Forside",
    collapse: "Skjul sidemenu",
    expand: "Vis sidemenu",
    notifications: "Notifikationer",
    markAllRead: "Markér alle læst",
    noNotifications: "Ingen notifikationer endnu.",
    couldNotLoad: "Kunne ikke hente notifikationer.",
    seeAll: "Vis alle",
    close: "Luk",
    account: "Konto",
    signOut: "Log ud",
    theme: "Tema",
    light: "Lys",
    dark: "Mørk",
    system: "System",
    palette: "Palet",
    surfaces: "Flader",
    flat: "Flade",
    layered: "Lag",
    backdrop: "Baggrund",
    neurons: "Neuroner",
    plain: "Ren",
  },
  en: {
    openMenu: "Open menu",
    closeMenu: "Close menu",
    couldNotMarkAll: "Could not mark all as read. Try again.",
    home: "Home",
    collapse: "Hide sidebar",
    expand: "Show sidebar",
    notifications: "Notifications",
    markAllRead: "Mark all read",
    noNotifications: "No notifications yet.",
    couldNotLoad: "Could not load notifications.",
    seeAll: "See all",
    close: "Close",
    account: "Account",
    signOut: "Sign out",
    theme: "Theme",
    light: "Light",
    dark: "Dark",
    system: "System",
    palette: "Palette",
    surfaces: "Surfaces",
    flat: "Flat",
    layered: "Layered",
    backdrop: "Backdrop",
    neurons: "Neurons",
    plain: "Plain",
  },
} as const;
export type Lang = keyof typeof TEXT;
