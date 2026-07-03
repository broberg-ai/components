import { describe, expect, it } from "vitest";
import { CORRECTIONS, TERMS, applyCorrections, corrections, extend, terms, toInitialPrompt } from "../src/index";

describe("data", () => {
  it("seeds real corrections from ordbog.txt, identity rows dropped", () => {
    // Not an exact count — the dictionary is editable in prod (F044.1), so entries
    // grow over time. Assert the seed floor + that specific seed entries survive.
    expect(CORRECTIONS.length).toBeGreaterThanOrEqual(55);
    expect(CORRECTIONS.every((e) => e.wrong.toLowerCase() !== e.right.toLowerCase())).toBe(true);
    expect(CORRECTIONS.some((e) => e.wrong === "kommitte" && e.right === "committe")).toBe(true);
    expect(CORRECTIONS.some((e) => e.wrong === "kloster" && e.right === "cluster")).toBe(true);
  });

  it("seeds the fleet proper-noun terms, grouped", () => {
    expect(TERMS.length).toBeGreaterThanOrEqual(40);
    expect(TERMS.some((t) => t.term === "cardmem" && t.group === "product")).toBe(true);
    expect(TERMS.some((t) => t.term === "WhisperKit" && t.group === "tech")).toBe(true);
    expect(TERMS.some((t) => t.term === "Christian Broberg" && t.group === "person")).toBe(true);
    expect(TERMS.some((t) => t.term === "broberg.ai" && t.group === "brand")).toBe(true);
  });
});

describe("terms()", () => {
  it("returns every term when called with no filter", () => {
    expect(terms().length).toBe(TERMS.length);
  });

  it("filters by group", () => {
    const products = terms({ groups: ["product"] });
    expect(products).toContain("cardmem");
    expect(products).not.toContain("WhisperKit");
  });
});

describe("corrections()", () => {
  it("returns the full correction entry list with notes", () => {
    const list = corrections();
    const kommitte = list.find((e) => e.wrong === "kommitte");
    expect(kommitte?.right).toBe("committe");
    expect(kommitte?.note).toBeTruthy();
  });
});

describe("toInitialPrompt", () => {
  it("joins all terms by default", () => {
    const prompt = toInitialPrompt();
    expect(prompt).toContain("WhisperKit");
    expect(prompt).toContain("cardmem");
  });

  it("respects groups and maxTerms", () => {
    const prompt = toInitialPrompt({ groups: ["tech"], maxTerms: 3 });
    expect(prompt.split(", ").length).toBe(3);
    expect(prompt).not.toContain("cardmem"); // product, not tech
  });

  it("prepends a preamble when given", () => {
    const prompt = toInitialPrompt({ groups: ["product"], maxTerms: 1, preamble: "Vocabulary:" });
    expect(prompt.startsWith("Vocabulary: ")).toBe(true);
  });
});

describe("applyCorrections", () => {
  it("fixes known mishears with whole-word, case-insensitive matching", () => {
    expect(applyCorrections("jeg lavede en kommitte i går")).toBe("jeg lavede en committe i går");
  });

  it("does not touch substrings that merely contain a wrong term", () => {
    expect(applyCorrections("pustebold")).toBe("pustebold");
  });

  it("is unicode-aware — handles æøå at term boundaries where default \\b fails", () => {
    // "søver -> server": a bare \b\w+\b regex fails here because \b does not
    // treat ø as a word character, so this is the regression case for that bug.
    expect(applyCorrections("vi bruger søver til at hoste tjenesten")).toBe(
      "vi bruger server til at hoste tjenesten",
    );
  });

  it("matches longest wrong-term first to avoid partial-substring corruption", () => {
    expect(applyCorrections("kommitte")).toBe("committe");
    expect(applyCorrections("komitte")).toBe("committe");
  });
});

describe("extend", () => {
  it("merges caller terms/corrections into a fresh bound API without mutating the base", () => {
    const custom = extend({
      terms: [{ term: "fd-sundhed", group: "product" }],
      corrections: [{ wrong: "fysjo", right: "fysio", note: "FDS-specific" }],
    });
    expect(custom.terms()).toContain("fd-sundhed");
    expect(custom.applyCorrections("fysjo klinik")).toBe("fysio klinik");
    expect(terms()).not.toContain("fd-sundhed");
    expect(applyCorrections("fysjo klinik")).toBe("fysjo klinik");
  });

  it("two independent extend() calls don't interfere with each other", () => {
    const a = extend({ corrections: [{ wrong: "aaa", right: "AAA" }] });
    const b = extend({ corrections: [{ wrong: "bbb", right: "BBB" }] });
    expect(a.applyCorrections("aaa")).toBe("AAA");
    expect(a.applyCorrections("bbb")).toBe("bbb");
    expect(b.applyCorrections("aaa")).toBe("aaa");
  });
});
