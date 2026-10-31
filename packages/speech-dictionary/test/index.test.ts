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

// ---------------------------------------------------------------------------
// F044.2 — six mishearings are ALSO ordinary Danish words
// ---------------------------------------------------------------------------
import { readFileSync as readF } from "node:fs";
import { applyCorrections as apply044, correctionsApplier, corrections as corr044, type CorrectionEntry as CE } from "../src/index";

/** 0.1.3's applyCorrections, verbatim, as the reference for byte-for-byte compatibility. */
function reference013(entries: CE[]) {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sorted = [...entries].sort((a, b) => b.wrong.length - a.wrong.length);
  const pats = sorted.map((e) => ({ p: new RegExp(`(?<![\\p{L}\\p{N}_])${esc(e.wrong)}(?![\\p{L}\\p{N}_])`, "giu"), r: e.right }));
  return (t: string) => pats.reduce((acc, { p, r }) => acc.replace(p, r), t);
}
const OLD: CE[] = JSON.parse(readF(new URL("./fixtures/corrections.0.1.3.json", import.meta.url), "utf8"));
const CORPUS = [
  "Vi kører API-ruter og en ruter i kælderen.",
  "git-kommitte og så kommitte igen, server-kloster, et kloster",
  "Dansen på dashboard-dansen, bogen om buggen, regnskabs-bogen",
  "Husk at passe på, og at passe JSON-passe-trinnet.",
  "varemærke-registret, at mærke branchen, MÆRKE og Ruter",
  "deploy til produktions-ruter- og ruter-tabel",
];

describe("F044.2 — an entry that is also a Danish word does not fire inside a hyphenated compound", () => {
  it("AC0 the measured case, both directions: 'API-ruter' unchanged, a bare 'ruter' still corrected", () => {
    expect(apply044("de 6 API-ruter")).toBe("de 6 API-ruter");
    expect(apply044("min ruter er nede")).toBe("min router er nede");
  });
  it("AC0 a compound on either side of the word is left alone", () => {
    expect(apply044("ruter-tabellen og kirke-kloster")).toBe("ruter-tabellen og kirke-kloster");
  });
  it("AC1 backward compatible by construction: the list WITHOUT the new field gives 0.1.3's output byte-for-byte", () => {
    const stripped = corr044().map(({ alsoDanishWord: _x, ...e }) => e);
    expect(stripped).toEqual(OLD); // the only change to the data is the new field
    const now = correctionsApplier(stripped);
    const before = reference013(OLD);
    for (const line of CORPUS) expect([line, now(line)]).toEqual([line, before(line)]);
  });
  it("AC1 an entry from a consumer's extend() with no field behaves as before (fires in a compound)", () => {
    expect(correctionsApplier([{ wrong: "ruter", right: "router" }])("API-ruter")).toBe("API-router");
  });
  it("AC2 EVERY entry answers the documented question — «is `wrong` also an ordinary Danish word?» — and exactly six say yes", () => {
    const unanswered = corr044().filter((e) => typeof e.alsoDanishWord !== "boolean").map((e) => e.wrong);
    expect(unanswered).toEqual([]);
    expect(corr044().filter((e) => e.alsoDanishWord).map((e) => e.wrong).sort()).toEqual(["bogen", "dansen", "kloster", "mærke", "passe", "ruter"]);
  });
  it("AC3 a NON-flagged entry still fires inside a compound (the opt-out is per entry, not global)", () => {
    expect(apply044("git-kommitte")).toBe("git-committe");
  });
});
