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

/** F110.14 — the hash of a whole template as the API serves it (its ETag). */
export function templateHash(src: DocumentSource): string {
  return sha256Hex(canonicalJson(src));
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

/** F110.17 — the "modules" document is meaningless without the product's own numbers: refuse, never render a hollow table. */
function moduleFacts(p: ProductFacts) {
  const m = p.modules;
  if (!m) throw new Error(`product "${p.id}" has no module terms facts (ProductFacts.modules) — the "modules" document needs them`);
  const missing = (["operationsFee", "paymentProvider", "payoutCadence", "guidelinesUrl", "complaints", "complaintsResponse"] as const).filter((k) => !m[k]);
  for (const k of ["guidelinesNoticeDays", "warningDeadlineDays", "exportDays"] as const) if (!Number.isInteger(m[k]) || m[k] < 0) missing.push(k as never);
  if (missing.length) throw new Error(`product "${p.id}": module terms facts missing or invalid: ${missing.join(", ")}`);
  const total = m.revenueShare.reduce((s, r) => s + r.percent, 0);
  if (!m.revenueShare.length || Math.abs(total - 100) > 1e-9) throw new Error(`product "${p.id}": revenueShare must add up to 100 %, got ${total}`);
  return m;
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
    moduleTerms: (p, id) => {
      const m = moduleFacts(p);
      return [{
        id, type: "table", head: ["Hvad", "Gælder"],
        rows: [
          ...m.revenueShare.map((r) => [`Andel til ${r.party}`, `${r.percent} %`]),
          ["Driftstillæg", m.operationsFee],
          ["Betalingsudbyder", m.paymentProvider],
          ["Udbetaling", m.payoutCadence],
          ["Varsel ved ændrede retningslinjer", `${m.guidelinesNoticeDays} dage`],
          ["Frist ved advarsel", `${m.warningDeadlineDays} dage`],
          ["Retningslinjer", m.guidelinesUrl],
          ["Klage", m.complaints],
          ["Svarfrist på klage", m.complaintsResponse],
          ["Eksport efter fjernelse", `${m.exportDays} dage`],
        ],
      }];
    },
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
    moduleTerms: (p, id) => {
      const m = moduleFacts(p);
      return [{
        id, type: "table", head: ["What", "Applies"],
        rows: [
          ...m.revenueShare.map((r) => [`Share to ${r.party}`, `${r.percent} %`]),
          ["Operations surcharge", m.operationsFee],
          ["Payment provider", m.paymentProvider],
          ["Payout", m.payoutCadence],
          ["Notice of changed guidelines", `${m.guidelinesNoticeDays} days`],
          ["Deadline after a warning", `${m.warningDeadlineDays} days`],
          ["Guidelines", m.guidelinesUrl],
          ["Complaints", m.complaints],
          ["Response time on complaints", m.complaintsResponse],
          ["Export after removal", `${m.exportDays} days`],
        ],
      }];
    },
  },
};

function resolveBlock(b: Block, locale: Locale, product: ProductFacts): ResolvedBlock[] {
  if (b.type === "facts") return FACT_TEMPLATES[locale][b.fact](product, b.id);
  return [b];
}

/** One line per block: id, type and shape — what a translation must mirror exactly, in order. */
function shape(src: DocumentSource): string[] {
  return src.sections.flatMap((sec) => [
    `section ${sec.id}`,
    ...sec.blocks.map((b) =>
      b.type === "facts" ? `${b.id} facts:${b.fact}`
      : b.type === "list" ? `${b.id} list:${b.items.length} items`
      : b.type === "table" ? `${b.id} table:${b.head.length}x${b.rows.length}`
      : `${b.id} ${b.type}`,
    ),
  ]);
}

/**
 * F110.4 — every translation must have exactly its master's sections and blocks:
 * same ids, same order, same block types, same list/table size. Returns one line per
 * translation that does not (empty = all in parity). A missing, extra or reordered
 * paragraph is a different document, not a translation of this one.
 */
export function parityProblems(sources: DocumentSource[]): string[] {
  const problems: string[] = [];
  for (const t of sources) {
    if (t.locale === MASTER_LOCALE) continue;
    const m = sources.find((s) => s.doc === t.doc && s.locale === MASTER_LOCALE);
    if (!m) { problems.push(`${t.doc}.${t.locale}: no ${MASTER_LOCALE} master`); continue; }
    const want = shape(m), got = shape(t);
    for (let i = 0; i < Math.max(want.length, got.length); i++) {
      if (want[i] !== got[i]) {
        problems.push(`${t.doc}.${t.locale}: at position ${i} the master has «${want[i] ?? "(end)"}», the translation «${got[i] ?? "(end)"}»`);
        break;
      }
    }
  }
  return problems;
}

/**
 * The library a getDocument reads from: every authored document and every product.
 * Built once; the bundled content and tests construct their own.
 */
export function createLibrary(sources: DocumentSource[], products: ProductFacts[]) {
  const byKey = new Map(sources.map((s) => [`${s.doc}:${s.locale}`, s]));
  const byProduct = new Map(products.map((p) => [p.id, p]));
  if (byKey.size !== sources.length) throw new Error("two sources share a doc + locale");

  /** `stale` overrides the computed value — for a template whose master is not in this library (F110.19). */
  function getDocument(opts: { doc: DocId; locale: Locale; product: string; stale?: boolean }): LegalDocument {
    const product = byProduct.get(opts.product);
    if (!product) throw new Error(`unknown product "${opts.product}" — add it to the product registry`);
    const src = byKey.get(`${opts.doc}:${opts.locale}`) ?? byKey.get(`${opts.doc}:${MASTER_LOCALE}`);
    if (!src) throw new Error(`no document "${opts.doc}"`);
    const master = byKey.get(`${opts.doc}:${MASTER_LOCALE}`);
    const stale = opts.stale ?? (src.locale !== MASTER_LOCALE && (!src.translationOf || !master || src.translationOf.sourceHash !== sourceHash(master)));

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
