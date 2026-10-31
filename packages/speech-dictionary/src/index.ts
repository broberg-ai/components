import termsData from "../data/terms.json";
import correctionsData from "../data/corrections.json";

export type TermGroup = "product" | "person" | "brand" | "tech";

export interface TermEntry {
  term: string;
  group: TermGroup;
}

export interface CorrectionEntry {
  wrong: string;
  right: string;
  note?: string | null;
  category?: string | null;
  /**
   * F044.2 — is `wrong` ALSO an ordinary Danish word? Then the entry does not
   * fire inside a hyphenated compound: in «API-ruter» the text means the word
   * (the plural of «rute»), not the mishearing of «router». A bare «ruter» in a
   * sentence is still corrected.
   *
   * Absent = false = exactly the behaviour before 0.2.0. In this package's own
   * data/corrections.json every entry ANSWERS the question explicitly (a test
   * refuses one that does not), so a new mishearing cannot slip in unasked.
   */
  alsoDanishWord?: boolean;
}

export const TERMS: TermEntry[] = termsData as TermEntry[];
export const CORRECTIONS: CorrectionEntry[] = correctionsData as CorrectionEntry[];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Unicode-aware whole-word boundary — JS's default \b only treats [A-Za-z0-9_] as
 * word characters, so it silently fails to bound Danish terms containing æ/ø/å
 * (e.g. "søver" never matches \bsøver\b). \p{L}/\p{N} cover any Unicode letter/digit.
 */
function wholeWordPattern(term: string, notInCompound = false): RegExp {
  const escaped = escapeRegExp(term);
  // F044.2 — the hyphen is a word boundary for every entry (unchanged), and
  // additionally NOT a place to fire for an entry that is also a real word.
  const edge = notInCompound ? "\\p{L}\\p{N}_-" : "\\p{L}\\p{N}_";
  return new RegExp(`(?<![${edge}])${escaped}(?![${edge}])`, "giu");
}

function makeApplyCorrections(entries: CorrectionEntry[]) {
  const sorted = [...entries].sort((a, b) => b.wrong.length - a.wrong.length);
  const patterns = sorted.map((e) => ({ pattern: wholeWordPattern(e.wrong, e.alsoDanishWord === true), right: e.right }));
  return function applyCorrections(text: string): string {
    let result = text;
    for (const { pattern, right } of patterns) {
      result = result.replace(pattern, right);
    }
    return result;
  };
}

function makeTerms(entries: TermEntry[]) {
  return function terms(opts?: { groups?: TermGroup[] }): string[] {
    const filtered = opts?.groups ? entries.filter((e) => opts.groups!.includes(e.group)) : entries;
    return filtered.map((e) => e.term);
  };
}

function makeToInitialPrompt(entries: TermEntry[]) {
  const termsFn = makeTerms(entries);
  return function toInitialPrompt(opts?: { groups?: TermGroup[]; maxTerms?: number; preamble?: string }): string {
    let list = termsFn(opts?.groups ? { groups: opts.groups } : undefined);
    if (opts?.maxTerms != null) list = list.slice(0, opts.maxTerms);
    const joined = list.join(", ");
    return opts?.preamble ? `${opts.preamble} ${joined}` : joined;
  };
}

export function terms(opts?: { groups?: TermGroup[] }): string[] {
  return makeTerms(TERMS)(opts);
}

export function corrections(): CorrectionEntry[] {
  return CORRECTIONS;
}

export function toInitialPrompt(opts?: { groups?: TermGroup[]; maxTerms?: number; preamble?: string }): string {
  return makeToInitialPrompt(TERMS)(opts);
}

/** F044.2 — an applyCorrections over YOUR list only (no base data), e.g. to test a list before you ship it. */
export function correctionsApplier(entries: CorrectionEntry[]): (text: string) => string {
  return makeApplyCorrections(entries);
}

export function applyCorrections(text: string): string {
  return makeApplyCorrections(CORRECTIONS)(text);
}

export function extend(opts: { terms?: TermEntry[]; corrections?: CorrectionEntry[] }): {
  terms: (o?: { groups?: TermGroup[] }) => string[];
  corrections: () => CorrectionEntry[];
  toInitialPrompt: (o?: { groups?: TermGroup[]; maxTerms?: number; preamble?: string }) => string;
  applyCorrections: (text: string) => string;
} {
  const mergedTerms = [...TERMS, ...(opts.terms ?? [])];
  const mergedCorrections = [...CORRECTIONS, ...(opts.corrections ?? [])];
  return {
    terms: makeTerms(mergedTerms),
    corrections: () => mergedCorrections,
    toInitialPrompt: makeToInitialPrompt(mergedTerms),
    applyCorrections: makeApplyCorrections(mergedCorrections),
  };
}
