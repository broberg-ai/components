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
 * F092.10 — is this link leaving the app? An http(s) link to another origin.
 * Paths, "#…", mailto:/tel: and the app's own origin are not. Owner decision
 * D-d28547: every external link opens in a new tab.
 */
export function isExternal(
  href: string | null | undefined,
  origin: string | undefined = typeof location !== "undefined" ? location.origin : undefined,
): boolean {
  if (typeof href !== "string") return false;
  const h = href.trim();
  if (!origin) return /^(https?:)?\/\//i.test(h); // no page to compare with: absolute = external
  let u: URL;
  try {
    u = new URL(h, origin);
  } catch {
    return false;
  }
  return (u.protocol === "http:" || u.protocol === "https:") && u.origin !== origin;
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

// ── Account page (F095.3) ─────────────────────────────────────────────────
//
// The user edits their own name and picture inside the app. The app's backend
// (@broberg/sso's `accountRoutes()`, mounted on /api/account) talks to Broberg
// ID; this package only talks to that backend, through an adapter, and never
// imports @broberg/sso.

/** What every account call resolves to — the profile AS THE SERVER NOW HOLDS IT. */
export interface AccountProfile {
  sub: string;
  name: string | null;
  picture: string | null;
  email: string | null;
  /** Broberg ID's own account page (password, passkeys, sessions). */
  account_url: string;
}

/** Where the account page gets and saves the profile. Swap it to point anywhere. */
export interface AccountAdapter {
  load(): Promise<AccountProfile>;
  saveName(name: string): Promise<AccountProfile>;
  uploadAvatar(file: Blob): Promise<AccountProfile>;
  removeAvatar(): Promise<AccountProfile>;
}

/** A failed account call: the HTTP status and the server's `error` code, if any. */
export class AccountError extends Error {
  constructor(
    readonly status: number,
    readonly code?: string,
  ) {
    super(code ? `HTTP ${status} ${code}` : `HTTP ${status}`);
    this.name = "AccountError";
  }
}

export const AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

/** Checked BEFORE uploading, so a file the server will refuse is never sent. */
export function checkAvatarFile(file: { size: number; type: string }): "tooLarge" | "wrongType" | null {
  if (!(AVATAR_TYPES as readonly string[]).includes(file.type)) return "wrongType";
  if (file.size > AVATAR_MAX_BYTES) return "tooLarge";
  return null;
}

/**
 * What a failed call means for the page. `reauth` = the user's session or its
 * scope does not allow the change (401, or 403 insufficient_scope): signing in
 * again is the fix, so the page says that instead of «try again».
 */
export function accountErrorKind(err: unknown): "reauth" | "tooLarge" | "wrongType" | "other" {
  if (!(err instanceof AccountError)) return "other";
  if (err.status === 401) return "reauth";
  if (err.status === 403 && err.code === "insufficient_scope") return "reauth";
  if (err.status === 413) return "tooLarge";
  if (err.status === 415) return "wrongType";
  return "other";
}

/**
 * The default adapter: the app's own backend, shaped after @broberg/sso's
 * `accountRoutes()`.
 *
 *   GET  {url}/profile                → AccountProfile
 *   POST {url}/profile         {name} → AccountProfile
 *   POST {url}/profile/avatar  (raw bytes, Content-Type = the image's) → AccountProfile
 *   POST {url}/profile/avatar/remove  → AccountProfile
 *
 * A non-2xx THROWS an AccountError — a failed save must never look like a
 * saved one.
 */
export function createFetchAccountAdapter(opts: { url?: string; fetch?: typeof fetch; credentials?: RequestCredentials } = {}): AccountAdapter {
  const base = (opts.url ?? "/api/account").replace(/\/+$/, "");
  const call = async (path: string, init?: RequestInit): Promise<AccountProfile> => {
    const res = await (opts.fetch ?? fetch)(`${base}${path}`, {
      credentials: opts.credentials ?? "same-origin",
      ...init,
      headers: { accept: "application/json", ...(init?.headers as Record<string, string> | undefined) },
    });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) throw new AccountError(res.status, typeof body?.error === "string" ? body.error : undefined);
    if (!body || typeof body.sub !== "string") throw new AccountError(res.status, "bad_response");
    return body as unknown as AccountProfile;
  };
  return {
    load: () => call("/profile"),
    saveName: (name) =>
      call("/profile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) }),
    uploadAvatar: (file) =>
      call("/profile/avatar", { method: "POST", headers: { "content-type": file.type }, body: file }),
    removeAvatar: () => call("/profile/avatar/remove", { method: "POST" }),
  };
}

// ── Analytics page (F097) ─────────────────────────────────────────────────
//
// The app's OWN visitor numbers from Upmetrics. The app's backend mounts
// `analyticsRoutes()` from `@upmetrics/sdk/hono` (the uk_ key stays on the
// server); this package only talks to that backend, through an adapter, and has
// no dependency on the SDK — the type below is structural, so Upmetrics'
// `AnalyticsResponse` fits it as is.

export interface AnalyticsDay {
  /** YYYY-MM-DD on the Europe/Copenhagen calendar (Upmetrics' own day key). */
  day: string;
  visitors: number;
  pageviews: number;
}

export interface AnalyticsData {
  totals: { visitors: number; pageviews: number };
  /** The same-length period just before this one. */
  prev: { visitors: number; pageviews: number };
  /** Only days that had visits — use fillDays() to draw the whole period. */
  series: AnalyticsDay[];
  topPages: { value: string; count: number }[];
}

export interface AnalyticsAdapter {
  load(days: number): Promise<AnalyticsData>;
}

/** A failed analytics call: HTTP status (0 = no answer) and the server's `error` code. */
export class AnalyticsError extends Error {
  constructor(
    readonly status: number,
    readonly code?: string,
  ) {
    super(code ? `HTTP ${status} ${code}` : `HTTP ${status}`);
    this.name = "AnalyticsError";
  }
}

/** "unconfigured" only for the backend's explicit 503 analytics_unconfigured; anything else is "unavailable". */
export function analyticsErrorKind(err: unknown): "unconfigured" | "unavailable" {
  return err instanceof AnalyticsError && err.status === 503 && err.code === "analytics_unconfigured" ? "unconfigured" : "unavailable";
}

/**
 * The default adapter: `GET {url}?days=N` on the app's own backend (default
 * /api/analytics, where `@upmetrics/sdk/hono`'s analyticsRoutes() answers).
 * A non-2xx, an unreadable body or no answer at all THROWS — never zeros that
 * look like a real, quiet month.
 */
export function createFetchAnalyticsAdapter(opts: { url?: string; fetch?: typeof fetch; credentials?: RequestCredentials } = {}): AnalyticsAdapter {
  const url = opts.url ?? "/api/analytics";
  return {
    async load(days) {
      let res: Response;
      try {
        res = await (opts.fetch ?? fetch)(`${url}${url.includes("?") ? "&" : "?"}days=${encodeURIComponent(String(days))}`, {
          credentials: opts.credentials ?? "same-origin",
          headers: { accept: "application/json" },
        });
      } catch {
        throw new AnalyticsError(0);
      }
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) throw new AnalyticsError(res.status, typeof body?.error === "string" ? body.error : undefined);
      const ok =
        body !== null &&
        typeof (body.totals as Record<string, unknown> | undefined)?.visitors === "number" &&
        Array.isArray(body.series) &&
        Array.isArray(body.topPages);
      if (!ok) throw new AnalyticsError(res.status, "bad_response");
      return body as unknown as AnalyticsData;
    },
  };
}

/** Today's YYYY-MM-DD on the Copenhagen calendar — the calendar Upmetrics buckets on. */
export function copenhagenDay(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/**
 * Exactly `days` entries ending today (Copenhagen calendar), with Upmetrics'
 * values where it sent a day and zeros where it did not — Upmetrics only sends
 * days that had visits. Calendar arithmetic, so a DST change never skips or
 * repeats a day.
 */
export function fillDays(series: AnalyticsDay[], days: number, now: Date = new Date()): AnalyticsDay[] {
  const byDay = new Map(series.map((d) => [d.day, d]));
  const [y, m, d] = copenhagenDay(now).split("-").map(Number) as [number, number, number];
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(Date.UTC(y, m - 1, d - (days - 1 - i))).toISOString().slice(0, 10);
    return byDay.get(day) ?? { day, visitors: 0, pageviews: 0 };
  });
}

/** Whole-percent change against the previous period, or null when there is nothing to compare with. */
export function changePct(now: number, before: number): number | null {
  return before === 0 ? null : Math.round(((now - before) / before) * 100);
}

// ── Tenant switcher (F029.10) ──────────────────────────────────────────────
//
// The user's own organisations, from the app's backend (@broberg/tenant/hono's
// tenantRoutes: GET /memberships). This package never imports @broberg/tenant;
// the row type is structural.

export interface TenantMembershipRow {
  tenant: { id: string; slug: string; name: string; status?: "active" | "suspended" };
  role: string;
}

export interface TenantAdapter {
  load(): Promise<TenantMembershipRow[]>;
}

export class TenantLoadError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
    this.name = "TenantLoadError";
  }
}

/** GET {url} (default /api/me/memberships) → the user's memberships. Non-2xx or a bad body THROWS. */
export function createFetchTenantAdapter(opts: { url?: string; fetch?: typeof fetch; credentials?: RequestCredentials } = {}): TenantAdapter {
  return {
    async load() {
      let res: Response;
      try {
        res = await (opts.fetch ?? fetch)(opts.url ?? "/api/me/memberships", { credentials: opts.credentials ?? "same-origin", headers: { accept: "application/json" } });
      } catch {
        throw new TenantLoadError(0);
      }
      const body = (await res.json().catch(() => null)) as unknown;
      if (!res.ok) throw new TenantLoadError(res.status);
      if (!Array.isArray(body) || !body.every((r) => r && typeof r.role === "string" && r.tenant && typeof r.tenant.slug === "string")) {
        throw new TenantLoadError(res.status);
      }
      return body as TenantMembershipRow[];
    },
  };
}

// ── Text ───────────────────────────────────────────────────────────────────

export const TEXT = {
  da: {
    openMenu: "Åbn menu",
    closeMenu: "Luk menu",
    home: "Forside",
    language: "Sprog",
    couldNotMarkAll: "Kunne ikke markere alle som læst. Prøv igen.",
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
    name: "Navn",
    email: "E-mail",
    save: "Gem",
    saving: "Gemmer…",
    saved: "Gemt",
    loadingProfile: "Henter profil…",
    couldNotLoadProfile: "Kunne ikke hente din profil.",
    couldNotSave: "Kunne ikke gemme. Prøv igen.",
    reauth: "Log ind igen for at rette",
    signInAgain: "Log ind igen",
    changePicture: "Skift billede",
    removePicture: "Fjern billede",
    confirmRemovePicture: "Fjern dit billede?",
    remove: "Fjern",
    cancel: "Annuller",
    pictureSaved: "Billedet er gemt",
    pictureRemoved: "Billedet er fjernet",
    pictureTooLarge: "Billedet er for stort — højst 2 MB.",
    pictureWrongType: "Vælg et PNG-, JPEG- eller WebP-billede.",
    bidSecurity: "Sikkerhed i Broberg ID",
    analyticsPeriod: "Periode",
    analyticsDays: "{n} dage",
    analyticsVisitors: "Besøgende",
    analyticsPageviews: "Sidevisninger",
    analyticsVsPrev: "{pct} % mod forrige periode",
    analyticsNoPrev: "Ingen sammenligning",
    analyticsOverTime: "Sidevisninger pr. dag",
    analyticsTopPages: "Mest besøgte sider",
    analyticsDay: "Dag",
    analyticsPage: "Side",
    analyticsEmpty: "Ingen besøg i perioden.",
    analyticsLoading: "Henter tal…",
    analyticsUnconfigured: "Analytics er ikke sat op for denne app.",
    analyticsUnavailable: "Upmetrics svarer ikke lige nu. Prøv igen om lidt.",
    tenantSwitch: "Skift organisation",
    tenantLoadFailed: "Kunne ikke hente dine organisationer.",
    tenantSwitchFailed: "Kunne ikke skifte organisation. Du er stadig i {name}.",
    tenantRetry: "Prøv igen",
    tenantSuspended: "lukket",
    tenantActive: "aktiv",
  },
  en: {
    openMenu: "Open menu",
    closeMenu: "Close menu",
    home: "Home",
    language: "Language",
    couldNotMarkAll: "Could not mark all as read. Try again.",
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
    name: "Name",
    email: "Email",
    save: "Save",
    saving: "Saving…",
    saved: "Saved",
    loadingProfile: "Loading profile…",
    couldNotLoadProfile: "Could not load your profile.",
    couldNotSave: "Could not save. Try again.",
    reauth: "Sign in again to make changes",
    signInAgain: "Sign in again",
    changePicture: "Change picture",
    removePicture: "Remove picture",
    confirmRemovePicture: "Remove your picture?",
    remove: "Remove",
    cancel: "Cancel",
    pictureSaved: "Picture saved",
    pictureRemoved: "Picture removed",
    pictureTooLarge: "The picture is too large — 2 MB at most.",
    pictureWrongType: "Choose a PNG, JPEG or WebP image.",
    bidSecurity: "Security in Broberg ID",
    analyticsPeriod: "Period",
    analyticsDays: "{n} days",
    analyticsVisitors: "Visitors",
    analyticsPageviews: "Page views",
    analyticsVsPrev: "{pct}% vs previous period",
    analyticsNoPrev: "No comparison",
    analyticsOverTime: "Page views per day",
    analyticsTopPages: "Most visited pages",
    analyticsDay: "Day",
    analyticsPage: "Page",
    analyticsEmpty: "No visits in this period.",
    analyticsLoading: "Loading figures…",
    analyticsUnconfigured: "Analytics is not set up for this app.",
    analyticsUnavailable: "Upmetrics is not answering right now. Try again shortly.",
    tenantSwitch: "Switch organisation",
    tenantLoadFailed: "Could not load your organisations.",
    tenantSwitchFailed: "Could not switch organisation. You are still in {name}.",
    tenantRetry: "Try again",
    tenantSuspended: "suspended",
    tenantActive: "active",
  },
} as const;
export type Lang = keyof typeof TEXT;
