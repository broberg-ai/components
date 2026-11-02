// components F110.3 (first pass) — the bundled DRAFT texts: every document
// resolves for every product, the owner's fixed points are in the text, and no
// product fact is typed into prose.
import { describe, expect, it } from "vitest";
import { DOC_IDS, EXAMPLE_FACTS, SOURCES, createLibrary, getDocument, getTemplate, listDocuments, parityProblems, renderHtml, resolveTemplate, sourceHash, templateHash } from "../src/index";
import type { ProductFacts } from "../src/index";

// Two products' OWN facts, as a consumer would pass them (F110.14 — no fleet registry here).
const OTHER: ProductFacts = { ...EXAMPLE_FACTS, id: "other", name: "Andet produkt", subprocessors: [...EXAMPLE_FACTS.subprocessors, { name: "Cloudflare", purpose: "Filer", location: "EU", transfer: "Standardkontrakt" }], conversationAnalysis: false };
const FACTS = [EXAMPLE_FACTS, OTHER];

const prose = (s: (typeof SOURCES)[number]) =>
  s.sections.flatMap((sec) => [
    sec.heading,
    ...sec.blocks.flatMap((b) =>
      b.type === "facts" ? [] : b.type === "list" ? b.items : b.type === "table" ? [...b.head, ...b.rows.flat()] : [b.text],
    ),
  ]);
const allText = (d: ReturnType<typeof getDocument>) =>
  d.sections
    .flatMap((s) => [s.heading, ...s.blocks.flatMap((b) => ("text" in b ? [b.text] : "items" in b ? b.items : [...b.head, ...b.rows.flat()]))])
    .join("\n");

describe("F110.14 — templates from the API, facts from the product", () => {
  it("getTemplate returns the authored template with its facts SLOTS left open, and its hash", () => {
    const t = getTemplate({ doc: "privacy", locale: "da" });
    const slots = t.sections.flatMap((s) => s.blocks).filter((b) => b.type === "facts").map((b) => (b as { fact: string }).fact);
    expect(slots).toEqual(["dataCategories", "conversationAnalysis", "hosting", "subprocessors"]);
    expect(t.hash).toBe(templateHash(SOURCES.find((s) => s.doc === "privacy")!));
    expect(t.stale).toBe(false);
  });
  it("every document has its English translation (F110.4)", () => {
    for (const doc of DOC_IDS) expect([doc, getTemplate({ doc, locale: "en" }).locale]).toEqual([doc, "en"]);
  });
  it("listDocuments names every template with version and hash", () => {
    const l = listDocuments();
    expect(l.map((x) => `${x.doc}.${x.locale}`).sort()).toEqual(DOC_IDS.flatMap((d) => [`${d}.da`, `${d}.en`]).sort());
    expect(l.every((x) => /^[0-9a-f]{64}$/.test(x.hash))).toBe(true);
  });
  it("resolveTemplate(fetched template, own facts) gives the SAME document as getDocument with the same facts", () => {
    const viaApi = resolveTemplate(JSON.parse(JSON.stringify(getTemplate({ doc: "trust", locale: "da" }))), OTHER);
    const viaNpm = getDocument({ doc: "trust", locale: "da", facts: OTHER });
    expect(viaApi.contentHash).toBe(viaNpm.contentHash);
    expect(viaApi.product).toBe("other");
  });
  it("a product's own facts reach its document — and only its own", () => {
    const txt = (f: ProductFacts) => JSON.stringify(getDocument({ doc: "trust", locale: "da", facts: f }).sections);
    expect(txt(OTHER)).toContain("Cloudflare");
    expect(txt(EXAMPLE_FACTS)).not.toContain("Cloudflare");
  });
});

describe("the bundled documents (v1.0, approved by the owner's lawyer 2/11 2026)", () => {
  it("every document resolves for every product in Danish, is NOT a draft, and is version 2026-11-02", () => {
    for (const doc of DOC_IDS) {
      for (const p of FACTS) {
        const d = getDocument({ doc, locale: "da", facts: p });
        expect([doc, p.id, d.draft, d.version, d.effectiveFrom, d.sections.length > 0]).toEqual([doc, p.id, false, "2026-11-02", "2026-11-02", true]);
      }
    }
  });

  it("no rendered document carries the UDKAST marker any more (owner 2/11 2026: «Dette skal slettes»)", () => {
    for (const doc of DOC_IDS) {
      const html = renderHtml(getDocument({ doc, locale: "da", facts: EXAMPLE_FACTS }));
      expect([doc, html.includes("UDKAST"), html.includes("legal-draft")]).toEqual([doc, false, false]);
    }
  });

  it("terms carry the acceptance clause and the active (unticked) acceptance", () => {
    const t = allText(getDocument({ doc: "terms", locale: "da", facts: EXAMPLE_FACTS }));
    expect(t).toContain("Når du opretter en konto eller bruger tjenesten, accepterer du disse vilkår.");
    expect(t).toContain("ikke afkrydset på forhånd");
  });

  it("F110.16 — terms promise no analysis; whether a product analyses is said ONLY in privacy, per product", () => {
    const terms = allText(getDocument({ doc: "terms", locale: "da", facts: OTHER }));
    expect(terms).not.toMatch(/analyse/i);
    expect(terms).toContain("som beskrevet i privatlivspolitikken");
    const privacy = allText(getDocument({ doc: "privacy", locale: "da", facts: OTHER }));
    expect(privacy).toContain("Andet produkt er ikke omfattet af afsnittet om analyse af samtaler.");
  });

  it("privacy is information, never something accepted — and states the owner's fixed points", () => {
    const t = allText(getDocument({ doc: "privacy", locale: "da", facts: EXAMPLE_FACTS }));
    expect(t).not.toMatch(/accepterer privatlivspolitikken/i);
    for (const must of ["Højst 6 måneder", "mindst 10 personer", "pseudonymiseres", "art. 21", "90 dage", "Datatilsynet", "broberg-consent"]) {
      expect([must, t.includes(must)]).toEqual([must, true]);
    }
  });

  it("no vendor name from any product's sub-processors is typed into prose", () => {
    const vendors = [...new Set(FACTS.flatMap((p) => p.subprocessors.map((s) => s.name)))];
    for (const src of SOURCES) {
      const text = prose(src).join("\n");
      for (const v of vendors) expect([src.doc, v, text.includes(v)]).toEqual([src.doc, v, false]);
    }
  });

  it("section ids and block ids are unique within each document", () => {
    for (const src of SOURCES) {
      const secIds = src.sections.map((s) => s.id);
      const blockIds = src.sections.flatMap((s) => s.blocks.map((b) => b.id));
      expect([src.doc, new Set(secIds).size, new Set(blockIds).size]).toEqual([src.doc, secIds.length, blockIds.length]);
    }
  });

  it("the contract documents expect their merge fields; the public ones expect none", () => {
    expect(getDocument({ doc: "dpa", locale: "da", facts: EXAMPLE_FACTS }).placeholders).toEqual(
      ["contract.date", "contract.title", "customer.address", "customer.cvr", "customer.name", "provider.address", "provider.cvr", "provider.name"],
    );
    for (const doc of ["terms", "privacy", "trust"] as const) {
      expect([doc, getDocument({ doc, locale: "da", facts: EXAMPLE_FACTS }).placeholders]).toEqual([doc, []]);
    }
  });
});

describe("F110.4 — the English translation", () => {
  const en = SOURCES.filter((s) => s.locale === "en");
  const daOf = (doc: string) => SOURCES.find((s) => s.doc === doc && s.locale === "da")!;

  it("all five documents are translated, and every translation mirrors its master block for block", () => {
    expect(en.map((s) => s.doc).sort()).toEqual([...DOC_IDS].sort());
    expect(parityProblems(SOURCES)).toEqual([]);
  });

  it("every bundled translation is of the CURRENT master — change the Danish and this goes red until the English follows", () => {
    for (const t of en) {
      expect([t.doc, t.translationOf]).toEqual([t.doc, { version: daOf(t.doc).version, sourceHash: sourceHash(daOf(t.doc)) }]);
      for (const p of FACTS) expect([t.doc, p.id, getDocument({ doc: t.doc, locale: "en", facts: p }).stale]).toEqual([t.doc, p.id, false]);
    }
  });

  it("when the Danish master moves on, getDocument reports the English as stale — never as current", () => {
    const t = en.find((s) => s.doc === "terms")!;
    const m = daOf("terms");
    const moved = { ...m, sections: m.sections.map((s) => (s.id === "ai" ? { ...s, blocks: [{ id: "ai.p1", type: "p" as const, text: "Ny tekst." }] } : s)) };
    const lib = (master: typeof m) => createLibrary([master, t], [EXAMPLE_FACTS]).getDocument({ doc: "terms", locale: "en", product: EXAMPLE_FACTS.id });
    expect(lib(m).stale).toBe(false);
    expect([lib(moved).stale, lib(moved).locale]).toEqual([true, "en"]);
  });

  it("each translation carries the same version, dates, material flag and merge fields as its master", () => {
    for (const t of en) {
      const m = daOf(t.doc);
      expect([t.doc, t.version, t.effectiveFrom, t.material, t.draft]).toEqual([t.doc, m.version, m.effectiveFrom, m.material, m.draft]);
      expect([t.doc, getDocument({ doc: t.doc, locale: "en", facts: EXAMPLE_FACTS }).placeholders]).toEqual([t.doc, getDocument({ doc: t.doc, locale: "da", facts: EXAMPLE_FACTS }).placeholders]);
    }
  });

  it("terms, privacy, DPA and support state that the Danish version prevails — in both languages", () => {
    for (const doc of ["terms", "privacy", "dpa", "support"] as const) {
      expect([doc, allText(getDocument({ doc, locale: "da", facts: EXAMPLE_FACTS })).includes("gælder den danske") || allText(getDocument({ doc, locale: "da", facts: EXAMPLE_FACTS })).includes("danske udgave gælder")]).toEqual([doc, true]);
      expect([doc, allText(getDocument({ doc, locale: "en", facts: EXAMPLE_FACTS })).includes("Danish version prevails")]).toEqual([doc, true]);
    }
  });

  it("no vendor name and no Danish leftovers are typed into the English prose", () => {
    for (const t of en) {
      const text = prose(t).join("\n");
      expect([t.doc, /\b(og|ikke|eller|vores|skal)\b/.test(text)]).toEqual([t.doc, false]);
    }
  });
});

describe("parityProblems — what it refuses", () => {
  const m = SOURCES.find((s) => s.doc === "terms" && s.locale === "da")!;
  const t = SOURCES.find((s) => s.doc === "terms" && s.locale === "en")!;
  const withSections = (sections: typeof t.sections) => ({ ...t, sections });

  it("a missing paragraph", () => {
    const sec = t.sections.map((s) => (s.id === "accept" ? { ...s, blocks: s.blocks.slice(0, 2) } : s));
    expect(parityProblems([m, withSections(sec)])[0]).toContain("accept.p3");
  });
  it("an extra paragraph", () => {
    const sec = t.sections.map((s) => (s.id === "ai" ? { ...s, blocks: [...s.blocks, { id: "ai.p2", type: "p" as const, text: "Extra." }] } : s));
    expect(parityProblems([m, withSections(sec)])[0]).toContain("ai.p2");
  });
  it("a reordered section", () => {
    const sec = [t.sections[1]!, t.sections[0]!, ...t.sections.slice(2)];
    expect(parityProblems([m, withSections(sec)])).toHaveLength(1);
  });
  it("a list item dropped", () => {
    const p = SOURCES.find((s) => s.doc === "privacy" && s.locale === "en")!;
    const pm = SOURCES.find((s) => s.doc === "privacy" && s.locale === "da")!;
    const sec = p.sections.map((s) => ({ ...s, blocks: s.blocks.map((b) => (b.type === "list" ? { ...b, items: b.items.slice(1) } : b)) }));
    expect(parityProblems([pm, { ...p, sections: sec }])[0]).toContain("analyse.list");
  });
  it("a translation with no master", () => {
    expect(parityProblems([t])).toEqual(["terms.en: no da master"]);
  });
});

describe("F110.10 — the support agreement", () => {
  it("lists its merge fields as typed placeholders — the same in Danish and English", () => {
    const want = ["contract.startDate", "contract.title", "customer.address", "customer.cvr", "customer.name", "provider.address", "provider.cvr", "provider.name"];
    for (const locale of ["da", "en"] as const) {
      expect([locale, getDocument({ doc: "support", locale, facts: EXAMPLE_FACTS }).placeholders]).toEqual([locale, want]);
    }
  });
  it("a support text with a merge field that is not a known placeholder is refused", () => {
    const s = SOURCES.find((x) => x.doc === "support" && x.locale === "da")!;
    const bad = { ...s, sections: [{ id: "x", heading: "X", blocks: [{ id: "x.p1", type: "p" as const, text: "Pris: {pris.beloeb}" }] }] };
    expect(() => createLibrary([bad], [EXAMPLE_FACTS]).getDocument({ doc: "support", locale: "da", product: EXAMPLE_FACTS.id })).toThrow(/unknown placeholder/);
  });
  it("prices and dates are never typed into the prose — they live in the price appendix and the merge fields", () => {
    const s = SOURCES.find((x) => x.doc === "support" && x.locale === "da")!;
    expect(prose(s).join("\n")).not.toMatch(/\bDKK\b|kr\.|\b20\d\d-\d\d-\d\d\b/);
  });
});
