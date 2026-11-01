// components F110.3 (first pass) — the bundled DRAFT texts: every document
// resolves for every product, the owner's fixed points are in the text, and no
// product fact is typed into prose.
import { describe, expect, it } from "vitest";
import { DOC_IDS, EXAMPLE_FACTS, SOURCES, getDocument, getTemplate, listDocuments, resolveTemplate, templateHash } from "../src/index";
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
  it("a missing translation falls back to the Danish master", () => {
    expect(getTemplate({ doc: "terms", locale: "en" }).locale).toBe("da");
  });
  it("listDocuments names every template with version and hash", () => {
    const l = listDocuments();
    expect(l.map((x) => x.doc).sort()).toEqual([...DOC_IDS].sort());
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

describe("the bundled drafts", () => {
  it("every document resolves for every product in Danish, and is marked draft", () => {
    for (const doc of DOC_IDS) {
      for (const p of FACTS) {
        const d = getDocument({ doc, locale: "da", facts: p });
        expect([doc, p.id, d.draft, d.sections.length > 0]).toEqual([doc, p.id, true, true]);
      }
    }
  });

  it("terms carry the acceptance clause and the active (unticked) acceptance", () => {
    const t = allText(getDocument({ doc: "terms", locale: "da", facts: EXAMPLE_FACTS }));
    expect(t).toContain("Når du opretter en konto eller bruger tjenesten, accepterer du disse vilkår.");
    expect(t).toContain("ikke afkrydset på forhånd");
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
