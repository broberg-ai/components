/**
 * legal.broberg.ai — components F110.5 / F110.14. An API, not a website (owner
 * 1/11 2026: «Det var et API du skulle lave, ikke et live website»). It serves the
 * TEMPLATES; every product fills in its OWN facts (see the package README and the
 * Discovery tip «legal-documents»). Everything that is not the API sends the
 * visitor to the broberg.ai website (REDIRECT_URL, set in fly.toml).
 *
 *   GET /v1/documents                → every template: doc, locale, version, effectiveFrom, draft, hash
 *   GET /v1/{doc}.{locale}.json      → one template (facts slots open), ETag = hash, 304 on If-None-Match
 *   GET /health
 *   anything else                    → 301 to REDIRECT_URL
 */
import { DOC_IDS, getTemplate, listDocuments, type DocId, type Locale } from "../../packages/legal/src/index.ts";

// F110.13 — the texts change only when this app is redeployed, so a day of
// caching is safe; after that a site revalidates with If-None-Match (empty 304).
export const CACHE = "public, max-age=86400, stale-while-revalidate=604800";

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": CACHE, ...(init.headers ?? {}) },
  });

export function route(req: Request, redirectUrl: string | undefined = process.env.REDIRECT_URL): Response {
  const url = new URL(req.url);
  const p = url.pathname;
  if (p === "/health") return json({ ok: true }, { headers: { "cache-control": "no-store" } });
  if (p === "/v1/documents") return json({ documents: listDocuments() });

  const api = /^\/v1\/([a-z]+)\.(da|en)\.json$/.exec(p);
  if (api) {
    const [, doc, locale] = api;
    if (!DOC_IDS.includes(doc as DocId)) return json({ error: "unknown_doc", docs: DOC_IDS }, { status: 404 });
    const t = getTemplate({ doc: doc as DocId, locale: locale as Locale });
    const etag = `"${t.hash}"`;
    if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { etag, "cache-control": CACHE } });
    return json(t, { headers: { etag } });
  }
  if (p.startsWith("/v1/")) return json({ error: "not_found", api: ["/v1/documents", "/v1/{doc}.{da|en}.json"] }, { status: 404 });

  // Not the API: this is not a website. Send people to broberg.ai.
  if (!redirectUrl) return json({ error: "not_found" }, { status: 404 });
  return new Response(null, { status: 301, headers: { location: redirectUrl, "cache-control": CACHE } });
}

export default { port: Number(process.env.PORT ?? 8080), fetch: (req: Request) => route(req) };
