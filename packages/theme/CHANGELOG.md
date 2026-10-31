# @broberg/theme — changelog

One entry per version, newest first. Each is marked:

- **BREAKING** — code that worked before can fail or behave differently. Read the "do" line.
- **OUTPUT CHANGED** — the API is the same, but what lands on the page or in the generated CSS is different.
- **ADDITIVE** — new things only; existing output is byte-for-byte the same.

Coming from 0.3.1? Read every BREAKING and OUTPUT CHANGED entry between your version and the one you install. The README has the long form for 0.7.0 onwards.

## 0.14.0 — the DESIGN.md round-trip you can actually perform (F001.15)

ADDITIVE. New `serialiseDesignMd(tokens, body?)` on `./design-md` — the inverse of `parseDesignMd`. `generateTailwindV4` / `designMdToTailwindV4` now also accept `DesignTokens` directly; a markdown string gives exactly the same output as in 0.13.3.
Do: nothing. If you hand-roll YAML to feed the generator (cardmem's `buildSeed`), you can drop it.

## 0.13.3 — this changelog (F001.26)

ADDITIVE. `CHANGELOG.md` ships in the package. No code change.

## 0.13.2 — a chosen Ember is remembered (F001.24) · 89521e7

**OUTPUT CHANGED.** `setPalette("classic")` now stores `"classic"` instead of deleting the key, so «chose Ember» can be told from «chose nothing». An app that applies its own brand palette when nothing is stored no longer overrides a user's Ember on reload. The attribute is unchanged (classic = no `data-palette`).
Do: nothing. One-time effect: a user who chose Ember before 0.13.2 has no stored key and gets the app's default once.

## 0.13.1 — never published

Tagged, refused by the publish gate (its mutation suite still expected the old behaviour). 0.13.2 is the same change.

## 0.13.0 — Layered is the default (F001.23) · 6fe2a0c

**OUTPUT CHANGED.** With no stored choice, surfaces are `layered` (`initPalette`, `getSurfaces`, `prePaintScript({ surfacesKey })` alike) and `<html data-surfaces="layered">` is set from the first paint. Flat is now stored as `"flat"`.
Do: a test that asserts `initPalette()` with strict equality and nothing stored now gets `surfaces: "layered"`. One-time effect: a user who chose Flat before 0.13.0 sees Layered once.

## 0.12.0 — brand accent from one hex (F001.20) · e49c1a3

ADDITIVE. `setAccent(hex)` sets `--accent`, `--accent-fg`, `--accent-soft` on `<html>` (`setAccent(null)` goes back to the palette's own); `prePaintScript({ accent })`, `accentTokens(hex)`. A palette is a surface tone, the accent is the brand.

## 0.11.0 — the neuron backdrop, one copy (F001.19) · 8670bdc

ADDITIVE, one shape change. `@broberg/theme/constellation` (`mountConstellation`) and the backdrop axis (`setBackdrop("neurons" | "plain")`, `initPalette({ backdropKey })`, `prePaintScript({ backdropKey })`).
Do: `initPalette()` now also returns `backdrop` — a test asserting the whole object with strict equality needs `backdrop: "neurons"` added.

## 0.10.0 — the palette axis (F001.18) · aefd44a

ADDITIVE. `data-palette` (`classic` Ember · `cool` Graphite · `warm` Sandstone · `broberg` Fjord) × light/dark, and `data-surfaces` (flat/layered), from one source for cardmem, helpdesk and trail. `initPalette`, `setPalette`, `setSurfaces`, `prePaintScript({ paletteKey, surfacesKey })`, `css/palettes.css`.

## 0.9.0 — the broberg.ai palette (F001.17) · 21a2682

ADDITIVE. Theme keys `dark-broberg` / `light-broberg`.

## 0.8.0 — the pre-paint snippet ships with the package (F084.24) · c8b8bab

ADDITIVE. `prePaintScript({ storageKey?, defaultPreference? })` builds the inline `<head>` script from the package's own constants, so an app stops hand-writing seven lines that drift from the module (no white flash for a dark-theme user).
Do: if you hand-wrote that snippet, replace it — your copy and the module can disagree about the fallback.

## 0.7.0 — "system" is a preference, not a theme (F001.16) · d13a96b

ADDITIVE. `setPreference("light" | "dark" | "system")`, `getPreference()`, `initTheme({ defaultPreference })`, and an OS listener that stays attached. `getTheme()` still returns only a theme key. `followSystem` still works (deprecated in its doc comment). A stored `"system"` read by 0.6.0 falls back to that copy's default — two versions can coexist during a rollout.

## 0.6.0 — CSS → DESIGN.md, and aliases are substituted (F001.13 / F001.14) · a33dec8

**OUTPUT CHANGED** for the generator. An alias like `{colors.primary}` in DESIGN.md is now replaced by its value in the generated CSS (it was validated but left as the literal string). New: CSS → DESIGN.md extraction (`{ tokens, skipped, renamed }`), so a repo with an existing look can seed its DESIGN.md.
Do: regenerate your CSS and diff it.

## 0.5.0 — the generator checks what it is given (F001.12) · 55a29af

**BREAKING** for the DESIGN.md generator. `designMdToTailwindV4` now throws on an invalid colour (e.g. `#ZZZZZZ`) and on an alias that names a token that does not exist — it used to write them into the CSS as-is. `checkContrastAA` names the unreadable token instead of crashing inside culori. Lengths are deliberately not validated.
Do: if your build regenerates CSS from DESIGN.md, run it once; fix any token it now names.

## 0.4.0 — the @theme bridge no longer points at itself (F001.11) · a15fdd3, 8bad1d5

**OUTPUT CHANGED** for the generator. The `@theme` block no longer emits self-references like `--radius-lg: var(--radius-lg)`, which replaced Tailwind's working defaults with nothing (invisible with the default selector, broken with `selector: ".brand"`). `./package.json` is now exported, so `require("@broberg/theme/package.json")` tells you the installed version instead of throwing.
Do: regenerate your CSS.

## 0.3.1 — repository field · 56b8f69

No code change (npm provenance needs the repository field).

## 0.3.0 — breakpoint + touch-target tokens (F001.9) · 62d9023

ADDITIVE. Breakpoint and touch-target tokens in the baseline.

## 0.2.0 — DESIGN.md → Tailwind v4 generator (F001.8) · fceebab

ADDITIVE. `designMdToTailwindV4` and the `bin` that runs it.

## 0.1.0 — first release · f1fb247

ADDITIVE (first release). Headless theme store (`initTheme`, `setTheme`, `getTheme`, `toggleTheme`, `onThemeChange`), the neutral Tailwind v4 CSS baseline, React and Preact adapters.
