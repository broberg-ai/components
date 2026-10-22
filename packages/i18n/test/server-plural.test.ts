// F019.9 — i18n on the server without leaking one user's language into another
// user's page, and plurals via Intl.PluralRules.
import { afterEach, describe, expect, it } from "vitest";
import { createI18n, translate, __resetI18nRegistry, type Dict } from "../src/index.js";

const messages: Record<string, Dict> = {
  da: { hello: "Hej {name}", docs: { one: "{count} dokument", other: "{count} dokumenter" }, onlyDa: "kun dansk" },
  en: { hello: "Hello {name}", docs: { one: "{count} document", other: "{count} documents" } },
  pl: { docs: { one: "{count} dokument", few: "{count} dokumenty", many: "{count} dokumentów", other: "{count} dokumentu" } },
};
const REG = "__broberg_i18n__";

afterEach(() => __resetI18nRegistry());

describe("translate — pure, per request", () => {
  it("two concurrent requests in different languages each get their own, and the shared singleton is untouched", async () => {
    const shared = createI18n({ locales: ["da", "en"], messages, detect: false });
    const before = shared.getLocale();
    const request = async (locale: string, name: string) => {
      const a = translate(messages, locale, "hello", { name });
      await new Promise((r) => setTimeout(r, locale === "da" ? 5 : 1)); // interleave
      const b = translate(messages, locale, "docs", { count: 3 });
      return [a, b];
    };
    const [da, en] = await Promise.all([request("da", "Ida"), request("en", "Ann")]);
    expect(da).toEqual(["Hej Ida", "3 dokumenter"]);
    expect(en).toEqual(["Hello Ann", "3 documents"]);
    expect(shared.getLocale()).toBe(before);
  });

  it("touches no global state: the globalThis registry is not created by translate", () => {
    delete (globalThis as unknown as Record<string, unknown>)[REG];
    translate(messages, "en", "hello", { name: "x" });
    expect((globalThis as unknown as Record<string, unknown>)[REG]).toBeUndefined();
  });

  it("falls back to fallbackLocale, then the raw key", () => {
    expect(translate(messages, "en", "onlyDa", undefined, { fallbackLocale: "da" })).toBe("kun dansk");
    expect(translate(messages, "en", "onlyDa")).toBe("onlyDa");
    expect(translate(messages, "en", "nope.deeper", undefined, { fallbackLocale: "da" })).toBe("nope.deeper");
  });
});

describe("plurals via Intl.PluralRules", () => {
  it("Danish: 1 dokument / 3 dokumenter / 0 dokumenter", () => {
    expect(translate(messages, "da", "docs", { count: 1 })).toBe("1 dokument");
    expect(translate(messages, "da", "docs", { count: 3 })).toBe("3 dokumenter");
    expect(translate(messages, "da", "docs", { count: 0 })).toBe("0 dokumenter");
  });

  it("Polish has more than two forms: 1 / 3 / 5", () => {
    expect(translate(messages, "pl", "docs", { count: 1 })).toBe("1 dokument");
    expect(translate(messages, "pl", "docs", { count: 3 })).toBe("3 dokumenty");
    expect(translate(messages, "pl", "docs", { count: 5 })).toBe("5 dokumentów");
  });

  it("an underscore locale code is normalised (en_US → en-US) instead of throwing", () => {
    const m: Record<string, Dict> = { en_US: { d: { one: "{count} item", other: "{count} items" } } };
    expect(translate(m, "en_US", "d", { count: 1 })).toBe("1 item");
  });

  it("a locale tag Intl rejects falls back to other instead of throwing", () => {
    const m: Record<string, Dict> = { "not a tag": { d: { one: "one", other: "many" } } };
    expect(translate(m, "not a tag", "d", { count: 1 })).toBe("many");
  });

  it("a missing form falls back to other", () => {
    const m: Record<string, Dict> = { pl: { x: { one: "jeden", other: "inne" } } };
    expect(translate(m, "pl", "x", { count: 5 })).toBe("inne"); // pl 'many' missing
  });

  it("a plural entry without count uses other", () => {
    const m: Record<string, Dict> = { pl: { x: { one: "jeden", other: "inne" } } };
    expect(translate(m, "pl", "x")).toBe("inne");
  });

  it("the fallback locale's plural rules are used for a fallback hit", () => {
    expect(translate(messages, "pl", "hello", { name: "Ola" }, { fallbackLocale: "en" })).toBe("Hello Ola");
    const m: Record<string, Dict> = { da: {}, pl: { x: { one: "jeden", few: "kilka", other: "inne" } } };
    expect(translate(m, "da", "x", { count: 3 }, { fallbackLocale: "pl" })).toBe("kilka");
  });

  it("the singleton t() gets plurals too", () => {
    const i = createI18n({ locales: ["da", "en"], messages, detect: false });
    expect(i.t("docs", { count: 1 })).toBe("1 dokument");
  });
});

describe("createI18n({ locale, singleton: false })", () => {
  it("returns a private instance per call, outside the registry", () => {
    const a = createI18n({ locales: ["da", "en"], messages, singleton: false });
    const b = createI18n({ locales: ["da", "en"], messages, singleton: false });
    expect(a).not.toBe(b);
    const reg = (globalThis as unknown as Record<string, Map<string, unknown> | undefined>)[REG];
    expect(reg?.size ?? 0).toBe(0);
  });

  it("starts in the given locale instead of detecting one", () => {
    // "da" is NOT what detection would pick here: en is first (the default) and
    // Node's navigator.language is en-US — so only `locale` can make it Danish.
    const a = createI18n({ locales: ["en", "da"], messages, locale: "da", singleton: false });
    expect(a.getLocale()).toBe("da");
    expect(a.t("docs", { count: 2 })).toBe("2 dokumenter");
  });

  it("the default (singleton) is unchanged: same storageKey → same instance", () => {
    expect(createI18n({ locales: ["da"], messages })).toBe(createI18n({ locales: ["da"], messages }));
  });
});
