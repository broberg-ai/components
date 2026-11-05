// F110.17 — the module-owner terms: text from components, numbers from the product.
import { describe, expect, it } from "vitest";
import { EXAMPLE_FACTS, SOURCES, getDocument, parityProblems, renderHtml } from "../src/index";
import type { ProductFacts } from "../src/index";

const FYSIO: ProductFacts = {
  ...EXAMPLE_FACTS,
  id: "fysio-test",
  name: "Fysio-test",
  modules: { ...EXAMPLE_FACTS.modules!, revenueShare: [{ party: "platformen", percent: 25 }, { party: "modulejeren", percent: 75 }], warningDeadlineDays: 21, paymentProvider: "Mollie" },
};
const text = (d: ReturnType<typeof getDocument>) =>
  d.sections.flatMap((s) => [s.heading, ...s.blocks.flatMap((b) => ("text" in b ? [b.text] : "items" in b ? b.items : [...b.head, ...b.rows.flat()]))]).join("\n");
const table = (d: ReturnType<typeof getDocument>) => {
  const b = d.sections.find((s) => s.id === "tal")!.blocks[0]!;
  if (b.type !== "table") throw new Error("expected the facts table");
  return Object.fromEntries(b.rows.map(([k, v]) => [k, v]));
};

describe("modules — the owner's fixed points are in the text", () => {
  const t = text(getDocument({ doc: "modules", locale: "da", facts: EXAMPLE_FACTS }));
  for (const must of [
    "ansvaret for, at platformen er stabil",
    "ens for alle moduler, også platformens egne",
    "Besked:", "Advarsel:", "Pause:", "Fjernelse:",
    "sætte et modul på pause med det samme",
    "bringer patienters eller klinikkers data i fare",
    "har et sikkerhedshul", "gør platformen eller andre moduler ustabile", "ulovligt indhold",
    "Et menneske hos os vurderer altid sagen, før et modul sættes på pause",
    "bevares og kan eksporteres", "betaler ikke for modulet, mens det er på pause",
    "kan du klage", "registreres med tidspunkt, begrundelse og hvem der traf beslutningen",
    "BID-konto", "gælder den danske",
  ]) it(`contains «${must}»`, () => expect(t).toContain(must));
  it("is the owner-approved, not-a-draft version of 5/11, material (asks for acceptance again)", () => {
    const d = getDocument({ doc: "modules", locale: "da", facts: EXAMPLE_FACTS });
    expect([d.version, d.draft, d.material, d.placeholders]).toEqual(["2026-11-05", false, true, []]);
  });
});

describe("modules — numbers come ONLY from the product's facts", () => {
  it("the figures table shows exactly the product's numbers, and changes when they change", () => {
    expect(table(getDocument({ doc: "modules", locale: "da", facts: FYSIO }))).toMatchObject({
      "Andel til platformen": "25 %", "Andel til modulejeren": "75 %", "Betalingsudbyder": "Mollie", "Frist ved advarsel": "21 dage", "Varsel ved ændrede retningslinjer": "30 dage",
    });
    expect(table(getDocument({ doc: "modules", locale: "en", facts: FYSIO }))).toMatchObject({ "Share to platformen": "25 %", "Deadline after a warning": "21 days", "Payment provider": "Mollie" });
  });
  it("no digit and no vendor is typed into the authored prose (only the facts table carries them)", () => {
    for (const src of SOURCES.filter((s) => s.doc === "modules")) {
      for (const sec of src.sections) for (const b of sec.blocks) {
        const strings = b.type === "facts" ? [] : b.type === "list" ? b.items : b.type === "table" ? [...b.head, ...b.rows.flat()] : [b.text];
        for (const s of strings) expect([src.locale, b.id, /\d/.test(s), /mollie|stripe/i.test(s)]).toEqual([src.locale, b.id, false, false]);
      }
    }
  });
  it("a product without module facts gets a clear error, not a hollow document", () => {
    const { modules: _m, ...noModules } = EXAMPLE_FACTS;
    expect(() => getDocument({ doc: "modules", locale: "da", facts: noModules as ProductFacts })).toThrow(/has no module terms facts/);
  });
  it("shares that do not add up to 100 %, and missing or invalid fields, are refused", () => {
    const bad = (m: Partial<NonNullable<ProductFacts["modules"]>>) => ({ ...EXAMPLE_FACTS, modules: { ...EXAMPLE_FACTS.modules!, ...m } });
    expect(() => getDocument({ doc: "modules", locale: "da", facts: bad({ revenueShare: [{ party: "a", percent: 30 }, { party: "b", percent: 60 }] }) })).toThrow(/add up to 100/);
    expect(() => getDocument({ doc: "modules", locale: "da", facts: bad({ complaints: "" }) })).toThrow(/missing or invalid: complaints/);
    expect(() => getDocument({ doc: "modules", locale: "da", facts: bad({ exportDays: -1 }) })).toThrow(/exportDays/);
  });
});

describe("modules — translation and rendering", () => {
  it("the English mirrors the Danish block for block and says the Danish prevails", () => {
    expect(parityProblems(SOURCES.filter((s) => s.doc === "modules"))).toEqual([]);
    expect(text(getDocument({ doc: "modules", locale: "en", facts: EXAMPLE_FACTS }))).toContain("the Danish version prevails");
  });
  it("renders to HTML without a draft marker", () => {
    const html = renderHtml(getDocument({ doc: "modules", locale: "da", facts: FYSIO }));
    expect([html.includes("Vilkår for modulejere og udviklere"), html.includes("UDKAST"), html.includes("75 %")]).toEqual([true, false, true]);
  });
});
