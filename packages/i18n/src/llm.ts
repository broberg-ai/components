/**
 * @broberg/i18n/llm — F019.10: fill ONLY the missing keys of a dictionary with
 * an LLM, keep `{placeholders}` byte for byte, never touch an existing key.
 *
 * Dependency-free on purpose: pass any object with the `@broberg/ai-sdk` chat
 * shape (`createAI()` is one). Every call goes to the EU route with no
 * fallback — a fallback is a route, and on the way back it can leave the EU.
 * The `i18n-fill` CLI is the thin wrapper that brings in @broberg/ai-sdk.
 */
import { isPlural, missingKeys, type Dict } from "./index.js";

export interface ChatLike {
  chat(req: {
    system?: string;
    prompt: string;
    override?: { provider: string; model: string };
  }): Promise<{ text: string }>;
}

/** The EU route every translation goes to (Mistral, Paris). */
export const EU_ROUTE = { provider: "mistral", model: "mistral-large-2512" } as const;

export interface FillOptions {
  base: Dict;
  target: Dict;
  /** Source language, e.g. "da". */
  from: string;
  /** Target language, e.g. "en". */
  to: string;
  ai: ChatLike;
}

export interface FillResult {
  /** A new dictionary: the target with the accepted translations added. The input is not mutated. */
  result: Dict;
  filled: string[];
  rejected: { key: string; reason: string; got?: string }[];
}

/** The `{name}` placeholders of a string, sorted — compared as a multiset. */
export function placeholders(s: string): string[] {
  return (s.match(/\{\w+\}/g) ?? []).sort();
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

function getAt(d: Dict, path: string): string | Dict | undefined {
  let node: string | Dict | undefined = d;
  for (const p of path.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = node[p];
  }
  return node;
}

function setAt(d: Dict, path: string, value: string | Dict): void {
  const parts = path.split(".");
  let node = d;
  for (const p of parts.slice(0, -1)) {
    if (typeof node[p] !== "object" || node[p] === null) node[p] = {};
    node = node[p] as Dict;
  }
  node[parts[parts.length - 1]!] = value;
}

export async function fillMissing(opts: FillOptions): Promise<FillResult> {
  const result = structuredClone(opts.target);
  const filled: string[] = [];
  const rejected: FillResult["rejected"] = [];
  const system =
    `You translate user-interface strings from ${opts.from} to ${opts.to}. ` +
    "Reply with ONLY the translated string — no quotes, no explanation. " +
    "Keep every {placeholder} exactly as written, untranslated.";

  const translateOne = async (key: string, text: string): Promise<string | null> => {
    const { text: out } = await opts.ai.chat({ system, prompt: text, override: { ...EU_ROUTE } });
    const got = out.trim();
    if (!got) {
      rejected.push({ key, reason: "empty_translation" });
      return null;
    }
    if (!sameList(placeholders(got), placeholders(text))) {
      rejected.push({ key, reason: "placeholders_changed", got });
      return null;
    }
    return got;
  };

  for (const key of missingKeys(opts.base, opts.target)) {
    const src = getAt(opts.base, key);
    if (typeof src === "string") {
      const t = await translateOne(key, src);
      if (t !== null) {
        setAt(result, key, t);
        filled.push(key);
      }
    } else if (isPlural(src)) {
      // Translate each form the source has; the target falls back to `other`
      // for categories its own language has and the source lacks.
      const forms: Dict = {};
      let ok = true;
      for (const [cat, text] of Object.entries(src)) {
        const t = await translateOne(`${key}.${cat}`, text as string);
        if (t === null) {
          ok = false;
          break;
        }
        forms[cat] = t;
      }
      if (ok) {
        setAt(result, key, forms);
        filled.push(key);
      }
    }
  }
  return { result, filled, rejected };
}
