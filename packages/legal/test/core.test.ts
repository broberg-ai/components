// components F110.2 — the library mechanism, against FIXTURE documents. The real
// texts are F110.3 (legal review first); nothing here is a legal statement.
import { describe, expect, it } from "vitest";
import { createLibrary, renderHtml, sourceHash, placeholdersIn, type DocumentSource, type ProductFacts } from "../src/index";

const product = (over: Partial<ProductFacts> = {}): ProductFacts => ({
  id: "jam",
  name: "Jam",
  hosting: [{ what: "Appen", where: "Stockholm" }],
  dataCategories: ["Navn", "E-mail"],
  subprocessors: [{ name: "Fly.io", purpose: "Hosting", location: "Sverige", transfer: "Inden for EU" }],
  conversationAnalysis: true,
  healthData: false,
  ...over,
});
const master = (text = "Vi gemmer kun det nødvendige."): DocumentSource => ({
  doc: "privacy",
  locale: "da",
  title: "Privatlivspolitik",
  version: "2026-11-15",
  effectiveFrom: "2026-11-15",
  material: false,
  draft: true,
  sections: [
    { id: "intro", heading: "Indledning", blocks: [{ id: "intro.p1", type: "p", text }] },
    { id: "vendors", heading: "Leverandører", blocks: [{ id: "vendors.table", type: "facts", fact: "subprocessors" }, { id: "vendors.p1", type: "p", text: "Vi sælger aldrig data." }] },
  ],
});
const english = (m: DocumentSource, translatedFrom = m): DocumentSource => ({
  ...m,
  locale: "en",
  title: "Privacy policy",
  translationOf: { version: translatedFrom.version, sourceHash: sourceHash(translatedFrom) },
  sections: [
    { id: "intro", heading: "Introduction", blocks: [{ id: "intro.p1", type: "p", text: "We keep only what is necessary." }] },
    { id: "vendors", heading: "Vendors", blocks: [{ id: "vendors.table", type: "facts", fact: "subprocessors" }, { id: "vendors.p1", type: "p", text: "We never sell data." }] },
  ],
});

describe("AC0 — a resolved document carries stable ids, version, effectiveFrom and a contentHash", () => {
  it("shape, and the hash is stable for the same input", () => {
    const lib = createLibrary([master()], [product()]);
    const a = lib.getDocument({ doc: "privacy", locale: "da", product: "jam" });
    expect([a.version, a.effectiveFrom, a.sections.map((s) => s.id), a.contentHash]).toEqual([
      "2026-11-15", "2026-11-15", ["intro", "vendors"], lib.getDocument({ doc: "privacy", locale: "da", product: "jam" }).contentHash,
    ]);
    expect(a.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });
  it("one character changed in the text changes the hash — and changing it back restores it", () => {
    const h = (t: string) => createLibrary([master(t)], [product()]).getDocument({ doc: "privacy", locale: "da", product: "jam" }).contentHash;
    expect(h("Vi gemmer kun det nødvendige.")).not.toBe(h("Vi gemmer kun det nødvendige!"));
    expect(h("Vi gemmer kun det nødvendige.")).toBe(h("Vi gemmer kun det nødvendige."));
  });
});

describe("AC1 — product facts are data: same facts, same text; a fact moves only its own block", () => {
  it("two products with identical facts get byte-identical sections", () => {
    const lib = createLibrary([master()], [product({ id: "a", name: "X" }), product({ id: "b", name: "X" })]);
    const a = lib.getDocument({ doc: "privacy", locale: "da", product: "a" });
    const b = lib.getDocument({ doc: "privacy", locale: "da", product: "b" });
    expect(JSON.stringify(a.sections)).toBe(JSON.stringify(b.sections));
  });
  it("adding a sub-processor changes ONLY the facts block", () => {
    const base = createLibrary([master()], [product()]).getDocument({ doc: "privacy", locale: "da", product: "jam" });
    const more = createLibrary([master()], [product({ subprocessors: [...product().subprocessors, { name: "Mistral", purpose: "AI", location: "Frankrig", transfer: "Inden for EU" }] })]).getDocument({ doc: "privacy", locale: "da", product: "jam" });
    const changed = base.sections.flatMap((s, i) => s.blocks.map((b, j) => [b.id, JSON.stringify(b) !== JSON.stringify(more.sections[i]!.blocks[j])])).filter(([, d]) => d).map(([id]) => id);
    expect(changed).toEqual(["vendors.table"]);
    expect(base.contentHash).not.toBe(more.contentHash);
  });
});

describe("AC2 — a site cannot inject wording", () => {
  it("getDocument takes doc, locale and product — nothing that adds or replaces text", () => {
    const lib = createLibrary([master()], [product()]);
    // @ts-expect-error — there is no text/override/sections option, by design
    lib.getDocument({ doc: "privacy", locale: "da", product: "jam", sections: [] });
    // At runtime an unknown option is ignored: the text is the library's.
    const d = lib.getDocument({ doc: "privacy", locale: "da", product: "jam", text: "hacked" } as never);
    expect(JSON.stringify(d)).not.toContain("hacked");
  });
  it("an unknown product is refused, not given a default text", () => {
    expect(() => createLibrary([master()], [product()]).getDocument({ doc: "privacy", locale: "da", product: "nope" })).toThrow(/unknown product/);
  });
});

describe("AC3 — renderHtml: semantic HTML a site can style, every section and block addressable", () => {
  it("data-legal-id on every section and block; version + hash on the root; content escaped", () => {
    const d = createLibrary([master("Tal <b>ikke</b> & så videre")], [product()]).getDocument({ doc: "privacy", locale: "da", product: "jam" });
    const html = renderHtml(d);
    for (const s of d.sections) {
      expect(html).toContain(`<section data-legal-id="${s.id}">`);
      for (const b of s.blocks) expect(html).toContain(`data-legal-id="${b.id}"`);
    }
    expect(html).toContain(`data-legal-hash="${d.contentHash}"`);
    expect(html).toContain("Tal &lt;b&gt;ikke&lt;/b&gt; &amp; så videre");
    expect(html).toMatch(/<table data-legal-id="vendors.table"><thead><tr><th>Leverandør<\/th>/);
  });
  it("a draft says so visibly", () => {
    const d = createLibrary([master()], [product()]).getDocument({ doc: "privacy", locale: "da", product: "jam" });
    expect(renderHtml(d)).toContain("UDKAST — ikke gældende endnu");
  });
});

describe("i18n — a translation of the current master is current; of an older master it is stale", () => {
  it("current translation: stale false, English facts template", () => {
    const m = master();
    const d = createLibrary([m, english(m)], [product()]).getDocument({ doc: "privacy", locale: "en", product: "jam" });
    expect([d.stale, d.sections[1]!.blocks[0]]).toEqual([false, { id: "vendors.table", type: "table", head: ["Vendor", "Used for", "Where", "Transfer"], rows: [["Fly.io", "Hosting", "Sverige", "Inden for EU"]] }]);
  });
  it("the master moved on after translation → stale true", () => {
    const old = master("Gammel tekst.");
    const d = createLibrary([master("Ny tekst."), english(master("Ny tekst."), old)], [product()]).getDocument({ doc: "privacy", locale: "en", product: "jam" });
    expect(d.stale).toBe(true);
  });
});

describe("placeholders — merge fields are typed, never ad hoc", () => {
  it("known placeholders are listed on the document", () => {
    const d = createLibrary([master("Aftalen mellem {customer.name} og {provider.name}.")], [product()]).getDocument({ doc: "privacy", locale: "da", product: "jam" });
    expect(d.placeholders).toEqual(["customer.name", "provider.name"]);
  });
  it("an unknown placeholder is refused", () => {
    expect(() => placeholdersIn("Hej {kunde.navn}")).toThrow(/unknown placeholder/);
  });
});
