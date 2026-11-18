/**
 * F110.20 — the FILLED document a customer actually accepts.
 *
 * BID (F084.243) requires, for doc "dpa", the filled text itself and a contentHash that is
 * "sha256:" + hex(sha256(utf8(text))). So the text the customer reads, the text BID stores
 * and the hash it checks must be the same bytes — renderText is that one rendering.
 */
import { canonicalJson } from "./core.js";
import { sha256Hex } from "./sha256.js";
import { PLACEHOLDERS, type LegalDocument, type Placeholder, type ResolvedBlock } from "./types.js";

const KNOWN = new Set<string>(PLACEHOLDERS);
const RE = /\{([a-zA-Z.]+)\}/g;

/**
 * Every {placeholder} replaced by its value. Refuses — by name — a placeholder the document
 * needs that `values` lacks, a key that is not a known merge field, and an empty value: a
 * contract with «{customer.name}» or «» where a name should be must never be signable.
 */
export function fillPlaceholders(doc: LegalDocument, values: Partial<Record<Placeholder, string>>): LegalDocument {
  const unknown = Object.keys(values).filter((k) => !KNOWN.has(k));
  if (unknown.length) throw new Error(`unknown placeholder value(s): ${unknown.join(", ")}`);
  const missing = doc.placeholders.filter((p) => typeof values[p] !== "string" || values[p]!.trim() === "");
  if (missing.length) throw new Error(`missing or empty placeholder value(s): ${missing.join(", ")}`);
  const fill = (s: string) => s.replace(RE, (whole, name: string) => (KNOWN.has(name) && values[name as Placeholder] !== undefined ? values[name as Placeholder]! : whole));
  const block = (b: ResolvedBlock): ResolvedBlock =>
    b.type === "list" ? { ...b, items: b.items.map(fill) }
    : b.type === "table" ? { ...b, head: b.head.map(fill), rows: b.rows.map((r) => r.map(fill)) }
    : { ...b, text: fill(b.text) };
  const { contentHash: _old, ...rest } = doc;
  const body = { ...rest, title: fill(doc.title), sections: doc.sections.map((s) => ({ ...s, heading: fill(s.heading), blocks: s.blocks.map(block) })), placeholders: [] as Placeholder[] };
  return { ...body, contentHash: sha256Hex(canonicalJson(body)) };
}

/** Plain text of a document, deterministic: title, then each section's heading and blocks. */
export function renderText(doc: LegalDocument): string {
  const out: string[] = [doc.title, ""];
  for (const s of doc.sections) {
    out.push(s.heading);
    for (const b of s.blocks) {
      if (b.type === "list") out.push(...b.items.map((i) => `- ${i}`));
      else if (b.type === "table") out.push(b.head.join(" | "), ...b.rows.map((r) => r.join(" | ")));
      else out.push(b.text);
    }
    out.push("");
  }
  return out.join("\n");
}

/** What BID checks: "sha256:" + hex(sha256(utf8(text))). */
export function textHash(text: string): string {
  return `sha256:${sha256Hex(text)}`;
}
