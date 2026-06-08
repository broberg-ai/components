# @broberg/theme

The single source of truth for how every app in the broberg.ai estate **looks** —
a framework-agnostic theme store plus a neutral shadcn/ui-compatible CSS token
baseline. Flip light / dark / warm / cool the same way everywhere; rebrand from
one place.

> **Two halves, one package** — adopt as much as your stack supports:
> 1. **JS theme store** (this npm package) — sets `data-theme` on `<html>`,
>    persists to `localStorage`, notifies subscribers. Works in **any** app
>    (React, Preact, vanilla; Tailwind or not). SSR-safe.
> 2. **CSS token baseline** (`css/neutral-preset.css`) — **copy-owned**. Requires
>    **Tailwind v4** (it uses `@theme`, which cannot be `@import`ed from
>    node_modules). Non-Tailwind apps use the raw CSS variables directly.

## Install

```bash
npm i @broberg/theme        # or pnpm / bun add
```

## 1. The CSS baseline (Tailwind v4)

Copy `node_modules/@broberg/theme/css/neutral-preset.css` into your app's CSS
entry (e.g. `globals.css`). It ships the neutral token vocabulary, dark-first,
with six named `data-theme` variants (`light`, `dark`, `light-cool`,
`light-warm`, `dark-cool`, `dark-warm`) and the `@theme inline` bridge.

### Brand override pattern

Override only what makes you *you* — `--primary`, `--ring`, `--radius` — in
`:root` (and `[data-theme="light"]` if your brand color differs per mode):

```css
:root {
  --primary:    oklch(0.82 0.17 85);  /* your brand color */
  --ring:       oklch(0.82 0.17 85);
  --radius:     0.625rem;
}
```

Everything else inherits the neutral baseline, so a new app is on-brand,
accessible and dark-mode-ready in three lines.

## 2. The theme store

### React / Next.js (Stack A)

```tsx
import { ThemeProvider, useTheme, ThemeToggle } from "@broberg/theme/react";

// app root
<ThemeProvider defaultTheme="dark" followSystem>
  {children}
</ThemeProvider>

// anywhere
const { theme, setTheme, toggleTheme, themes } = useTheme();
<ThemeToggle />               // minimal light<->dark button, data-testid="theme-toggle"
```

`useTheme` subscribes via `useSyncExternalStore` — no `next-themes` dependency,
SSR-safe. The full Sun/Moon/Monitor dropdown is **copy-owned** per app (build it
from your own design-system components; `ThemeToggle` is a drop-in starter).

### Preact / Bun (Stack B)

```ts
import { initTheme } from "@broberg/theme/preact";   // call once in your entry
import { useTheme } from "@broberg/theme/preact";

initTheme({ defaultTheme: "dark", followSystem: true });
const { theme, setTheme, toggleTheme } = useTheme();
```

### Vanilla / no framework

```ts
import { initTheme, setTheme, toggleTheme, onThemeChange } from "@broberg/theme";
initTheme();
setTheme("dark-warm");
```

## API

| Export | Description |
|---|---|
| `initTheme(opts?)` | Resolve (stored › system › default), apply to `<html>`, return the key. |
| `getTheme()` | Current `ThemeKey`. |
| `setTheme(key)` | Apply + persist + notify. No-op on invalid keys. |
| `toggleTheme()` | Cycle light ⇄ dark (variants collapse to their base mode). |
| `onThemeChange(fn)` | Subscribe; returns an unsubscribe. |
| `THEME_KEYS` | All six `ThemeKey`s. |

`InitThemeOptions`: `{ defaultTheme?, followSystem?, storageKey? }` (default key
`"broberg-theme"`).

## Notes

- **Stack target: Tailwind v4 only** — no v3 / legacy support by design.
- The headless core imports no framework packages (`tsc --noEmit` clean; no
  `next/*`, no React/Preact in `@broberg/theme`).
- Part of the [`broberg-ai/components`](../../docs/INVENTORY.md) monorepo (F001).
