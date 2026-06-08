/**
 * @broberg/theme/preact — Stack B (Bun/Hono/Preact) adapter.
 *
 * A thin `useTheme` hook over the headless store. No `next/*`, no React. Call
 * `initTheme()` once in your app entry, then `useTheme()` in components. The
 * theme toggle UI is copy-owned per app (Preact apps build their own button).
 */
import { useState, useEffect } from "preact/hooks";
import {
  type ThemeKey,
  THEME_KEYS,
  getTheme,
  setTheme as setThemeCore,
  toggleTheme as toggleThemeCore,
  onThemeChange,
} from "./index";

export { initTheme } from "./index";
export type { ThemeKey, InitThemeOptions } from "./index";

export interface UseThemeResult {
  theme: ThemeKey;
  setTheme: (theme: ThemeKey) => void;
  toggleTheme: () => ThemeKey;
  themes: readonly ThemeKey[];
}

/** Subscribe to the theme store and re-render on change. */
export function useTheme(): UseThemeResult {
  const [theme, setLocal] = useState<ThemeKey>(getTheme());
  useEffect(() => onThemeChange(setLocal), []);
  return {
    theme,
    setTheme: setThemeCore,
    toggleTheme: toggleThemeCore,
    themes: THEME_KEYS,
  };
}
