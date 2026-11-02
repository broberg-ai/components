// components F110.8 — pseudonymisation before a conversation enters the analysis copy.
// The techniques and why are in docs/legal/pseudonymisation-standards.md (EDPB 01/2025,
// ENISA 2019/2021, ISO/IEC 20889/27559, NIST SP 800-188). Pseudonymised data is STILL
// personal data: this module never claims to anonymise, and everything it does not examine
// is returned in `notExamined`, never passed silently as clean.
//
// Web Crypto only, so it runs in Node, Bun and edge runtimes alike.

import { findPersonalData } from "@broberg/secret-scan";

/** The owner's ceiling for the analysis copy (31 Oct 2026). */
export const MAX_RETENTION_MONTHS = 6;

export interface PseudonymiseOptions {
  /**
   * The HMAC key of ONE pseudonymisation domain (e.g. "product analysis"). Keep it in the
   * Secrets Vault, never next to the analysis copy. Rotating it unlinks old pseudonyms from new.
   */
  key: string;
  /** Names the system already knows for this conversation (sender, case parties) — found and replaced. */
  knownNames?: string[];
  /**
   * Optional step that finds OTHER names in the text, e.g. an EU model through @broberg/ai-sdk.
   * Without it, names the system does not know are reported in `notExamined`.
   */
  findNames?: (text: string) => Promise<string[]>;
  /**
   * `"remove"` (default): sentences about health are removed before the copy (art. 9).
   * `"consented"`: only when the person has given EXPLICIT consent to analysis of their content.
   */
  health?: "remove" | "consented";
}

export type NotExamined = "names-not-known" | "health-beyond-keywords" | "addresses" | "indirect-identifiers";

export interface PseudonymisedText {
  text: string;
  /** How many of each kind were replaced — never the values. */
  replaced: Record<"cpr" | "email" | "phone" | "ip" | "name" | "health", number>;
  /** What this step did NOT examine. A consumer must not call the result clean beyond these. */
  notExamined: NotExamined[];
}

const enc = new TextEncoder();

async function hmac(key: string, message: string): Promise<string> {
  if (!key || key.length < 32) throw new Error("pseudonymisation key must be at least 32 characters — use a vault-held secret");
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(message)));
  return [...sig.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A keyed pseudonym for a direct identifier (account id, e-mail, phone, IP). The same value
 * gives the same pseudonym under the same key; without the key it cannot be reversed or
 * guessed (a plain hash of an e-mail can be — ENISA/EDPB). `kind` keeps an e-mail and an
 * account id that happen to share a string from colliding.
 */
export async function pseudonymId(value: string, key: string, kind = "id"): Promise<string> {
  return `${kind}_${await hmac(key, `${kind}\u0000${value.trim().toLowerCase()}`)}`;
}

// Danish health vocabulary — a keyword step, so what it misses is named in notExamined.
const HEALTH = /\b(smert\w*|ondt|diagnos\w*|sygdom\w*|syg|sygemeld\w*|medicin\w*|piller?|operation\w*|opereret|skade[nrs]?|gigt|kræft|depression\w*|angst\w*|gravid\w*|blodtryk\w*|diabetes|sukkersyge|allergi\w*|behandling\w*|fysioterap\w*|genoptræning\w*|hovedpine|migræne|hospital\w*|indlagt|læge[nr]?|symptom\w*|astma|hjerte\w*|psykolog\w*|psykiat\w*|stress\w*)\b/i;
const IPV4 = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
const IPV6 = /\b(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}\b/gi;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * One conversation: names get the SAME marker throughout it («Mette Jensen» and later «Mette»
 * are both [PERSON-1]), and a new conversation starts counting again.
 */
export function createConversation(opts: PseudonymiseOptions) {
  const people = new Map<string, number>(); // lower-cased name part → person number

  function personOf(name: string): number {
    const parts = name.trim().split(/\s+/).filter((p) => p.length >= 2);
    const full = parts.join(" ").toLowerCase();
    // A full name matches only itself; a lone first name may match a person seen in full.
    // («Mette Hansen» and «Mette Jensen» stay two people.)
    const existing = people.get(full); // parts of names seen in full are stored too
    const n = existing ?? (people.size ? Math.max(...people.values()) + 1 : 1);
    people.set(full, n);
    for (const p of parts) if (p.length >= 3 && !people.has(p.toLowerCase())) people.set(p.toLowerCase(), n);
    return n;
  }

  return {
    async pseudonymise(input: string): Promise<PseudonymisedText> {
      const replaced = { cpr: 0, email: 0, phone: 0, ip: 0, name: 0, health: 0 };
      let text = input;

      // 1. Art. 9 first: a health sentence never reaches the copy, whatever else it holds.
      if ((opts.health ?? "remove") === "remove") {
        text = text
          .split(/(?<=[.!?])\s+/)
          .map((s) => (HEALTH.test(s) ? (replaced.health++, "[HELBRED FJERNET]") : s))
          .join(" ");
      }

      // 2. CPR removed, e-mail and phone pseudonymised (positions from @broberg/secret-scan).
      const hits = findPersonalData(text).sort((a, b) => b.start - a.start);
      for (const h of hits) {
        const value = text.slice(h.start, h.end);
        const marker = h.kind === "cpr" ? "[CPR]" : `[${h.kind.toUpperCase()}-${(await pseudonymId(value, opts.key, h.kind)).split("_")[1]}]`;
        replaced[h.kind]++;
        text = text.slice(0, h.start) + marker + text.slice(h.end);
      }
      for (const re of [IPV4, IPV6]) {
        for (const m of [...text.matchAll(re)].reverse()) {
          replaced.ip++;
          text = text.slice(0, m.index!) + `[IP-${(await pseudonymId(m[0], opts.key, "ip")).split("_")[1]}]` + text.slice(m.index! + m[0].length);
        }
      }

      // 3. Names: the ones the system knows, then (if given) the ones a model finds.
      const names = [...(opts.knownNames ?? []), ...(opts.findNames ? await opts.findNames(text) : [])].filter((n) => n.trim().length >= 2);
      for (const name of names) personOf(name);
      // Longest first, so «Mette Jensen» is replaced before «Mette».
      const forms = [...people.keys()].sort((a, b) => b.length - a.length);
      for (const form of forms) {
        const re = new RegExp(`(?<![\\p{L}\\d])${escape(form).replace(/ /g, "\\s+")}(s)?(?![\\p{L}\\d])`, "giu");
        text = text.replace(re, (_m, genitive?: string) => {
          replaced.name++;
          return `[PERSON-${people.get(form)}]${genitive ? "s" : ""}`;
        });
      }

      const notExamined: NotExamined[] = ["addresses", "indirect-identifiers"];
      if (!opts.findNames) notExamined.unshift("names-not-known");
      if ((opts.health ?? "remove") === "remove") notExamined.push("health-beyond-keywords");
      return { text, replaced, notExamined };
    },
  };
}

/** The date a record may be kept until — at most MAX_RETENTION_MONTHS after collection. */
export function keepUntil(collectedAt: Date, months = MAX_RETENTION_MONTHS): Date {
  if (!Number.isInteger(months) || months < 1 || months > MAX_RETENTION_MONTHS) {
    throw new Error(`retention must be 1–${MAX_RETENTION_MONTHS} months (owner's ceiling)`);
  }
  const d = new Date(collectedAt.getTime());
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  if (d.getUTCDate() !== day) d.setUTCDate(0); // 31 Aug + 6 → 28/29 Feb, never 3 Mar
  return d;
}

/** One record in the analysis copy. `subject` is a keyed pseudonym, never the account id. */
export interface AnalysisRecord {
  id: string;
  subject: string;
  text: string;
  collectedAt: string;
  keepUntil: string;
  notExamined: NotExamined[];
}

/** Build a record for the analysis copy: the subject pseudonymised, the text pseudonymised, the deadline set. */
export async function toAnalysisRecord(
  input: { id: string; subjectId: string; text: string; collectedAt: Date },
  conversation: ReturnType<typeof createConversation>,
  key: string,
  months = MAX_RETENTION_MONTHS,
): Promise<AnalysisRecord> {
  const p = await conversation.pseudonymise(input.text);
  return {
    id: input.id,
    subject: await pseudonymId(input.subjectId, key, "subject"),
    text: p.text,
    collectedAt: input.collectedAt.toISOString(),
    keepUntil: keepUntil(input.collectedAt, months).toISOString(),
    notExamined: p.notExamined,
  };
}

/** The app owns the rows; the package owns the rule. */
export interface AnalysisStore {
  listExpired(now: Date): Promise<string[]>;
  delete(ids: string[]): Promise<void>;
}

/** Remove every record whose keepUntil has passed. Returns how many went. */
export async function deleteExpired(store: AnalysisStore, now: Date = new Date()): Promise<number> {
  const ids = await store.listExpired(now);
  if (ids.length) await store.delete(ids);
  return ids.length;
}
