import { sha256Hex } from "./sha256.js";
import {
  MASTER_LOCALE,
  PLACEHOLDERS,
  type Block,
  type DocId,
  type DocumentSource,
  type FactKey,
  type LegalDocument,
  type Locale,
  type Placeholder,
  type ProductFacts,
  type ResolvedBlock,
} from "./types.js";

/** Canonical JSON (sorted keys, no whitespace) — the input to every hash. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).filter((k) => obj[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

/** The hash a translation records: the master's AUTHORED content, product-independent. */
export function sourceHash(src: DocumentSource): string {
  return sha256Hex(canonicalJson({ doc: src.doc, version: src.version, sections: src.sections }));
}

const PLACEHOLDER_RE = /\{([a-zA-Z.]+)\}/g;
const KNOWN = new Set<string>(PLACEHOLDERS);

/** Every `{…}` in a text — and a refusal of any name that is not a known merge field. */
export function placeholdersIn(text: string): Placeholder[] {
  const out: Placeholder[] = [];
  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    if (!KNOWN.has(m[1]!)) throw new Error(`unknown placeholder {${m[1]}} — add it to PLACEHOLDERS deliberately, never ad hoc`);
    out.push(m[1] as Placeholder);
  }
  return out;
}

/** Fixed per-locale templates that turn a product fact into blocks. The only route from data to text. */
const FACT_TEMPLATES: Record<Locale, Record<FactKey, (p: ProductFacts, id: string) => ResolvedBlock[]>> = {
  da: {
    hosting: (p, id) => [{ id, type: "table", head: ["Hvad", "Hvor"], rows: p.hosting.map((h) => [h.what, h.where]) }],
    dataCategories: (p, id) => [{ id, type: "list", items: p.dataCategories }],
    subprocessors: (p, id) => [
      { id, type: "table", head: ["Leverandør", "Bruges til", "Hvor", "Overførsel"], rows: p.subprocessors.map((s) => [s.name, s.purpose, s.location, s.transfer]) },
    ],
    conversationAnalysis: (p, id) => [
      {
        id,
        type: "p",
        text: p.conversationAnalysis
          ? `${p.name} er omfattet af afsnittet om analyse af samtaler.`
          : `${p.name} er ikke omfattet af afsnittet om analyse af samtaler.`,
      },
    ],
  },
  en: {
    hosting: (p, id) => [{ id, type: "table", head: ["What", "Where"], rows: p.hosting.map((h) => [h.what, h.where]) }],
    dataCategories: (p, id) => [{ id, type: "list", items: p.dataCategories }],
    subprocessors: (p, id) => [
      { id, type: "table", head: ["Vendor", "Used for", "Where", "Transfer"], rows: p.subprocessors.map((s) => [s.name, s.purpose, s.location, s.transfer]) },
    ],
    conversationAnalysis: (p, id) => [
      {
        id,
        type: "p",
        text: p.conversationAnalysis
          ? `${p.name} is covered by the section on conversation analysis.`
          : `${p.name} is not covered by the section on conversation analysis.`,
      },
    ],
  },
};

function resolveBlock(b: Block, locale: Locale, product: ProductFacts): ResolvedBlock[] {
  if (b.type === "facts") return FACT_TEMPLATES[locale][b.fact](product, b.id);
  return [b];
}

/**
 * The library a getDocument reads from: every authored document and every product.
 * Built once; the bundled content and tests construct their own.
 */
export function createLibrary(sources: DocumentSource[], products: ProductFacts[]) {
  const byKey = new Map(sources.map((s) => [`${s.doc}:${s.locale}`, s]));
  const byProduct = new Map(products.map((p) => [p.id, p]));
  if (byKey.size !== sources.length) throw new Error("two sources share a doc + locale");

  function getDocument(opts: { doc: DocId; locale: Locale; product: string }): LegalDocument {
    const product = byProduct.get(opts.product);
    if (!product) throw new Error(`unknown product "${opts.product}" — add it to the product registry`);
    const src = byKey.get(`${opts.doc}:${opts.locale}`) ?? byKey.get(`${opts.doc}:${MASTER_LOCALE}`);
    if (!src) throw new Error(`no document "${opts.doc}"`);
    const master = byKey.get(`${opts.doc}:${MASTER_LOCALE}`);
    const stale = src.locale !== MASTER_LOCALE && (!src.translationOf || !master || src.translationOf.sourceHash !== sourceHash(master));

    const sections = src.sections.map((s) => ({
      id: s.id,
      heading: s.heading,
      blocks: s.blocks.flatMap((b) => resolveBlock(b, src.locale, product)),
    }));
    const texts = sections.flatMap((s) => [s.heading, ...s.blocks.flatMap((b) => ("text" in b ? [b.text] : "items" in b ? b.items : [...b.head, ...b.rows.flat()]))]);
    const placeholders = [...new Set(texts.flatMap(placeholdersIn))].sort();

    const body: Omit<LegalDocument, "contentHash"> = {
      doc: src.doc,
      locale: src.locale,
      product: product.id,
      title: src.title,
      version: src.version,
      effectiveFrom: src.effectiveFrom,
      material: src.material,
      draft: src.draft,
      stale,
      sections,
      placeholders,
    };
    return { ...body, contentHash: sha256Hex(canonicalJson(body)) };
  }

  return { getDocument, products: () => [...byProduct.keys()], sources: () => [...sources] };
}
