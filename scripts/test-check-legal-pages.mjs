#!/usr/bin/env node
// F110.11 — the legal-pages check must refuse every way a page can show the wrong text,
// and must not refuse a page that only STYLES the text (sites may style and re-flow).
import { judgePage, textOf } from "./check-legal-pages.mjs";

let failed = 0;
const check = (name, ok, detail = "") => {
  if (ok) console.log(`  ✓ ${name}`);
  else { failed++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ""}`); }
};

const template = {
  doc: "terms",
  version: "2026-11-02",
  sections: [
    { id: "ai", heading: "AI", blocks: [{ id: "ai.p1", type: "p", text: "AI'en foreslår — du beslutter." }] },
    { id: "lov", heading: "Lov", blocks: [{ id: "lov.p1", type: "p", text: "Dansk ret & danske domstole." }, { id: "lov.facts", type: "facts", fact: "hosting" }] },
    { id: "parter", heading: "Parter", blocks: [{ id: "parter.p1", type: "p", text: "Kunden: {customer.name}." }] },
  ],
};
const page = (o = {}) => `<html><body><main>
<article class="legal fancy" data-legal-doc="${o.doc ?? "terms"}" data-legal-version="${o.version ?? "2026-11-02"}" data-legal-hash="x">
  <section data-legal-id="ai"><h2>AI</h2>
    <p class="text-lg" data-legal-id="ai.p1">${o.ai ?? "AI&#39;en foreslår —\n   <em>du</em> beslutter."}</p></section>
  ${o.dropLov ? "" : `<section data-legal-id="lov"><p data-legal-id="lov.p1">Dansk ret &amp; danske domstole.</p></section>`}
  <section data-legal-id="parter"><p data-legal-id="parter.p1">Kunden: ACME ApS.</p></section>
</article></main></body></html>`;

console.log("check-legal-pages — judgePage");
check("a current page that only styles and re-flows the text is green", judgePage(page(), "terms", template).length === 0, JSON.stringify(judgePage(page(), "terms", template)));
check("a hand-written page (no data-legal-doc) is red and says so", /does not render terms/.test(judgePage("<p>Vores vilkår …</p>", "terms", template)[0] ?? ""));
check("a page rendering ANOTHER document is red", judgePage(page({ doc: "privacy" }), "terms", template).length === 1);
check("an old version is red, naming both versions", judgePage(page({ version: "2026-10-31" }), "terms", template).some((p) => p.includes("2026-10-31") && p.includes("2026-11-02")));
check("an edited paragraph is red even with the right attributes", judgePage(page({ ai: "AI'en bestemmer." }), "terms", template).some((p) => p.includes("ai.p1 differs")));
check("a dropped paragraph is red", judgePage(page({ dropLov: true }), "terms", template).some((p) => p.includes("lov.p1 is missing")));
check("a filled merge field is not a difference (consumers fill placeholders)", !judgePage(page(), "terms", template).some((p) => p.includes("parter.p1")));
check("textOf strips tags and decodes entities", textOf(page(), "lov.p1") === "Dansk ret & danske domstole.");

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log("\nall green");
