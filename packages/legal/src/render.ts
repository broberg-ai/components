import type { LegalDocument, ResolvedBlock } from "./types.js";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function block(b: ResolvedBlock): string {
  const id = ` data-legal-id="${esc(b.id)}"`;
  switch (b.type) {
    case "p":
      return `<p${id}>${esc(b.text)}</p>`;
    case "note":
      return `<p class="legal-note"${id}>${esc(b.text)}</p>`;
    case "list":
      return `<ul${id}>${b.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
    case "table":
      return `<table${id}><thead><tr>${b.head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${b.rows
        .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`)
        .join("")}</tbody></table>`;
  }
}

/**
 * Semantic HTML a site can style and re-flow. Every section and block carries
 * `data-legal-id`; the root carries the version and contentHash so a page (and
 * the F110.11 fleet check) can prove which text it shows. Content is escaped and
 * never altered.
 */
export function renderHtml(doc: LegalDocument): string {
  const draft = doc.draft ? `<p class="legal-draft" data-legal-id="draft">${doc.locale === "da" ? "UDKAST — ikke gældende endnu" : "DRAFT — not yet in force"}</p>` : "";
  return `<article class="legal" lang="${doc.locale}" data-legal-doc="${doc.doc}" data-legal-version="${esc(doc.version)}" data-legal-hash="${doc.contentHash}"><h1>${esc(doc.title)}</h1>${draft}${doc.sections
    .map((s) => `<section data-legal-id="${esc(s.id)}"><h2>${esc(s.heading)}</h2>${s.blocks.map(block).join("")}</section>`)
    .join("")}</article>`;
}
