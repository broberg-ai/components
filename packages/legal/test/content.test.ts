// components F110.3 (first pass) — the bundled DRAFT texts: every document
// resolves for every product, the owner's fixed points are in the text, and no
// product fact is typed into prose.
import { describe, expect, it } from "vitest";
import { DOC_IDS, PRODUCTS, SOURCES, getDocument } from "../src/index";

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

describe("the bundled drafts", () => {
  it("every document resolves for every product in Danish, and is marked draft", () => {
    for (const doc of DOC_IDS) {
      for (const p of PRODUCTS) {
        const d = getDocument({ doc, locale: "da", product: p.id });
        expect([doc, p.id, d.draft, d.sections.length > 0]).toEqual([doc, p.id, true, true]);
      }
    }
  });

  it("terms carry the acceptance clause and the active (unticked) acceptance", () => {
    const t = allText(getDocument({ doc: "terms", locale: "da", product: "default" }));
    expect(t).toContain("Når du opretter en konto eller bruger tjenesten, accepterer du disse vilkår.");
    expect(t).toContain("ikke afkrydset på forhånd");
  });

  it("privacy is information, never something accepted — and states the owner's fixed points", () => {
    const t = allText(getDocument({ doc: "privacy", locale: "da", product: "default" }));
    expect(t).not.toMatch(/accepterer privatlivspolitikken/i);
    for (const must of ["Højst 6 måneder", "mindst 10 personer", "pseudonymiseres", "art. 21", "90 dage", "Datatilsynet", "broberg-consent"]) {
      expect([must, t.includes(must)]).toEqual([must, true]);
    }
  });

  it("no vendor name from any product's sub-processors is typed into prose", () => {
    const vendors = [...new Set(PRODUCTS.flatMap((p) => p.subprocessors.map((s) => s.name)))];
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
    expect(getDocument({ doc: "dpa", locale: "da", product: "default" }).placeholders).toEqual(
      ["contract.date", "contract.title", "customer.address", "customer.cvr", "customer.name", "provider.address", "provider.cvr", "provider.name"],
    );
    for (const doc of ["terms", "privacy", "trust"] as const) {
      expect([doc, getDocument({ doc, locale: "da", product: "default" }).placeholders]).toEqual([doc, []]);
    }
  });
});
