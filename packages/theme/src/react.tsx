/**
 * @broberg/theme/react — Stack A (React 18/19, Next.js 16) adapter.
 *
 * Wraps the headless store directly via `useSyncExternalStore` — no `next-themes`
 * dependency, so it works in any React app, SSR-safe out of the box. The
 * `ThemeToggle` is a minimal, self-contained starter (light<->dark button with a
 * stable `data-testid`); a full Sun/Moon/Monitor dropdown is copy-owned per app.
 */
import * as React from "react";
import {
  type ThemeKey,
  type InitThemeOptions,
  THEME_KEYS,
  getTheme,
  setTheme as setThemeCore,
  toggleTheme as toggleThemeCore,
  onThemeChange,
  initTheme,
} from "./index";

export interface UseThemeResult {
  theme: ThemeKey;
  setTheme: (theme: ThemeKey) => void;
  toggleTheme: () => ThemeKey;
  themes: readonly ThemeKey[];
}

function subscribe(onStoreChange: () => void): () => void {
  return onThemeChange(() => onStoreChange());
}

/** Subscribe to the theme store and trigger re-renders on change. */
export function useTheme(): UseThemeResult {
  const theme = React.useSyncExternalStore<ThemeKey>(
    subscribe,
    () => getTheme(),
    () => "dark",
  );
  return {
    theme,
    setTheme: setThemeCore,
    toggleTheme: toggleThemeCore,
    themes: THEME_KEYS,
  };
}

export interface ThemeProviderProps extends InitThemeOptions {
  children?: React.ReactNode;
}

/** Initialises the theme once on mount (client only). Render at the app root. */
export function ThemeProvider({ children, ...options }: ThemeProviderProps): React.ReactElement {
  const opts = React.useRef(options);
  React.useEffect(() => {
    initTheme(opts.current);
  }, []);
  return React.createElement(React.Fragment, null, children);
}

export interface ThemeToggleProps {
  className?: string;
  "data-testid"?: string;
}

/** Minimal light<->dark toggle button. Stable `data-testid`, accessible. Restyle via `className`. */
export function ThemeToggle({
  className,
  "data-testid": testId = "theme-toggle",
}: ThemeToggleProps): React.ReactElement {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme.startsWith("dark");
  return (
    <button
      type="button"
      data-testid={testId}
      className={className}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      aria-pressed={isDark}
      onClick={() => toggleTheme()}
    >
      {isDark ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}

function SunIcon(): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function MoonIcon(): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
