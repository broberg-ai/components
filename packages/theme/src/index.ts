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

export interface InitThemeOptions {
  /** Theme used when nothing is stored. Default `"dark"` (the preset is dark-first). */
  defaultTheme?: ThemeKey;
  /** When nothing is stored, follow the OS `prefers-color-scheme` (light/dark). */
  followSystem?: boolean;
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
const listeners = new Set<(theme: ThemeKey) => void>();

function isThemeKey(value: unknown): value is ThemeKey {
  return typeof value === "string" && (THEME_KEYS as readonly string[]).includes(value);
}

function readStored(): ThemeKey | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(storageKey);
    return isThemeKey(raw) ? raw : null;
  } catch {
    return null;
  }
}

function systemTheme(): ThemeKey {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "dark";
  }
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
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
    current = stored;
  } else if (options.followSystem) {
    current = systemTheme();
  } else {
    current = options.defaultTheme ?? "dark";
  }
  apply(current);
  return current;
}

/** Current theme key (the in-memory source of truth). */
export function getTheme(): ThemeKey {
  return current;
}

/** Set the theme: apply to <html>, persist, and notify subscribers. No-op on invalid keys. */
export function setTheme(theme: ThemeKey): void {
  if (!isThemeKey(theme)) return;
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
