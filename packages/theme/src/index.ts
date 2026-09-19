/**
 * @broberg/theme — headless theme store.
 *
 * Applies `data-theme="<key>"` to <html>, persists the choice to localStorage,
 * and notifies subscribers. Framework-agnostic: no React, no Preact, no next/*.
 * SSR-safe — every DOM / localStorage access is behind a `typeof` guard, so
 * importing and calling this module on a server (Node) never throws.
 *
 * Generalises broberg/trail apps/admin/src/theme.ts (two-mode) to the
 * six-variant token system shipped by the neutral CSS preset.
 */

export type ThemeKey =
  | "light"
  | "dark"
  | "light-cool"
  | "light-warm"
  | "dark-cool"
  | "dark-warm";

/**
 * What the user CHOSE. Distinct from the ThemeKey that ends up on <html>:
 * `system` is not a palette, it is a way of choosing one (F001.16).
 */
export type ThemePreference = ThemeKey | "system";

export interface InitThemeOptions {
  /** Theme used when nothing is stored. Default `"dark"` (the preset is dark-first). */
  defaultTheme?: ThemeKey;
  /**
   * When nothing is stored, follow the OS `prefers-color-scheme` (light/dark).
   *
   * @deprecated F001.16 — prefer `defaultPreference: "system"`, which KEEPS
   * following the OS instead of only doing so until the first `setTheme`.
   * Behaviour is unchanged; nothing that passes this needs to move.
   */
  followSystem?: boolean;
  /**
   * Preference used when nothing is stored. `"system"` follows the OS and keeps
   * following it. Wins over `followSystem` when both are given.
   */
  defaultPreference?: ThemePreference;
  /** localStorage key. Default `"broberg-theme"`. */
  storageKey?: string;
}

const DEFAULT_STORAGE_KEY = "broberg-theme";

/** Every valid theme key, in declaration order. */
export const THEME_KEYS: readonly ThemeKey[] = [
  "light",
  "dark",
  "light-cool",
  "light-warm",
  "dark-cool",
  "dark-warm",
];

let storageKey = DEFAULT_STORAGE_KEY;
let current: ThemeKey = "dark";
let preference: ThemePreference = "dark";
const listeners = new Set<(theme: ThemeKey) => void>();

/** A preference is any theme key, plus "system". */
function isPreference(value: unknown): value is ThemePreference {
  return value === "system" || isThemeKey(value);
}

function isThemeKey(value: unknown): value is ThemeKey {
  return typeof value === "string" && (THEME_KEYS as readonly string[]).includes(value);
}

/**
 * The stored PREFERENCE. Shares the key with the pre-F001.16 format on purpose,
 * and that is compatible in both directions:
 *
 *   old stored "dark", new code   -> a valid preference, nothing to migrate
 *   new stored "system", OLD code -> isThemeKey("system") is false, so the old
 *                                    readStored() returns null and that copy
 *                                    falls back to its default. It degrades; it
 *                                    does not throw. Two versions WILL coexist
 *                                    across the fleet during a rollout.
 */
function readStored(): ThemePreference | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(storageKey);
    return isPreference(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * The ONE media query that decides "what does the OS want". Named because the
 * pre-paint snippet must ask the same question as the module — see
 * {@link prePaintScript}. A second copy of this string is a theme that flips
 * between the first paint and the first render.
 */
const SYSTEM_LIGHT_QUERY = "(prefers-color-scheme: light)";

function systemTheme(): ThemeKey {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "dark";
  }
  return window.matchMedia(SYSTEM_LIGHT_QUERY).matches ? "light" : "dark";
}

/** A preference resolves to the key that goes on <html>. */
function resolve(pref: ThemePreference): ThemeKey {
  return pref === "system" ? systemTheme() : pref;
}

function apply(theme: ThemeKey): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
}

/**
 * Resolve the initial theme (stored > system > default), apply it to <html>,
 * and return it. Call once on the client (e.g. in a ThemeProvider effect).
 */
export function initTheme(options: InitThemeOptions = {}): ThemeKey {
  if (options.storageKey) storageKey = options.storageKey;
  const stored = readStored();
  if (stored) {
    preference = stored;
  } else if (options.defaultPreference) {
    preference = options.defaultPreference;
  } else if (options.followSystem) {
    // Unchanged: a one-shot read when nothing is stored. Deprecated in favour of
    // defaultPreference:"system", which keeps following. Left alone deliberately
    // — it ships and consumers pass it. Replace, prove, THEN remove.
    preference = systemTheme();
  } else {
    preference = options.defaultTheme ?? "dark";
  }
  current = resolve(preference);
  apply(current);
  // RE-ATTACH, do not reuse. initTheme is documented as "call once", but a React
  // effect can run twice, and a second init may carry a different storageKey or
  // land in a different window (jsdom between tests). Keeping the first watch
  // would leave it listening to a matchMedia nobody can flip any more — a
  // listener that exists and is deaf, which is this card's own defect wearing a
  // different hat. Found by the test asserting exactly one listener: it read 0,
  // because the guard below had short-circuited on a stale handle.
  stopWatchingSystem();
  watchSystem();
  return current;
}

/**
 * The OS listener, attached ONCE and kept attached whatever the preference is.
 *
 * THE PART THAT IS EASY TO GET WRONG, and it passes every other test in this
 * file: attach it only while the preference IS "system" and the app goes deaf
 * after light -> dark -> system, because the listener was torn down on the way
 * out and never rebuilt. So it stays, and re-reads the preference on each
 * change instead of capturing it.
 */
let systemWatch: (() => void) | null = null;

/** Detach the OS listener, if one is attached. */
function stopWatchingSystem(): void {
  if (!systemWatch) return;
  systemWatch();
  systemWatch = null;
}

function watchSystem(): void {
  if (systemWatch) return;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
  const mq = window.matchMedia("(prefers-color-scheme: light)");
  const onChange = (): void => {
    if (preference !== "system") return; // re-read, never captured
    const next = systemTheme();
    if (next === current) return;
    current = next;
    apply(current);
    for (const listener of listeners) listener(current);
  };
  if (typeof mq.addEventListener === "function") {
    mq.addEventListener("change", onChange);
    systemWatch = () => mq.removeEventListener("change", onChange);
  } else if (typeof (mq as unknown as { addListener?: unknown }).addListener === "function") {
    // Safari < 14 and older WebViews. Cheap to support, and this package ships
    // to phones.
    const legacy = mq as unknown as {
      addListener: (fn: () => void) => void;
      removeListener: (fn: () => void) => void;
    };
    legacy.addListener(onChange);
    systemWatch = () => legacy.removeListener(onChange);
  }
}

/** The user's CHOICE — "system" stays "system", never the value it resolved to. */
export function getPreference(): ThemePreference {
  return preference;
}

/**
 * Set the preference: resolve, apply, persist, notify. `"system"` follows the OS
 * and KEEPS following it. No-op on anything that is not a preference.
 */
export function setPreference(pref: ThemePreference): void {
  if (!isPreference(pref)) return;
  preference = pref;
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(storageKey, pref);
    } catch {
      /* ignore quota / private-mode errors */
    }
  }
  watchSystem();
  const next = resolve(pref);
  current = next;
  apply(next);
  for (const listener of listeners) listener(next);
}

/** Current theme key (the in-memory source of truth). */
export function getTheme(): ThemeKey {
  return current;
}

/** Set the theme: apply to <html>, persist, and notify subscribers. No-op on invalid keys. */
export function setTheme(theme: ThemeKey): void {
  if (!isThemeKey(theme)) return;
  // An explicit theme IS a preference — otherwise a later OS change would still
  // be followed by a user who just picked one by hand.
  preference = theme;
  current = theme;
  apply(theme);
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(storageKey, theme);
    } catch {
      /* ignore quota / private-mode errors */
    }
  }
  for (const listener of listeners) listener(theme);
}

/** Toggle the two base modes (light <-> dark). Variant themes collapse to their base mode. */
export function toggleTheme(): ThemeKey {
  setTheme(current.startsWith("dark") ? "light" : "dark");
  return current;
}

/** Subscribe to theme changes. Returns an unsubscribe function. */
export function onThemeChange(listener: (theme: ThemeKey) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Standard responsive breakpoints in px — a single source so every app switches
 * layouts at the same widths (mirrors the preset's `--breakpoint-*` and Tailwind
 * v4's defaults). Use for `matchMedia` / programmatic checks; CSS uses the tokens.
 *
 *   if (matchMedia(`(min-width: ${BREAKPOINTS.md}px)`).matches) { … }
 */
export const BREAKPOINTS = { sm: 640, md: 768, lg: 1024, xl: 1280 } as const;
export type Breakpoint = keyof typeof BREAKPOINTS;

/** Minimum touch-target size in px (Apple/Google ≥44). Never ship a smaller tap target. */
export const TOUCH_TARGET_MIN = 44;

/* ── pre-paint ─────────────────────────────────────────────────────────────
 * F084.24 — the snippet that runs BEFORE the bundle, from the same source as
 * the module that runs after it.
 */

export interface PrePaintOptions {
  /** localStorage key. Default `"broberg-theme"` — the same default initTheme uses. */
  storageKey?: string;
  /**
   * Preference when nothing valid is stored. MUST match the `defaultPreference`
   * you pass to {@link initTheme}, or the page resolves one theme before the
   * bundle and a different one after it — which is the flash this exists to
   * prevent. Default `"dark"`, matching initTheme's own default.
   */
  defaultPreference?: ThemePreference;
}

/**
 * The `<head>` snippet that puts `data-theme` on `<html>` BEFORE the first
 * paint — as a string, built from this package's own constants.
 *
 * ── WHY THIS IS IN THE PACKAGE (F084.24) ─────────────────────────────────
 *
 * A bundle cannot do this job. It loads after the first paint, so a page that
 * waits for it flashes white — and it flashes at exactly the people who chose
 * dark because light hurts. So every Stack-B app wrote its own seven lines of
 * raw JavaScript in its Vite config: read localStorage, fall back, ask
 * matchMedia, set the attribute.
 *
 * Seven lines is small enough to look harmless and is the whole problem. It is
 * a SECOND implementation of "which theme", and the two had already drifted
 * before anyone noticed: BID's copy defaulted to `"system"` while the module
 * defaulted to `"dark"`, and the copy never told the module what it had
 * decided. The menu then read a `preference` nobody had written and showed
 * «Mørkt» ticked on a light page — disagreeing with the user's own stored
 * choice, so pressing the ticked item WROTE a choice she never made.
 *
 * Reading the stored key, deciding what counts as valid, and asking the OS are
 * now answered once, here, and handed to the page as text.
 *
 * ── STILL TWO EXECUTIONS, AND THAT CANNOT CHANGE ─────────────────────────
 *
 * This does not remove the second run — the snippet runs, then `initTheme()`
 * runs. It removes the second AUTHORING. They agree because they are generated
 * from the same constants, and `test/pre-paint.test.ts` runs both over every
 * state and requires the same answer. Without that test "one source" would be
 * a claim about where the code lives rather than about what it does.
 *
 * ── USE ──────────────────────────────────────────────────────────────────
 *
 * Vite (`transformIndexHtml`):
 * ```ts
 * { tag: "script", children: prePaintScript({ defaultPreference: "system" }), injectTo: "head" }
 * ```
 * Next (`app/layout.tsx`):
 * ```tsx
 * <script dangerouslySetInnerHTML={{ __html: prePaintScript({ defaultPreference: "system" }) }} />
 * ```
 * Pass the SAME options to `initTheme()`. It contains no interpolated
 * caller input — only this package's own constants and the two options, both
 * JSON-encoded — so there is nothing for a page to inject through.
 *
 * ── A STORED `"system"` IS UNDERSTOOD, AND WHICH VERSION MATTERS ─────────
 *
 * The snippet checks for `"system"` BEFORE it validates against THEME_KEYS,
 * because "system" is not a palette — it is a way of choosing one. So a
 * consumer who stores `light | dark | system` under their own key can point
 * `storageKey` at it and both halves read it correctly.
 *
 * SAY THE VERSION OUT LOUD, because a consumer measuring their INSTALLED dist
 * is how this goes wrong: the whole preference layer — `ThemePreference`,
 * `setPreference`, `getPreference`, `defaultPreference` — arrived in **0.7.0**
 * (F001.16). Before that the package had only ThemeKeys, `setTheme("system")`
 * was a silent no-op, and a stored value won forever. That is correct for
 * ≤0.6.0 and false from 0.7.0 on.
 *
 * Measured, not assumed: cardmem read their own 0.6.0 dist, found no
 * preference concept, correctly built their own layer on top — and then read
 * that measurement forward onto 0.8.0 and concluded the snippet could not
 * handle their stored `"system"`. It can. They were one release behind the
 * thing they needed, and nothing in the package told them so.
 */
export function prePaintScript(options: PrePaintOptions = {}): string {
  const key = JSON.stringify(options.storageKey ?? DEFAULT_STORAGE_KEY);
  const fallback = JSON.stringify(options.defaultPreference ?? "dark");
  const keys = JSON.stringify(THEME_KEYS);
  const query = JSON.stringify(SYSTEM_LIGHT_QUERY);
  // A private window throws on localStorage; the catch leaves the attribute
  // unset, and the CSS default applies. Never let a theme kill the page.
  return (
    `try{` +
    `var k=${key},d=${fallback},K=${keys};` +
    `var p=localStorage.getItem(k);` +
    `if(p!=="system"&&K.indexOf(p)<0)p=d;` +
    `var t=p==="system"?(matchMedia(${query}).matches?"light":"dark"):p;` +
    `document.documentElement.setAttribute("data-theme",t)` +
    `}catch(e){}`
  );
}
