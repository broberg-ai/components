# @broberg/i18n

A **headless locale engine** — the same ~120-line i18n core that trail,
sanneandersen and xrt81 each hand-rolled, extracted once. Detect the locale,
persist it, resolve a dot-path key with a fallback chain + `{var}` interpolation,
and a `bilingual()` helper for `{da,en}` content objects. Framework-free,
SSR-safe, and pnpm-hoist-safe. The `LanguageSwitcher` widget stays copy-owned
per stack.

```bash
npm i @broberg/i18n
```

## Usage

```ts
import { createI18n } from "@broberg/i18n";

const i18n = createI18n({
  locales: ["da", "en"],                // first = default
  fallbackLocale: "en",                 // the complete base dict
  messages: {
    da: { greeting: "Hej", nav: { home: "Hjem" } },
    en: { greeting: "Hello", nav: { home: "Home" }, welcome: "Hi {name}" },
  },
  storageKey: "acme-locale",
});

i18n.getLocale();                        // "da" (stored > navigator.language > default)
i18n.t("nav.home");                      // "Hjem"
i18n.t("welcome", { name: "Sanne" });    // "Hi Sanne"  (falls back to en, interpolates)
i18n.setLocale("en");                    // persists, syncs <html lang>, notifies subscribers
i18n.bilingual({ da: "Goddag", en: "Good day" });   // active-locale string, plain-string tolerant

const off = i18n.subscribe((locale) => rerender());  // pub/sub, no context provider
```

## What it gets right

- **Fallback chain** — `t(key)` resolves the active locale, then the fallback
  locale, then returns the raw key (never a blank string).
- **`{var}` interpolation** — `t("welcome", { name })` fills placeholders.
- **`bilingual()`** — picks the active-locale field from a `{da,en}` object and
  tolerates a plain string, so LLM-generated bilingual content and legacy plain
  strings both work.
- **Detection** — stored locale → `navigator.language` exact-match →
  `navigator.language` prefix-match → default, all SSR-guarded. **Read the next
  section before you accept the default here** — it decides what language your
  product speaks.
- **pnpm-hoist safe** — a `globalThis`-keyed registry means two bundle copies
  with the same `storageKey` share one instance, so the active locale can never
  desync.

## Which detection default do you want?

`detect` is **`true` unless you set it to `false`**. The consequence, stated
plainly: **without `detect: false`, your product's language is decided by a
browser setting your user never touched.**

That is not the same sentence as "we detect the locale", and the difference is
the whole point. Nothing breaks, nothing errors, no test goes red — the engine
does exactly what it was configured to do, and the configuration was our
default.

What it looks like when it bites (a real one, fd-sundhed, August 2026): a
Danish-first product, `locales: ["da", "en"]`, no stored choice yet. A municipal
leader opens her first page mid-demo on a laptop with an `en-US` browser and
gets **the entire leader surface in English** — "For approval", "Awaiting your
decision". She had never chosen English. Nobody had. It took that team five
separate symptom-fixes across several weeks before anyone asked whether they
wanted the behaviour at all.

The opt-out is one line:

```ts
const i18n = createI18n({
  locales: ["da", "en"],
  fallbackLocale: "en",
  messages,
  detect: false,          // ← the product decides the language, not the browser
});
```

Pick deliberately:

| Your product | Set |
|---|---|
| One primary language, an explicit `fallbackLocale`, users who expect *your* language on first visit | **`detect: false`** — the common case |
| A genuinely multilingual audience with no single primary language, where meeting the user in their browser's language is the point | `detect: true` (today's default) |

Either way, an explicit `setLocale()` from a language switcher always wins and
is persisted — detection only ever decides the **first** render, before the user
has chosen.

## API

```ts
createI18n({ locales, defaultLocale?, fallbackLocale?, messages?, storageKey?, storage?, detect? }): I18n
// I18n: getLocale · setLocale · subscribe · t(key, vars?) · bilingual(text) · detectInitial · locales
```

Dictionaries stay **in your repo** (bundling them into the package would couple
every consumer's copy) — the package ships only the engine. React (Next
URL-prefix switch) and Preact (pub/sub) `LanguageSwitcher` adapters build on this
core.

## License

MIT · part of the [`@broberg/*`](https://discovery.broberg.ai) shared inventory.
