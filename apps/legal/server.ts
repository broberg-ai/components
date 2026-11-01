/**
 * legal.broberg.ai — components F110.5. Read-only: serves the @broberg/legal
 * library and nothing else, so the endpoint and the npm package can never disagree.
 *
 *   GET /v1/products                          → the product ids
 *   GET /v1/{product}/{doc}.{locale}.json     → the resolved document (ETag = contentHash)
 *   GET /{product}/{doc}?lang=da|en           → the same document as a readable page
 *   GET /health
 */
import { DOC_IDS, library, renderHtml, type DocId, type Locale } from "../../packages/legal/src/index.ts";

const LOCALES: Locale[] = ["da", "en"];
const TITLES: Record<DocId, string> = { terms: "Vilkår for brug", privacy: "Privatlivspolitik", trust: "Tillid og sikkerhed", dpa: "Databehandleraftale", support: "Supportaftale" };

// F110.13 — owner 1/11 2026: «De sites der anvender API skal kunne cache de data
// lokalt og kun af og til checke om der er nye data.» The texts change only when
// this app is redeployed, so a day of caching is safe; after that a site asks
// with If-None-Match and gets an empty 304 while nothing changed — and the
// machine, which is cold (min_machines_running = 0), sleeps the rest of the time.
export const CACHE = "public, max-age=86400, stale-while-revalidate=604800";
// Bump when the HTML page template changes, so a cached page is not kept
// after a redesign that left the document text — and its contentHash — alone.
const PAGE_VERSION = "p1";

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": CACHE, ...(init.headers ?? {}) },
  });
const fresh = (req: Request, etag: string) => req.headers.get("if-none-match") === etag;
const notModified = (etag: string) => new Response(null, { status: 304, headers: { etag, "cache-control": CACHE } });

const page = (title: string, body: string) => `<!doctype html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>:root{--bg:#fbfaf7;--fg:#1d1b18;--muted:#6b665e;--line:#e4e0d8;--accent:#b4532a}@media (prefers-color-scheme:dark){:root{--bg:#161513;--fg:#ece8e1;--muted:#a39d93;--line:#2c2a26;--accent:#e08a5f}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,sans-serif}main{max-width:760px;padding:32px 16px 64px}
h1{font-size:28px;line-height:1.2}h2{font-size:19px;margin-top:32px}a{color:var(--accent)}table{border-collapse:collapse;width:100%;font-size:14px;display:block;overflow-x:auto}th,td{border-top:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
.legal-draft{border:1px solid var(--accent);color:var(--accent);padding:8px 12px;border-radius:8px;font-weight:600}.legal-note{color:var(--muted)}.meta{color:var(--muted);font-size:14px}nav a{margin-right:12px}</style></head><body><main>${body}</main></body></html>`;

export function route(req: Request): Response {
  const url = new URL(req.url);
  const p = url.pathname;
  if (p === "/health") return json({ ok: true }, { headers: { "cache-control": "no-store" } });
  if (p === "/v1/products") return json({ products: library.products(), docs: DOC_IDS, locales: LOCALES });

  const api = /^\/v1\/([a-z0-9-]+)\/([a-z]+)\.(da|en)\.json$/.exec(p);
  if (api) {
    const [, product, doc, locale] = api;
    if (!DOC_IDS.includes(doc as DocId)) return json({ error: "unknown_doc" }, { status: 404 });
    if (!library.products().includes(product!)) return json({ error: "unknown_product" }, { status: 404 });
    const d = library.getDocument({ doc: doc as DocId, locale: locale as Locale, product: product! });
    const etag = `"${d.contentHash}"`;
    if (fresh(req, etag)) return notModified(etag);
    return json(d, { headers: { etag } });
  }

  const html = /^\/([a-z0-9-]+)\/([a-z]+)\/?$/.exec(p);
  if (html && DOC_IDS.includes(html[2] as DocId) && library.products().includes(html[1]!)) {
    const locale = (url.searchParams.get("lang") === "en" ? "en" : "da") as Locale;
    const d = library.getDocument({ doc: html[2] as DocId, locale, product: html[1]! });
    const etag = `"${PAGE_VERSION}-${d.contentHash}"`;
    if (fresh(req, etag)) return notModified(etag);
    const nav = DOC_IDS.map((x) => `<a href="/${html[1]}/${x}${locale === "en" ? "?lang=en" : ""}">${TITLES[x]}</a>`).join("");
    const meta = `<p class="meta">Version ${d.version} · gælder fra ${d.effectiveFrom}${d.stale ? " · oversættelsen er ikke opdateret — den danske tekst gælder" : ""} · <a href="/v1/${html[1]}/${html[2]}.${locale}.json">JSON</a></p>`;
    return new Response(page(d.title, `<nav>${nav}</nav>${meta}${renderHtml(d)}`), { headers: { "content-type": "text/html; charset=utf-8", etag, "cache-control": CACHE } });
  }

  if (p === "/") {
    const rows = library.products().map((pr) => `<li><b>${pr}</b> — ${DOC_IDS.map((x) => `<a href="/${pr}/${x}">${TITLES[x]}</a>`).join(" · ")}</li>`).join("");
    return new Response(page("legal.broberg.ai", `<h1>legal.broberg.ai</h1><p>De fælles juridiske tekster for alle broberg.ai-produkter. Dansk er gældende. API: <code>/v1/{produkt}/{dokument}.{da|en}.json</code></p><ul>${rows}</ul>`), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": CACHE } });
  }
  return json({ error: "not_found" }, { status: 404 });
}

export default { port: Number(process.env.PORT ?? 8080), fetch: route };
