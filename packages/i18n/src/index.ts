/**
 * @broberg/i18n — headless locale engine.
 *
 * The same ~120-line i18n core lives in trail, sanneandersen and xrt81 with an
 * identical contract: detect the locale, persist it, resolve a dot-path key with
 * a fallback chain + `{var}` interpolation, and a `bilingual()` helper for
 * `{da,en}` content objects. This is that engine, framework-free — the
 * `LanguageSwitcher` widget stays copy-owned per stack.
 *
 * SSR-safe (every DOM / storage access is guarded) and pnpm-hoist-safe (a
 * `globalThis`-keyed registry means duplicate bundle copies share one instance
 * per storage key, so a stray second copy can't desync the current locale).
 */

export type Dict = { [key: string]: string | Dict };
/** A `{ da: "…", en: "…" }` content object (LLM-friendly). */
export type BilingualText = Record<string, string>;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface I18nConfig {
  /** Supported locale codes. The first is the default. Single source of truth. */
  locales: string[];
  /** Default locale. Default: `locales[0]`. */
  defaultLocale?: string;
  /** Locale used when a key is missing in the active locale. Default: the default locale. */
  fallbackLocale?: string;
  /** locale code → (possibly nested) message dictionary. */
  messages?: Record<string, Dict>;
  /** localStorage key. Default `broberg-locale`. */
  storageKey?: string;
  /** Inject a storage backend. Default: global localStorage when usable. */
  storage?: StorageLike;
  /**
   * Detect from `navigator.language` when nothing is stored. Default **true**.
   *
   * Consequence, and it is easy to miss: leaving this on means **your product's
   * language is decided by a browser setting your user never touched**. Nothing
   * breaks and nothing errors — a Danish-first product opened on an `en-US`
   * browser simply renders entirely in English until the user picks a language.
   * If your product has one primary language and an explicit `fallbackLocale`,
   * you almost certainly want `detect: false`. See the README.
   */
  detect?: boolean;
  /**
   * F019.9 — start in this locale instead of detecting one. For a per-request
   * instance on the server, where the request (cookie, URL, header) decides.
   */
  locale?: string;
  /**
   * F019.9 — `false` returns a fresh, private instance instead of the shared
   * `globalThis` one. Use it on the SERVER: the shared instance is one locale
   * per process, so with concurrent requests one user's language leaks into
   * another user's page. Default `true` (the browser behaviour, unchanged).
   */
  singleton?: boolean;
}

export interface I18n {
  readonly locales: string[];
  getLocale(): string;
  setLocale(locale: string): void;
  subscribe(listener: (locale: string) => void): () => void;
  /** Resolve `key` (dot-path) in the active locale → fallback → raw key; interpolate `{var}`. */
  t(key: string, vars?: Record<string, string | number>): string;
  /** Pick the active-locale string from a `{da,en}` object; tolerates a plain string. */
  bilingual(text: BilingualText | string): string;
  /** stored locale → navigator.language prefix-match → default. */
  detectInitial(): string;
}

function safeStorage(injected?: StorageLike): StorageLike | null {
  if (injected) return injected;
  try {
    const s = (globalThis as unknown as { localStorage?: Partial<StorageLike> }).localStorage;
    if (s && typeof s.getItem === "function" && typeof s.setItem === "function") return s as StorageLike;
  } catch {
    /* privacy mode / no DOM */
  }
  return null;
}

function resolve(dict: Dict | undefined, path: string): string | Dict | undefined {
  if (!dict) return undefined;
  let node: string | Dict | undefined = dict;
  for (const part of path.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Dict)[part];
  }
  return node;
}

const PLURAL_CATEGORIES = new Set(["zero", "one", "two", "few", "many", "other"]);

/** A node is a plural entry when it has a string `other` and every key is a CLDR plural category. */
export function isPlural(node: string | Dict | undefined): node is Dict {
  return (
    typeof node === "object" &&
    node !== null &&
    typeof node.other === "string" &&
    Object.keys(node).every((k) => PLURAL_CATEGORIES.has(k))
  );
}

/**
 * The CLDR category for `count` in `locale`. `Intl.PluralRules` throws a
 * RangeError on a tag it rejects — and `en_US` (underscore) is a common app
 * convention — so the underscore form is normalised first, and a tag Intl still
 * rejects falls back to `other`. Translation must never take a page down: `t()`
 * did not throw before plurals existed, and it must not start now.
 */
function pluralCategory(locale: string, count: number): string {
  try {
    return new Intl.PluralRules(locale.replace(/_/g, "-")).select(count);
  } catch {
    return "other";
  }
}

/** Pick the string for `locale` from a node: a plain string, or a plural entry chosen by `count`. */
function pick(node: string | Dict | undefined, locale: string, count: unknown): string | undefined {
  if (typeof node === "string") return node;
  if (!isPlural(node)) return undefined;
  if (typeof count !== "number") return node.other as string;
  const form = node[pluralCategory(locale, count)];
  return typeof form === "string" ? form : (node.other as string);
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/**
 * F019.9 — translate without any state: no singleton, no `globalThis`, no
 * module variable. Safe on the server, where many requests in different
 * languages run at the same time — pass the request's locale every call.
 *
 * Resolves `key` (dot-path) in `locale`, then `fallbackLocale`, then returns
 * the raw key; interpolates `{var}`. A value may be a plural entry
 * `{ zero?, one?, two?, few?, many?, other }`, chosen with
 * `Intl.PluralRules(locale)` from `vars.count` (falls back to `other`).
 */
export function translate(
  messages: Record<string, Dict>,
  locale: string,
  key: string,
  vars?: Record<string, string | number>,
  opts?: { fallbackLocale?: string },
): string {
  const count = vars?.count;
  const own = pick(resolve(messages[locale], key), locale, count);
  if (own !== undefined) return interpolate(own, vars);
  const fb = opts?.fallbackLocale;
  const fallback = fb && fb !== locale ? pick(resolve(messages[fb], key), fb, count) : undefined;
  return interpolate(fallback ?? key, vars);
}

/**
 * F019.10 — every dot-path in `base` that `target` lacks. A plural entry
 * (`{ one?, …, other }`) counts as one key: missing when the target has no
 * entry at that path, or one without `other`. Pure; meant for a CI test
 * ("no missing keys in en") and as the input to `fillMissing`.
 */
export function missingKeys(base: Dict, target: Dict | undefined): string[] {
  const out: string[] = [];
  const walk = (b: Dict, t: Dict | undefined, prefix: string) => {
    for (const [k, v] of Object.entries(b)) {
      const path = prefix ? `${prefix}.${k}` : k;
      const tv = t && typeof t === "object" ? t[k] : undefined;
      if (typeof v === "string") {
        if (typeof tv !== "string") out.push(path);
      } else if (isPlural(v)) {
        if (!isPlural(tv)) out.push(path);
      } else {
        walk(v, typeof tv === "object" ? tv : undefined, path);
      }
    }
  };
  walk(base, target, "");
  return out;
}

const REGISTRY_KEY = "__broberg_i18n__";

function buildI18n(config: I18nConfig): I18n {
  if (!config?.locales?.length) throw new Error("createI18n: `locales` must be a non-empty array");
  const locales = config.locales;
  const defaultLocale = config.defaultLocale ?? locales[0];
  const fallbackLocale = config.fallbackLocale ?? defaultLocale;
  const messages = config.messages ?? {};
  const storageKey = config.storageKey ?? "broberg-locale";
  const storage = safeStorage(config.storage);
  const detect = config.detect !== false;
  const listeners = new Set<(l: string) => void>();

  function syncHtmlLang(locale: string): void {
    const doc = (globalThis as unknown as { document?: { documentElement?: { lang: string } } }).document;
    if (doc?.documentElement) doc.documentElement.lang = locale;
  }

  function detectInitial(): string {
    const stored = storage?.getItem(storageKey);
    if (stored && locales.includes(stored)) return stored;
    if (detect) {
      const nav = (globalThis as unknown as { navigator?: { language?: string } }).navigator;
      const lang = nav?.language;
      if (lang) {
        const exact = locales.find((l) => l.toLowerCase() === lang.toLowerCase());
        if (exact) return exact;
        const prefix = lang.split("-")[0].toLowerCase();
        const byPrefix = locales.find((l) => l.split("-")[0].toLowerCase() === prefix);
        if (byPrefix) return byPrefix;
      }
    }
    return defaultLocale;
  }

  let current = config.locale && locales.includes(config.locale) ? config.locale : detectInitial();
  syncHtmlLang(current);

  return {
    locales,
    getLocale: () => current,
    setLocale(locale: string) {
      if (!locales.includes(locale)) return;
      current = locale;
      storage?.setItem(storageKey, locale);
      syncHtmlLang(locale);
      for (const l of listeners) l(locale);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    t(key: string, vars?: Record<string, string | number>) {
      return translate(messages, current, key, vars, { fallbackLocale });
    },
    bilingual(text: BilingualText | string) {
      if (typeof text === "string") return text;
      if (!text || typeof text !== "object") return "";
      return text[current] ?? text[fallbackLocale] ?? Object.values(text)[0] ?? "";
    },
    detectInitial,
  };
}

/**
 * Create (or return the existing) i18n engine for a storage key. Two calls with
 * the same `storageKey` return the same instance — even across duplicate bundle
 * copies — so the active locale can never desync under pnpm hoisting.
 */
export function createI18n(config: I18nConfig): I18n {
  if (config.singleton === false) return buildI18n(config);
  const key = config.storageKey ?? "broberg-locale";
  const g = globalThis as unknown as { [REGISTRY_KEY]?: Map<string, I18n> };
  const registry = (g[REGISTRY_KEY] ??= new Map<string, I18n>());
  const existing = registry.get(key);
  if (existing) return existing;
  const instance = buildI18n(config);
  registry.set(key, instance);
  return instance;
}

/** Clear the global registry — for tests that need a fresh instance per case. */
export function __resetI18nRegistry(): void {
  const g = globalThis as unknown as { [REGISTRY_KEY]?: Map<string, I18n> };
  g[REGISTRY_KEY]?.clear();
}
