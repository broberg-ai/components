/**
 * F110.15 — the legal texts update themselves, with no redeploy and no CI job.
 * PORTED from jam (apps/web/src/legal/docs.ts, F001.79, 33fba96) — the owner asked
 * jam to hand its tricks back so every repo need not write this itself.
 *
 *   1. A page is ALWAYS served at once from the latest good template — first the one
 *      bundled in this package; the page never waits for the API.
 *   2. At most once per refreshMs (default a day) per document+locale, the template is
 *      fetched in the BACKGROUND with If-None-Match.
 *   3. Only a template that verifies (verifyTemplate) AND resolves with your own facts
 *      replaces the old one.
 *   4. Any failure keeps the old one.
 * In memory, per process: a restart begins from the bundled templates again.
 */
import { getTemplate, resolveTemplate, verifyTemplate, type LegalTemplate } from "./index.js";
import type { DocId, LegalDocument, Locale, ProductFacts } from "./types.js";

/** The one place the API's address lives. */
export const LEGAL_API_URL = "https://legal.broberg.ai/v1";
export const DEFAULT_REFRESH_MS = 24 * 60 * 60 * 1000;

export interface LegalCacheOptions {
  /** YOUR product's facts (your legal/facts.ts). */
  facts: ProductFacts;
  fetch?: typeof fetch;
  refreshMs?: number;
  baseUrl?: string;
  /** Called when a fetch is rejected and the old template is kept. Default console.warn. */
  onKeepOld?: (key: string, reason: string) => void;
  now?: () => number;
}

type Entry = { template: LegalTemplate; checkedAt: number; inFlight?: Promise<void> };

export function createLegalCache(opts: LegalCacheOptions) {
  const fetchImpl = opts.fetch ?? fetch;
  const refreshMs = opts.refreshMs ?? DEFAULT_REFRESH_MS;
  const baseUrl = opts.baseUrl ?? LEGAL_API_URL;
  const now = opts.now ?? Date.now;
  const keepOld = opts.onKeepOld ?? ((key, reason) => console.warn(`[legal] keeping the old ${key}: ${reason}`));
  const cache = new Map<string, Entry>();

  async function refresh(e: Entry, key: string) {
    try {
      const res = await fetchImpl(`${baseUrl}/${key}.json`, { headers: { "if-none-match": `"${e.template.hash}"` }, signal: AbortSignal.timeout(8000) });
      if (res.status === 304) return;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const t = (await res.json()) as LegalTemplate;
      if (!verifyTemplate(t)) throw new Error("the template does not verify (no sections, or its hash does not match its content)");
      resolveTemplate(t, opts.facts); // must merge with our facts before it may replace the old one
      e.template = t;
    } catch (err) {
      keepOld(key, (err as Error).message);
    }
  }

  return {
    /** The finished document for your product — immediately; starts a background refresh when one is due. */
    get(doc: DocId, locale: Locale): LegalDocument {
      const key = `${doc}.${locale}`;
      let e = cache.get(key);
      if (!e) cache.set(key, (e = { template: getTemplate({ doc, locale }), checkedAt: -Infinity }));
      const t = now();
      if (t - e.checkedAt >= refreshMs && !e.inFlight) {
        e.checkedAt = t;
        const entry = e;
        entry.inFlight = refresh(entry, key).finally(() => { entry.inFlight = undefined; });
      }
      return resolveTemplate(e.template, opts.facts);
    },
    /** Resolves when a refresh in flight for this document has finished (tests, warm-up). */
    settled(doc: DocId, locale: Locale): Promise<void> {
      return cache.get(`${doc}.${locale}`)?.inFlight ?? Promise.resolve();
    },
  };
}
