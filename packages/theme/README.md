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

## 0.13.1 — a chosen Ember is remembered (F001.24)

`setPalette("classic")` now STORES `"classic"` (it used to delete the key), so
«chose Ember» can be told from «chose nothing». An app that applies its brand
palette only when nothing is stored (appkit) no longer overrides a user's Ember
on reload. The attribute is unchanged (classic = no `data-palette`). One-time:
a user who chose Ember before has no key and gets the app's default once.

## 0.13.0 — Layered is the default (F001.23)

Christian 10/10: «Lag skal altid være default».

- **No stored choice → `layered`**, in `initPalette()`, `getSurfaces()` and
  `prePaintScript({ surfacesKey })` alike. `<html data-surfaces="layered">` is
  set from the first paint.
- **Flat is now stored as `"flat"`** (it used to delete the key), so a user who
  picks Flat keeps it after a reload. Only a stored `"flat"` reads as flat.
- **One-time switch, by design:** before 0.13.0 «Flat» and «never chose» were the
  same empty key, so a user who chose Flat earlier sees Layered once after the
  bump. There is no way to tell them apart.
- The attribute and CSS are unchanged (`layered` or absent). A test asserting
  `initPalette()` with strict equality and nothing stored now gets
  `surfaces: "layered"`.

## 0.12.0 — a brand accent: the app's own colour from one hex (F001.20)

A palette is a **surface tone**, not a brand: `classic`, `cool` and `warm` share one
`--accent`. Measured by appkit: two customers on two palettes got the same orange
buttons. A brand is now three lines — name, logo, and:

```ts
import { setAccent, prePaintScript } from "@broberg/theme";

setAccent("#2E7D32");          // --accent, --accent-fg, --accent-soft on <html>
setAccent(null);               // back to the palette's own accent
// <head>, so the first paint already has it:
prePaintScript({ defaultPreference: "system", accent: "#2E7D32" });
```

- `--accent-fg` is dark ink or white, whichever gives the higher contrast — and
  always ≥ 4.5:1 (black is the floor for a mid-tone where neither reaches it).
- Written as inline properties on `<html>`, so a palette or theme switch never
  wipes it. Same colour in light and dark (v1).
- Only `#rgb` / `#rrggbb`. Anything else is refused: `setAccent` returns `false`
  and writes nothing; `prePaintScript` emits nothing for it.
- `accentTokens(hex)` gives you the three values without touching the page (for a
  mail template, say).
- Not persisted on purpose: the app sets its brand, the end user does not choose it.

## 0.11.0 — the neuron backdrop, one copy (F001.19)

The drifting neuron constellation behind cardmem and trail is now
`@broberg/theme/constellation`, so helpdesk and the trail app get it without a
fourth copy. Colours come from `--graph-*` in `palettes.css`, so it follows the
palette.

```ts
import { mountConstellation } from "@broberg/theme/constellation";
const dispose = mountConstellation(document.querySelector("#backdrop")!); // canvas: fixed, inset 0, pointer-events none, behind content
```

- One loop at a time: mounting again disposes the previous one (safe under HMR).
- Paused while the tab is hidden. `prefers-reduced-motion`: one still frame,
  repainted on resize and when a hidden tab becomes visible (cardmem's copy went
  blank in both cases).
- **Backdrop axis** beside palette and surfaces: `setBackdrop("plain" | "neurons")`,
  `getBackdrop`, `onBackdropChange`, `initPalette({ backdropKey })`,
  `prePaintScript({ backdropKey })`. `plain` = `<html data-backdrop="plain">`:
  nothing is drawn and `palettes.css` hides the canvas. cardmem passes
  `backdropKey: "cardmem.backdrop"`.
- `initPalette()` now also returns `backdrop`. Code that destructures only
  `palette`/`surfaces` is unaffected; a test asserting the whole object with
  strict equality needs `backdrop: "neurons"` added.

## 0.10.0 — the palette axis: cardmem's colour choices, from one source (F001.18)

cardmem, helpdesk and the trail app offer the same three choices. They now come
from this package instead of three copies:

| axis | attribute on `<html>` | values (stored id → label) |
|---|---|---|
| Theme | `data-theme` | `light` · `dark` (+ `system` as a preference) |
| Palette | `data-palette` | none = `classic` **Ember** · `cool` **Graphite** · `warm` **Sandstone** · `broberg` **Fjord** |
| Surfaces | `data-surfaces` | none = `flat` · `layered` (the default since 0.13.0) |

**CSS** — plain, so it imports straight from node_modules:

```css
@import "@broberg/theme/css/palettes.css";
/* then map your own names, never copy values: */
:root { --color-bg: var(--bg); --color-fg: var(--fg); /* … */ }
```

It carries the classic base (light + dark) for the shared set — every token a
palette overrides, the status families (clay, olive, amber, sky, danger,
success), graph-* and what they reference: 54 variables — then the three
palettes × light/dark, then the surfaces. Values are cardmem's (origin/main
433e7e27), held to them by `test/palettes.test.ts`, which also re-measures
contrast for every palette × scheme (ported from cardmem's own test).

**JS** — beside the theme store:

```ts
import { initPalette, setPalette, setSurfaces, PALETTES, PALETTE_LABELS, prePaintScript } from "@broberg/theme";

initPalette({ paletteKey: "cardmem.palette", surfacesKey: "cardmem.surfaces" }); // your existing keys: nobody loses a choice
setPalette("broberg");      // classic removes the attribute, stores "classic"
setSurfaces("flat");        // removes the attribute, stores "flat" (layered is the default)
// <head>, before the bundle — same keys:
prePaintScript({ storageKey: "cardmem.theme-pref", paletteKey: "cardmem.palette", surfacesKey: "cardmem.surfaces" });
```

Show `PALETTE_LABELS`, store the ids: renaming a label must never reset anyone's choice.

**Call `initPalette()` FIRST, at module load, with your keys.** The keys live in
the module: `setPalette` / `setSurfaces` / `setBackdrop` called before
`initPalette({ …Key })` write under the DEFAULT keys (`broberg-palette`,
`broberg-surfaces`, `broberg-backdrop`), and a consumer with its own keys then
loses that choice on reload. Found by cardmem on 0.11.0 (3 Oct 2026).

Two more from cardmem's migration (3 Oct 2026):

- **The palette axis only knows `data-theme` = `light` / `dark`.** `initTheme` and
  `prePaintScript` still accept every `THEME_KEYS` value from storage, so a stale
  `dark-cool` from the older vocabulary would land on `<html>` and match none of
  `palettes.css`. An app that offers only Light · Dark · System should reset
  anything else at boot.
- **For test authors:** with "system", the OS is asked via
  `matchMedia("(prefers-color-scheme: light)")`. A stub that answers `false` to
  everything therefore resolves to **dark**. Stub the light query explicitly.

**Two vocabularies, pick one.** The palette axis uses cardmem's names (`--bg`,
`--fg-muted`, `--gray-*` …) with `data-theme` = `light`/`dark`. The older
`light-cool` / `dark-warm` / `dark-broberg` themes in `neutral-preset.css` use
shadcn names and stay unchanged for the apps that use them. An app uses one or
the other, not both. Backdrop (neurons/plain) is app graphics, not tokens, and
stays in the app. Without the new options `prePaintScript` is unchanged.

## 0.9.0 — the broberg.ai palette (F001.17)

Two new themes, `dark-broberg` and `light-broberg`: the house palette that
broberg.ai and BID use, now in ONE place instead of copied per app. Values are
BID's house tokens (`broberg-id/ui/src/app.css`), held to them value-by-value
by `test/broberg-palette.test.ts`.

```ts
setTheme("dark-broberg");   // or "light-broberg"
```

**The brand orange is `--brand-accent` (a fill) and `--brand-accent-text`
(readable text) — not `--accent`.** In this vocabulary `--accent` is the HOVER
surface of menu rows; mapping the orange there would paint every hovered row
orange. Both are set only in the two broberg themes.

Fonts are not included: DM Sans / DM Serif Display are self-hosted per app (no
Google Fonts request, so no visitor IP leaves for Google). Copy the two new
blocks from `css/neutral-preset.css` into your app's CSS like the rest of the
preset.

**`ThemeKey` grew by two.** Reading it is unaffected; an exhaustive `switch`
over `ThemeKey` stops compiling until it handles the new keys.

## 0.7.0 — "system" is a preference, not a theme (F001.16)

Before this, `followSystem` was in force **only until the first click**: a stored
value won forever, there was no way to *say* "system", and nothing listened — so
an OS that flipped while the app was open changed nothing.

```ts
setPreference("system");   // follows the OS, and KEEPS following it
getPreference();           // "system" — the CHOICE
getTheme();                // "light" | "dark" | … — the RESOLVED key on <html>
```

**`getTheme()` still returns only a `ThemeKey`.** Putting `"system"` into
`THEME_KEYS` would have made the value every consumer paints from able to hold
something that is not a palette.

`preference` is `ThemeKey | "system"`, so a consumer on `light-warm` keeps it.

**Additive — nothing you have needs to change.** `followSystem` behaves exactly
as before; it is deprecated only in its doc comment, in favour of
`defaultPreference: "system"`, which keeps following instead of reading once.

**Rolling out across several apps?** A stored `"system"` read by **0.6.0** fails
that version's `isThemeKey` check, so the older copy falls back to its default
rather than throwing. Two versions coexist safely; the older one simply does not
follow the OS.

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
| `THEME_KEYS` | All eight `ThemeKey`s (six neutral + `light-broberg`, `dark-broberg`). |
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

### 0.6.0 — an alias is SUBSTITUTED, and CSS → DESIGN.md arrives

**⚠️ BREAKING for input that used to reach your CSS.** Stated first because it is
the part a release note usually buries. Measured on both versions:

| input | 0.5.0 | 0.6.0 |
|---|---|---|
| `a: "{colors.ink}"` (valid) | emitted `--a: {colors.ink};` | emitted `--a: #101010;` |
| `a: "{colors.a}"` (self-reference) | **emitted `--a: {colors.a};`** | **THROWS** — alias cycle |
| `a: "{colors.b}"`, `b: "{colors.a}"` | **emitted `--a: {colors.b};`** | **THROWS** — alias cycle |

So a build that used to succeed on a circular alias now fails. That is the point
— the CSS it produced was a literal brace string no browser reads — but it is a
*behaviour* change, not only a better error, and a consumer asserting on the old
message or the old output will go red.

Reported by cardmem, whose suite went 0 → 14 red on the upgrade (one real, the
rest teardown fallout). **I had written "a cycle is refused by name", which is
true and is not the same claim as "a cycle that previously got through".** Their
distinction, and it is the one a consumer needs.

**Aliases now resolve.** `{namespace.name}` is substituted with the value it
names, transitively. Validation runs on the *resolved* value, so an alias
pointing at something that is not a colour is refused by name rather than
emitted. `checkContrastAA` measures the resolved colour — until 0.6.0 a *valid*
alias made it throw culori's `TypeError` from inside a dependency.

**`designTokensFromCss(css)`** reads an existing stylesheet the other way, and
returns `{ tokens, skipped, renamed }` — never a bare token object. The reverse
direction is a heuristic (which of hundreds of declarations are *tokens* is a
judgement), so it reports what it could not read, and what it extracted under a
name that would change if you regenerated. Lifted from the pure function cardmem
wrote for it.

> **It does NOT feed straight back into `generateTailwindV4`.** That function
> takes the markdown string; `generateTailwindV4(tokens)` throws. A serialiser
> is F001.15. An earlier version of this README's sibling comment claimed
> otherwise, and cardmem caught it by measuring the tarball.

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
