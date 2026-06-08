# F020 — SEO / Metadata Helpers (Stack A)

> L2 Shell · runtime-package · effort **M** · impact **high** · owner `cms`. Status: Backlog.
> Graduate-candidate: no — stays in `components`.

## Motivation
Framework-aware helpers that turn CMS document fields (the _seo sub-object) into Next.js Metadata objects, sitemap.ts handlers, robots.ts handlers, JSON-LD structured-data generators, and an OG-image pipeline. The headless core also contains a locale-aware SEO+GEO scorer (13 classic SEO rules + 8 AI-citation/GEO rules) producing a 0-100 Visibility Score usable independently of any framework. Every piece is already in production across multiple WebHouse sites, driven from @webhouse/cms/next.

## Solution
**runtime-package.** All ruthless criteria met. (a) The identical cmsMetadata/cmsSitemap/cmsRobots factories are already consumed verbatim by webhouse-site + cms-docs, and the _seo field contract appears in sanneandersen, sproutlake-site, the boilerplate — 5+ genuine consumers. (b) Stable API (SeoFields, factories, calculateVisibilityScore, JSON_LD_TEMPLATES, generateJsonLd) version-stable across F97/F112/F121. (c) The scorer + JSON-LD list are 350+ lines that would immediately drift if copied. The OG-image Sharp path is cms-admin-specific and stays there.

## Scope

### In scope
- Extract from `webhouse/cms` `packages/cms/src/next/{metadata,sitemap,robots}.ts` + `cms-admin/src/lib/seo/{score,json-ld}.ts`.
- Headless core (scorer, JSON-LD, bot lists, metadata POJO builder, sitemap builder) + Next adapter + Hono adapter.

### Out of scope
- The Sharp OG-image generator (stays in cms-admin / behind a deep import).
- Per-site brand visuals.

## Architecture

### Best source (reference implementation)
`webhouse/cms` — `packages/cms/src/next/{metadata,sitemap,robots}.ts` + `cms-admin/src/lib/seo/{score,json-ld}.ts`: the only place all five concerns (metadata builder, sitemap factory, robots factory, scorer, JSON-LD templates) are fully implemented, production-tested, already exported as @webhouse/cms/next (single source of truth for webhouse-site + cms-docs). scorer + json-ld are framework-agnostic already.

### Other implementations seen
- `webhouse/sanneandersen` `site/src/app/[locale]/layout.tsx` + `behandlinger/[slug]/page.tsx` — per-page generateMetadata consumer with i18n alternates/hreflang + _seo.metaDescription fallback; direct consumer (migration target).
- `webhouse/webhouse-site` `src/app/{sitemap,robots,layout}.ts(x)` — gold-standard 2-line adopter of cmsSitemap + cmsRobots; layout still reads globals directly (gap to plug).
- `webhouse/boilerplates-cms` `nextjs-boilerplate/src/app/{sitemap,robots}.ts` — hand-rolled; shows migration value.

### Headless core vs. adapters
- **Core (no next/react/sharp):** SeoFields/GeoLocation contracts; buildMetadataObject(options) (Metadata-shaped POJO: title/description/openGraph/alternates/keywords/robots/geo, no next import); calculateSeoScore/calculateGeoScore/calculateVisibilityScore/calculateReadability (13+8 rules); JSON_LD_TEMPLATES + autoFillFields + generateJsonLd; bot lists (SEARCH_BOTS/TRAINING_BOTS/TRADITIONAL_BOTS); sitemap entry builder (URL + hreflang).
- **Stack A (Next 16):** cmsMetadata(): Metadata (wraps buildMetadataObject, casts to next Metadata); cmsSitemap(): ()=>MetadataRoute.Sitemap; cmsRobots(): ()=>MetadataRoute.Robots; opengraph-image.tsx RSC via next/og ImageResponse (edge-compatible, no Sharp). From @broberg/seo/next.
- **Stack B (Bun/Hono/Preact):** exports core directly (@broberg/seo/core); seoMiddleware injects <title>/<meta>/<script ld+json> into Preact HTML; sitemapHandler (GET /sitemap.xml) + robotsHandler (GET /robots.txt). No next/*; OG via Sharp server-side if needed.

### Public API
```ts
// @broberg/seo/core
export { JSON_LD_TEMPLATES, autoFillFields, generateJsonLd, calculateSeoScore, calculateGeoScore, calculateVisibilityScore, calculateReadability, SEARCH_BOTS, TRAINING_BOTS, TRADITIONAL_BOTS, buildMetadataObject };
// @broberg/seo/next
export function cmsMetadata(o): Metadata; export function cmsSitemap(o): () => MetadataRoute.Sitemap; export function cmsRobots(o): () => MetadataRoute.Robots;
// @broberg/seo/hono
export function seoMiddleware(o): MiddlewareHandler; export function sitemapHandler(o): Handler; export function robotsHandler(o): Handler;
```

## Stories
- **F020.1** — Extract headless core into @broberg/seo/core — _AC:_ exports buildMetadataObject + calculateVisibilityScore + JSON_LD_TEMPLATES + generateJsonLd + autoFillFields + bot lists; zero next/react/sharp imports; tests cover scorer pass/warn/fail per 13 SEO + 8 GEO rules + JSON-LD for all 12 templates; pnpm build succeeds.
- **F020.2** — @broberg/seo/next adapter (metadata/sitemap/robots) — _AC:_ cmsMetadata → next Metadata, cmsSitemap → ()=>MetadataRoute.Sitemap, cmsRobots → ()=>MetadataRoute.Robots; webhouse-site sitemap.ts + robots.ts import from @broberg/seo/next, produce identical output (snapshot test); strict mode, no any.
- **F020.3** — Edge-compatible OG image via next/og RSC — _AC:_ opengraph-image.tsx using ImageResponse (title/description/siteName/brand colour) renders 1200x630; works on Vercel Edge (no Sharp/Node-only APIs); verified on a preview URL in a social-card previewer.
- **F020.4** — @broberg/seo/hono adapter (Stack B) — _AC:_ seoMiddleware injects title/description/og/ld+json; sitemapHandler returns valid XML; robotsHandler returns valid robots.txt for all four strategies; tested with a Bun+Hono app + XML lint in CI.
- **F020.5** — Migrate sanneandersen to cmsMetadata() — _AC:_ all generateMetadata in [locale]/layout + per-slug pages use cmsMetadata(); hand-rolled alternates.languages replaced by passing locales + defaultLocale; next build succeeds; preview shows correct title/og/canonical/hreflang.
- **F020.6** — Wire seo into boilerplates-cms scaffold — _AC:_ nextjs-boilerplate uses cmsSitemap/cmsRobots/cmsMetadata; a generated project passes an automated check that meta description + og:title are present on home + a content page.

## Acceptance criteria
1. @broberg/seo-metadata builds + typechecks clean; headless core imports no framework packages (no next/react/sharp).
2. Each story (F020.1–F020.6) meets its own AC.
3. Piloted in cms and adopted back with no regression (runtime-verified).
4. A second consumer (webhouse-site or sanneandersen) migrates onto the shared package with identical behaviour.

## Dependencies
- External: @webhouse/cms (CmsDoc types, optional peer), sharp (optional peer, server OG only — edge uses next/og).

## Rollout
Strangler: 1) extract core out of cms next/ + cms-admin/lib/seo/ into @broberg/seo/core (reorg + re-export); 2) @broberg/seo/next re-exporting the three factories, pilot in webhouse-site + cms-docs; 3) publish; 4) migrate sanneandersen (hand-rolled → cmsMetadata) as 2nd consumer; 5) wire into boilerplates-cms scaffold. Each step independently shippable.

Graduate-candidate: no — stays in `components`.

## Open Questions
- locale-aware length limits: inline lookup table or caller-supplied getSeoLimits(locale)? (the require('@/lib/ai/locale-prompt') alias must be resolved first).
- cmsSitemap content-loading: abstract behind getDocuments(collection) callback (CMS-agnostic) or keep @webhouse/cms peer dep?
- OG image pixel-consistency between Sharp (admin) and next/og (edge) — hard requirement or 'good enough on edge'?
- GEO scorer Danish heuristics (er|har|giver|betyder|kan) — externalise as locale rule overrides or keep bilingual regex?

## Effort estimate
**M** — owner session: `cms`. Reuse model: runtime-package.

## Risks
Sharp is a native binary — cannot run on Vercel Edge / CF Workers; keep behind @broberg/seo/sharp deep import, NEVER re-exported from the Next adapter (a misimport pulls Sharp into an edge bundle + breaks deploys silently). GEO scorer rule labels contain emoji — strip before publishing (log-pipeline encoding). The calculateSeoScore require('@/lib/ai/locale-prompt') cms-admin alias must be resolved/inlined before extraction — the single concrete blocker.