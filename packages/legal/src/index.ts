/**
 * @broberg/legal — components F110. One set of legal documents for every product.
 *
 * Content is data (sections → blocks with stable ids), Danish is the master, product
 * facts come from a registry, and every resolved document carries a version and a
 * contentHash. Sites style and re-flow; there is deliberately no parameter that adds
 * or replaces text.
 */
export { createLibrary, canonicalJson, sourceHash, placeholdersIn } from "./core.js";
export { renderHtml } from "./render.js";
export { sha256Hex } from "./sha256.js";
export * from "./types.js";
export { library, SOURCES } from "./content/index.js";
export { PRODUCTS } from "./content/products.js";

import { library } from "./content/index.js";
/** The fleet's documents: getDocument({ doc, locale, product }). */
export const getDocument = library.getDocument;
