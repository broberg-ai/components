// F110.21 — a table in a legal document must be able to shrink to a phone. Measured 21 Nov 2026 (mailworker, then Lens here):
// with ordinary page styling (14 px text, 8×12 px cell padding) the 4-column tables of privacy/trust/dpa are 450 px wide on a
// 393 px phone and the PAGE scrolls sideways — a 4-column table's minimum width is the sum of its columns' longest words
// («AI-sprogmodeller»), and any padding the site adds on top pushes it past the screen. The renderer therefore lets every
// table break inside a word when it has to (overflow-wrap:anywhere), so its minimum width is small and the table always fits —
// and hyphenate where the browser can (hyphens:auto, the document carries lang), so the breaks read «Stock-holm», not «Stockh/olm».
import { describe, expect, it } from "vitest";
import { DOC_IDS, EXAMPLE_FACTS, getDocument, renderHtml } from "../src/index";

const LOCALES = ["da", "en"] as const;

describe("F110.21 — every rendered table can shrink to the screen", () => {
  for (const doc of DOC_IDS) for (const locale of LOCALES) {
    const tags = () => renderHtml(getDocument({ doc, locale, facts: EXAMPLE_FACTS })).match(/<table[^>]*>/g) ?? [];
    it(`${doc}/${locale}: each <table> can break inside a word (overflow-wrap:anywhere)`, () => {
      for (const t of tags()) expect(t, t).toMatch(/style="[^"]*overflow-wrap:anywhere/);
    });
    it(`${doc}/${locale}: each <table> hyphenates where the browser can (hyphens:auto)`, () => {
      for (const t of tags()) expect(t, t).toMatch(/style="[^"]*hyphens:auto/);
    });
  }

  it("the documents that have tables really have them (the loop above is not vacuous)", () => {
    const total = DOC_IDS.flatMap((doc) => LOCALES.map((locale) => renderHtml(getDocument({ doc, locale, facts: EXAMPLE_FACTS })).match(/<table/g)?.length ?? 0)).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(10);
  });

  it("the text is untouched: the content hash does not depend on how a table is drawn", () => {
    const a = getDocument({ doc: "privacy", locale: "da", facts: EXAMPLE_FACTS });
    expect(a.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(renderHtml(a)).toContain(`data-legal-hash="${a.contentHash}"`);
  });
});
