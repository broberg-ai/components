/**
 * @broberg/legal — components F110. One set of legal documents for every product.
 *
 * Content is data (sections → blocks with stable ids), Danish is the master, and
 * every resolved document carries a version and a contentHash. F110.14: components
 * serves the TEMPLATES (legal.broberg.ai is an API); each product fills in its OWN
 * facts — hosting, data categories, sub-processors, conversation analysis — through
 * fixed templates. Sites style and re-flow; there is deliberately no parameter that
 * adds or replaces text.
 */
import { createLibrary, sourceHash, templateHash } from "./core.js";
import { SOURCES } from "./content/index.js";
import { MASTER_LOCALE, type DocId, type DocumentSource, type LegalDocument, type Locale, type ProductFacts } from "./types.js";

export { createLibrary, canonicalJson, sourceHash, templateHash, placeholdersIn, parityProblems } from "./core.js";
export { renderHtml } from "./render.js";
export { sha256Hex } from "./sha256.js";
export * from "./types.js";
export { SOURCES } from "./content/index.js";
export { EXAMPLE_FACTS } from "./content/example.js";
export { createLegalCache, LEGAL_API_URL, DEFAULT_REFRESH_MS, type LegalCacheOptions } from "./cache.js";
export {
  BID_URL, BidConsentError, getAcceptance, getConsent, needsReaccept, recordAcceptance, recordConsent, toBidHash,
  type AcceptanceRecord, type AcceptedDoc, type BidCallOptions, type ConsentRecord,
} from "./bid.js";

/** A template as the API serves it: the authored document with its facts slots, plus its hash. */
export interface LegalTemplate extends DocumentSource {
  /** A translation made from an older master — show the Danish one or a notice. */
  stale: boolean;
  /** sha256 of the canonical template: the ETag, and what a site compares to see if it is new. */
  hash: string;
}

function pick(doc: DocId, locale: Locale): { src: DocumentSource; stale: boolean } {
  const master = SOURCES.find((s) => s.doc === doc && s.locale === MASTER_LOCALE);
  if (!master) throw new Error(`no document "${doc}"`);
  const src = SOURCES.find((s) => s.doc === doc && s.locale === locale) ?? master;
  const stale = src.locale !== MASTER_LOCALE && src.translationOf?.sourceHash !== sourceHash(master);
  return { src, stale };
}

/** The template for one document — what GET /v1/{doc}.{locale}.json returns. A missing translation falls back to Danish. */
export function getTemplate(opts: { doc: DocId; locale: Locale }): LegalTemplate {
  const { src, stale } = pick(opts.doc, opts.locale);
  return { ...src, stale, hash: templateHash(src) };
}

/**
 * F110.15 — does a template fetched from the API verify? The hash covers the AUTHORED
 * template only, WITHOUT the API's own fields (`stale`, `hash`) — recomputing it over
 * the whole response never matches (measured by jam on 0.2.0). Also requires sections.
 */
export function verifyTemplate(t: unknown): t is LegalTemplate {
  if (!t || typeof t !== "object") return false;
  const { hash, stale: _stale, ...authored } = t as LegalTemplate;
  if (typeof hash !== "string" || !Array.isArray(authored.sections) || authored.sections.length === 0) return false;
  return templateHash(authored as DocumentSource) === hash;
}

/** Every template's version and hash — GET /v1/documents. Cheap «is there anything new?». */
export function listDocuments(): { doc: DocId; locale: Locale; version: string; effectiveFrom: string; draft: boolean; hash: string }[] {
  return SOURCES.map((s) => ({ doc: s.doc, locale: s.locale, version: s.version, effectiveFrom: s.effectiveFrom, draft: s.draft, hash: templateHash(s) }));
}

/** A finished document for YOUR product: the bundled template + your own facts. */
export function getDocument(opts: { doc: DocId; locale: Locale; facts: ProductFacts }): LegalDocument {
  return createLibrary(SOURCES, [opts.facts]).getDocument({ doc: opts.doc, locale: opts.locale, product: opts.facts.id });
}

/** A finished document from a template you fetched from the API + your own facts. */
export function resolveTemplate(template: DocumentSource | LegalTemplate, facts: ProductFacts): LegalDocument {
  const { doc, locale, title, version, effectiveFrom, material, draft, translationOf, sections } = template;
  // F110.19 — the library below holds ONLY this template, so it cannot see the Danish master
  // and would call every translation stale; stale is inside contentHash, so the hash differed
  // from getDocument's (measured by mailworker on terms/en). The API's own answer wins; a bare
  // template's OWN translationOf is judged against the bundled master, as getTemplate would.
  const master = SOURCES.find((s) => s.doc === doc && s.locale === MASTER_LOCALE);
  const stale = "stale" in template && typeof template.stale === "boolean"
    ? template.stale
    : locale !== MASTER_LOCALE && (!master || translationOf?.sourceHash !== sourceHash(master));
  return createLibrary([{ doc, locale, title, version, effectiveFrom, material, draft, translationOf, sections }], [facts]).getDocument({ doc, locale, product: facts.id, stale });
}
