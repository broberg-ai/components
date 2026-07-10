import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createI18n, __resetI18nRegistry, type StorageLike } from "../src/index.js";

function memStorage(): StorageLike {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

const messages = {
  en: { greeting: "Hello", nav: { home: "Home" }, welcome: "Hi {name}" },
  da: { greeting: "Hej", nav: { home: "Hjem" } }, // no `welcome` → falls back to en
};

let store: StorageLike;
beforeEach(() => {
  __resetI18nRegistry();
  store = memStorage();
});
afterEach(() => {
  delete (globalThis as unknown as { navigator?: unknown }).navigator;
});

function i18n(extra = {}) {
  // en is the complete base dict → use it as the fallback locale.
  return createI18n({ locales: ["da", "en"], messages, storage: store, detect: false, fallbackLocale: "en", ...extra });
}

describe("t() — lookup + fallback + interpolation", () => {
  it("resolves a top-level key in the active locale", () => {
    const t = i18n();
    expect(t.getLocale()).toBe("da");
    expect(t.t("greeting")).toBe("Hej");
  });

  it("resolves a dot-path key", () => {
    expect(i18n().t("nav.home")).toBe("Hjem");
  });

  it("falls back to the fallback locale when a key is missing", () => {
    expect(i18n().t("welcome", { name: "Sanne" })).toBe("Hi Sanne"); // only in en
  });

  it("interpolates {var} placeholders", () => {
    const t = i18n();
    t.setLocale("en");
    expect(t.t("welcome", { name: "Chris" })).toBe("Hi Chris");
  });

  it("returns the raw key as a last resort", () => {
    expect(i18n().t("does.not.exist")).toBe("does.not.exist");
  });
});

describe("setLocale + subscribe", () => {
  it("switches locale, persists it, and notifies subscribers", () => {
    const t = i18n();
    const seen: string[] = [];
    const off = t.subscribe((l) => seen.push(l));
    t.setLocale("en");
    expect(t.getLocale()).toBe("en");
    expect(t.t("greeting")).toBe("Hello");
    expect(store.getItem("broberg-locale")).toBe("en");
    expect(seen).toEqual(["en"]);
    off();
    t.setLocale("da");
    expect(seen).toEqual(["en"]); // no more after unsubscribe
  });

  it("ignores an unsupported locale", () => {
    const t = i18n();
    t.setLocale("fr");
    expect(t.getLocale()).toBe("da");
  });
});

describe("bilingual()", () => {
  it("picks the active-locale value from a {da,en} object", () => {
    const t = i18n();
    expect(t.bilingual({ da: "Goddag", en: "Good day" })).toBe("Goddag");
    t.setLocale("en");
    expect(t.bilingual({ da: "Goddag", en: "Good day" })).toBe("Good day");
  });

  it("tolerates a plain string (legacy content)", () => {
    expect(i18n().bilingual("already a string")).toBe("already a string");
  });

  it("falls back to the fallback locale, then any value", () => {
    const t = i18n();
    t.setLocale("en");
    expect(t.bilingual({ da: "kun dansk" })).toBe("kun dansk"); // en missing → first value
  });
});

describe("detectInitial", () => {
  it("prefers a stored locale", () => {
    store.setItem("broberg-locale", "en");
    expect(createI18n({ locales: ["da", "en"], messages, storage: store }).getLocale()).toBe("en");
  });

  it("prefix-matches navigator.language when nothing is stored", () => {
    (globalThis as unknown as { navigator: { language: string } }).navigator = { language: "en-GB" };
    const t = createI18n({ locales: ["da", "en"], messages, storage: store, detect: true, storageKey: "nav-test" });
    expect(t.getLocale()).toBe("en");
  });

  it("falls back to the default locale", () => {
    (globalThis as unknown as { navigator: { language: string } }).navigator = { language: "fr-FR" };
    const t = createI18n({ locales: ["da", "en"], messages, storage: store, detect: true, storageKey: "def-test" });
    expect(t.getLocale()).toBe("da");
  });
});

describe("globalThis singleton guard", () => {
  it("returns the SAME instance for the same storageKey", () => {
    const a = createI18n({ locales: ["da", "en"], messages, storage: store, storageKey: "shared" });
    const b = createI18n({ locales: ["da", "en"], messages, storage: store, storageKey: "shared" });
    expect(a).toBe(b);
    a.setLocale("en");
    expect(b.getLocale()).toBe("en"); // shared state
  });

  it("gives distinct instances for distinct keys", () => {
    const a = createI18n({ locales: ["da", "en"], messages, storage: store, storageKey: "k1" });
    const b = createI18n({ locales: ["da", "en"], messages, storage: store, storageKey: "k2" });
    expect(a).not.toBe(b);
  });

  it("throws on an empty locales array", () => {
    expect(() => createI18n({ locales: [], storageKey: "bad" })).toThrow(/locales/);
  });
});
