// F110.18 — Google's Limited Use statement (mailworker #50072; owner «2 A», 18/11 2026).
import { describe, expect, it } from "vitest";
import { EXAMPLE_FACTS, SOURCES, createLibrary, getDocument, sourceHash, type ProductFacts } from "../src/index";

const STATEMENT = (name: string) =>
  `${name}'s use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy (https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.`;
const GOOGLE: ProductFacts = { ...EXAMPLE_FACTS, id: "mailworker", name: "mailworker", googleApiLimitedUse: true };
const texts = (d: ReturnType<typeof getDocument>) => d.sections.flatMap((s) => s.blocks.flatMap((b) => ("text" in b ? [b.text] : [])));

describe("privacy carries Google's Limited Use statement when the product says so (F110.18)", () => {
  for (const locale of ["da", "en"] as const) {
    it(`${locale}: googleApiLimitedUse:true → the statement verbatim, in English, with the product's name`, () => {
      const t = texts(getDocument({ doc: "privacy", locale, facts: GOOGLE }));
      expect(t.filter((x) => x === STATEMENT("mailworker"))).toEqual([STATEMENT("mailworker")]);
    });
    it(`${locale}: omitted or false → NO Google text, and the SAME contentHash as a privacy policy without the slot`, () => {
      // The document as it was before F110.18: the same source minus the one new facts block.
      const strip = (s: (typeof SOURCES)[number]) => (s.doc !== "privacy" ? s : { ...s, sections: s.sections.map((sec) => ({ ...sec, blocks: sec.blocks.filter((b) => b.id !== "deling.google") })) });
      const stripped = SOURCES.map(strip);
      // The old English translation pointed at the OLD master — keep that link consistent.
      const oldMaster = stripped.find((s) => s.doc === "privacy" && s.locale === "da")!;
      const before = stripped.map((s) => (s.doc === "privacy" && s.locale === "en" ? { ...s, translationOf: { version: s.translationOf!.version, sourceHash: sourceHash(oldMaster) } } : s));
      const old = createLibrary(before, [EXAMPLE_FACTS]).getDocument({ doc: "privacy", locale, product: EXAMPLE_FACTS.id });
      for (const facts of [EXAMPLE_FACTS, { ...EXAMPLE_FACTS, googleApiLimitedUse: false }]) {
        const now = getDocument({ doc: "privacy", locale, facts });
        expect(texts(now).some((x) => x.includes("Google API"))).toBe(false);
        expect(now.contentHash).toBe(old.contentHash);
      }
    });
  }
  it("the English translation is not marked stale by the new slot", () => {
    expect(getDocument({ doc: "privacy", locale: "en", facts: GOOGLE }).stale).toBe(false);
  });
});
