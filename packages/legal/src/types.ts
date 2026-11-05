/** The documents (components F110). "modules" (F110.17) applies only to a platform with third-party modules. */
export type DocId = "terms" | "privacy" | "trust" | "dpa" | "support" | "modules";
export const DOC_IDS: readonly DocId[] = ["terms", "privacy", "trust", "dpa", "support", "modules"];

/** Danish is the master and prevails (owner, 31 Oct 2026: «Danish wins we are a danish company»). */
export type Locale = "da" | "en";
export const MASTER_LOCALE: Locale = "da";

/**
 * A paragraph-level unit. `id` is stable across versions AND locales — a
 * translation, a diff and a deep link all address the same block.
 * Text may contain merge placeholders like `{customer.name}` (see PLACEHOLDERS);
 * they are filled by the consumer (Contract Manager), never typed into prose.
 */
export type Block =
  | { id: string; type: "p"; text: string }
  | { id: string; type: "note"; text: string }
  | { id: string; type: "list"; items: string[] }
  | { id: string; type: "table"; head: string[]; rows: string[][] }
  /** Generated from the product registry — the only place product facts enter a document. */
  | { id: string; type: "facts"; fact: FactKey };

export interface Section {
  id: string;
  heading: string;
  blocks: Block[];
}

/** One document in one locale, as authored. */
export interface DocumentSource {
  doc: DocId;
  locale: Locale;
  title: string;
  /** ISO date of this version, e.g. "2026-11-15". */
  version: string;
  effectiveFrom: string;
  /** A material change asks for acceptance again (terms); a non-material one notifies. */
  material: boolean;
  /** Not yet legally reviewed — rendered with a visible draft marker. */
  draft: boolean;
  /** For a translation: which master it was translated from. */
  translationOf?: { version: string; sourceHash: string };
  sections: Section[];
}

/** What differs per product — data, never prose. */
export interface ProductFacts {
  id: string;
  name: string;
  /** Where the product's data is stored and processed. */
  hosting: { what: string; where: string }[];
  dataCategories: string[];
  subprocessors: { name: string; purpose: string; location: string; transfer: string }[];
  /** Does the four-part conversation analysis apply to this product? */
  conversationAnalysis: boolean;
  /** Health data (art. 9) — only part 1–3 analysis without explicit consent. */
  healthData: boolean;
  /** F110.17 — only a platform with third-party modules (an App Store) sets this; the "modules" document needs it. */
  modules?: ModuleTermsFacts;
}

/** The numbers and channels in the module-owner terms. The PRODUCT decides them; the text never contains them. */
export interface ModuleTermsFacts {
  /** Who gets what of a module's price. Must add up to 100. e.g. [{ party: "platformen", percent: 30 }, { party: "modulejeren", percent: 70 }] */
  revenueShare: { party: string; percent: number }[];
  /** The fixed operations surcharge, in the product's own words (e.g. "mindst DKK 25,00 pr. app pr. klinik pr. måned"). */
  operationsFee: string;
  paymentProvider: string;
  /** e.g. "månedligt" / "monthly" */
  payoutCadence: string;
  guidelinesNoticeDays: number;
  warningDeadlineDays: number;
  guidelinesUrl: string;
  /** Where a module owner complains (an address or a page). */
  complaints: string;
  /** e.g. "3 hverdage" / "3 working days" */
  complaintsResponse: string;
  exportDays: number;
}
export type FactKey = "hosting" | "dataCategories" | "subprocessors" | "conversationAnalysis" | "moduleTerms";

/** The merge fields Contract Manager fills (contract-manager #5608, 31 Oct 2026). */
export const PLACEHOLDERS = [
  "customer.name", "customer.altName", "customer.cvr", "customer.companyForm", "customer.address",
  "customer.contact.name", "customer.contact.email", "customer.contact.phone",
  "provider.name", "provider.cvr", "provider.address", "provider.contact.name", "provider.contact.email",
  "contract.id", "contract.title", "contract.version", "contract.date", "contract.startDate",
] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

/** A resolved document: what every site, app and agent shows. */
export interface LegalDocument {
  doc: DocId;
  locale: Locale;
  product: string;
  title: string;
  version: string;
  effectiveFrom: string;
  material: boolean;
  draft: boolean;
  /**
   * A translation whose master has moved on since it was translated. It is still
   * returned (so a site never goes blank), but it is NOT current — show the
   * Danish master or a notice, never present it as the governing text.
   */
  stale: boolean;
  sections: ResolvedSection[];
  /** The placeholders this document expects to be filled. */
  placeholders: Placeholder[];
  /** sha256 of the canonical JSON of everything above. What an acceptance records. */
  contentHash: string;
}
export interface ResolvedSection {
  id: string;
  heading: string;
  blocks: ResolvedBlock[];
}
export type ResolvedBlock = Exclude<Block, { type: "facts" }>;
