/**
 * @broberg/consent-cookie — headless GDPR consent core.
 *
 * The banner/modal UI is copy-owned per brand (each product owns its policy
 * text, categories and tokens), but the *logic* — what counts as valid consent,
 * when to re-surface on a policy change, essential-always-on, the right-to-
 * withdraw — is easy to get subtly wrong. That correct, testable state machine
 * lives here, framework-free. SSR-safe: every localStorage access is guarded.
 */

export interface ConsentCategory {
  key: string;
  label: string;
  description: string;
  /** Essential categories are always granted and cannot be toggled off. */
  essential?: boolean;
}

/** Default categories. Override via `createConsentManager({ categories })`. */
export const CONSENT_CATEGORIES: ConsentCategory[] = [
  { key: "essential", label: "Essential", description: "Required for the site to function.", essential: true },
  { key: "analytics", label: "Analytics", description: "Helps us understand how the site is used." },
  { key: "marketing", label: "Marketing", description: "Personalised content and advertising." },
];

export interface ConsentRecord {
  /** The policy version the user consented to. */
  policyVersion: string;
  /** ISO timestamp of the decision. */
  acceptedAt: string;
  /** category key → granted. Essential is always `true`. */
  categories: Record<string, boolean>;
}

/** Pluggable persistence. Implement this to store consent server-side. */
export interface ConsentStorage {
  get(): ConsentRecord | null;
  set(record: ConsentRecord): void;
  clear(): void;
}

/**
 * localStorage-backed storage. SSR-safe: with no `localStorage` (server) it
 * degrades to an in-memory store rather than throwing, so a component can
 * construct it during render.
 */
export function createLocalStorageConsentStorage(key: string): ConsentStorage {
  const ls = (() => {
    try {
      const s = (globalThis as unknown as { localStorage?: Storage }).localStorage;
      if (s && typeof s.getItem === "function" && typeof s.setItem === "function") return s;
    } catch {
      /* privacy mode / no DOM */
    }
    return null;
  })();
  if (!ls) return createMemoryConsentStorage();
  return {
    get() {
      try {
        const raw = ls.getItem(key);
        return raw ? (JSON.parse(raw) as ConsentRecord) : null;
      } catch {
        return null;
      }
    },
    set(record) {
      try {
        ls.setItem(key, JSON.stringify(record));
      } catch {
        /* quota / privacy mode — consent just won't persist */
      }
    },
    clear() {
      try {
        ls.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}

/** In-memory storage (SSR, tests, or an ephemeral session). */
export function createMemoryConsentStorage(): ConsentStorage {
  let record: ConsentRecord | null = null;
  return {
    get: () => record,
    set: (r) => {
      record = r;
    },
    clear: () => {
      record = null;
    },
  };
}

export interface ConsentManagerOptions {
  /** Current policy version. When it changes, the banner re-surfaces. Required. */
  policyVersion: string;
  /** Category definitions. Default `CONSENT_CATEGORIES`. */
  categories?: ConsentCategory[];
  /** Storage backend. Default: localStorage under `storageKey` (or memory if absent). */
  storage?: ConsentStorage;
  /** localStorage key when no explicit `storage` is given. Default `broberg-consent`. */
  storageKey?: string;
}

export interface ConsentManager {
  readonly categories: ConsentCategory[];
  /** The stored record, or null. */
  getRecord(): ConsentRecord | null;
  /** True when there's no valid, current-version consent → show the banner. */
  needsBanner(): boolean;
  /** True when a record exists but its policy version differs from the current one. */
  isOutdated(): boolean;
  /** Is a category currently granted? Essential is always true. */
  has(category: string): boolean;
  /** Grant every category. */
  acceptAll(): ConsentRecord;
  /** Grant only essential categories. */
  rejectAll(): ConsentRecord;
  /** Set a partial selection (essential forced on, unlisted default off). */
  setConsent(selection: Record<string, boolean>): ConsentRecord;
  /** GDPR right to withdraw — clears the record so the banner returns. */
  withdraw(): void;
  /** Subscribe to changes. Returns an unsubscribe fn. */
  subscribe(listener: (record: ConsentRecord | null) => void): () => void;
}

const DEFAULT_KEY = "broberg-consent";

export function createConsentManager(options: ConsentManagerOptions): ConsentManager {
  if (!options?.policyVersion) throw new Error("createConsentManager: `policyVersion` is required");
  const categories = options.categories ?? CONSENT_CATEGORIES;
  const storage = options.storage ?? createLocalStorageConsentStorage(options.storageKey ?? DEFAULT_KEY);
  const version = options.policyVersion;
  const listeners = new Set<(r: ConsentRecord | null) => void>();

  const isEssential = (key: string): boolean => categories.some((c) => c.key === key && c.essential);

  function normalize(selection: Record<string, boolean>): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    for (const c of categories) out[c.key] = c.essential ? true : selection[c.key] === true;
    return out;
  }

  function nowIso(): string {
    return new Date().toISOString();
  }

  function commit(categoriesRecord: Record<string, boolean>): ConsentRecord {
    const record: ConsentRecord = { policyVersion: version, acceptedAt: nowIso(), categories: categoriesRecord };
    storage.set(record);
    for (const l of listeners) l(record);
    return record;
  }

  return {
    categories,
    getRecord: () => storage.get(),
    isOutdated() {
      const r = storage.get();
      // No version (legacy record) or a differing version = outdated.
      return r != null && r.policyVersion !== version;
    },
    needsBanner() {
      const r = storage.get();
      return r == null || !r.policyVersion || r.policyVersion !== version;
    },
    has(category: string) {
      if (isEssential(category)) return true;
      return storage.get()?.categories[category] === true;
    },
    acceptAll() {
      const all: Record<string, boolean> = {};
      for (const c of categories) all[c.key] = true;
      return commit(all);
    },
    rejectAll() {
      return commit(normalize({}));
    },
    setConsent(selection) {
      return commit(normalize(selection));
    },
    withdraw() {
      storage.clear();
      for (const l of listeners) l(null);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
