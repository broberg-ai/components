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
  /** Detect from `navigator.language` when nothing is stored. Default true. */
  detect?: boolean;
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

function lookup(dict: Dict | undefined, path: string): string | undefined {
  if (!dict) return undefined;
  let node: string | Dict | undefined = dict;
  for (const part of path.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Dict)[part];
  }
  return typeof node === "string" ? node : undefined;
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
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

  let current = detectInitial();
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
      const hit = lookup(messages[current], key) ?? lookup(messages[fallbackLocale], key);
      return interpolate(hit ?? key, vars);
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
