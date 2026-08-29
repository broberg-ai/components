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

### Responsive & touch tokens

The preset also ships **breakpoint** tokens (`--breakpoint-sm/md/lg/xl` =
640/768/1024/1280, in the `@theme` block so Tailwind v4's `sm:`/`md:`/… variants
resolve them) and a **touch-target** token (`--touch-target-min: 44px` in `:root`)
— one source, so every app switches layouts at the same widths and never ships a
sub-44px tap target:

```css
.btn { min-height: var(--touch-target-min); min-width: var(--touch-target-min); }
```

Read the same values in JS (e.g. for `matchMedia`) from the headless core:

```ts
import { BREAKPOINTS, TOUCH_TARGET_MIN } from "@broberg/theme";
if (matchMedia(`(min-width: ${BREAKPOINTS.md}px)`).matches) { /* tablet and up */ }
```

`BREAKPOINTS` and `--breakpoint-*` are the same numbers; the DESIGN.md generator
emits both from the `breakpoints:` / `touch:` token blocks.

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
| `BREAKPOINTS` | `{ sm:640, md:768, lg:1024, xl:1280 }` — responsive breakpoints (px) for `matchMedia`. |
| `TOUCH_TARGET_MIN` | `44` — minimum touch-target size (px). |

`InitThemeOptions`: `{ defaultTheme?, followSystem?, storageKey? }` (default key
`"broberg-theme"`).

## Notes

- **Stack target: Tailwind v4 only** — no v3 / legacy support by design.
- The headless core imports no framework packages (`tsc --noEmit` clean; no
  `next/*`, no React/Preact in `@broberg/theme`).
- Part of the [`broberg-ai/components`](../../docs/INVENTORY.md) monorepo (F001).

## DESIGN.md → Tailwind v4

```ts
import { designMdToTailwindV4, generateTailwindV4 } from "@broberg/theme/design-md";

const css = designMdToTailwindV4(designMd);                       // just the CSS
const { css, skipped } = generateTailwindV4(designMd);            // + what it could not convert
designMdToTailwindV4(designMd, { tailwindImport: false });        // your entry already imports Tailwind
designMdToTailwindV4(designMd, { selector: ".brand" });           // scope the raw tokens
```

**`skipped` is worth reading.** DESIGN.md files carry namespaces this generator
does not bridge — `shadow`, `motion`, `fontFamily`/`lineHeight`/`letterSpacing`
inside `typography`, and anything custom. They used to be discarded in silence;
one consumer lost 58 of 72 tokens through a build that reported success. Now each
one comes back by name with a reason. Print them, or fail your own build on them.

### 0.4.0 — the bridge no longer points at itself

If you generated CSS with 0.3.1 or earlier, **regenerate it.** Three of the four
bridged namespaces emitted the same name on both sides:

```css
:root       { --radius-lg: 12px; }
@theme inline { --radius-lg: var(--radius-lg); }   /* ← itself: no computed value */
```

Tailwind really does put that second line into its compiled `@layer theme`, so
the generator **replaced a working stock default** (`--radius-lg: 0.5rem`) with
something empty. Measured against tailwindcss 4.3.3.

With the default `selector: ":root"` it happened to work anyway — our own
unlayered `:root` block won, because unlayered CSS beats any layer. **The
correctness rested entirely on that.** Pass `selector: ".brand"` and there is no
unlayered `:root` left: outside `.brand`, every radius / spacing / text utility
resolved to nothing.

Colours were never affected, because their raw name differs from their theme name
(`--ivory` → `--color-ivory`). That asymmetry is why it survived review — the one
namespace you would spot-check by eye is the correct one.

**What changed:** the three colliding namespaces now carry their value into
`@theme`; only colours keep the `var()` indirection. Raw token names are
unchanged, so `var(--radius-lg)` in your own CSS still works. The cost of
inlining is that those utilities no longer follow the raw variable at runtime —
measured before accepting it: **zero** `data-theme` variants in
`css/neutral-preset.css` redefine a radius, spacing or text token. Only colours
vary per theme, and colours keep `var()`.

### 0.5.0 — the generator now refuses what it cannot emit

Until 0.5.0 it threw on missing YAML front matter and on **nothing else**, so
*"the generator ran"* and *"the generator checked nothing"* were the same
observation. Two things are now refused, with the token named:

```
colors.brand: "#ZZZZZZ"          → refused: not a colour
colors.a:     "{colors.missing}" → refused: references a token not defined here
```

The alias is the worse of the two. `{colors.missing}` is DESIGN.md's **own**
reference syntax naming a token that does not exist, and it used to land in your
CSS as the literal string `{colors.missing}` — which does not look like
corruption, it looks deliberate. Aliases are checked in **every** namespace, not
just colours.

**Lengths are deliberately NOT validated.** There is no reliable oracle: CSS
accepts `clamp()`, `calc()`, `min()`, a bare `var()`, and units a regex will not
know next year. A generator that refuses valid CSS is worse than one that passes
an odd string through — a refusal blocks your build, a passed-through string is
visible in the output and ignored by the browser. Colours are checked because
culori is a real oracle for them.

**`checkContrastAA` now names the token instead of crashing.** Given a colour it
cannot read it used to throw from inside culori — `TypeError: undefined is not an
object (evaluating 'c.r')` — so you got a third-party stack trace instead of
being told which of *your* tokens is unreadable. The WCAG checker is precisely
the tool whose failure has to be legible.

**Also fixed:** `DEFAULT` now maps to the bare namespace name. `rounded: { DEFAULT: "8px" }`
emits `--radius`, not `--radius-DEFAULT` — one consumer had 30 uses of
`border-radius: var(--radius)` with nothing behind them, and `vite build` said
nothing.
