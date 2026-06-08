# F003 — Stack A base-scaffold (@broberg/stack-a-base)

> L0 Rails · scaffold · effort **M** · impact **high** · owner `boilerplates-cms`. Status: Backlog.
> LEAP-candidate: no — stays in `components`.

## Motivation
A copy-owned scaffold that stamps a full Next.js 16 / React 19 / Tailwind v4 / shadcn new-york baseline in one shot: App Router layout.tsx with dark-mode flash prevention, a Tailwind v4 CSS-first @theme token file, Navbar + Footer driven by a content/global.json singleton, a lib/content.ts headless reader (getCollection / getDocument / readGlobal over flat JSON), dynamic [slug] routes with generateStaticParams, blog listing + post, BlockRenderer (hero/features/cta), sitemap.ts and robots.ts wired to NEXT_PUBLIC_SITE_URL, standalone output, and a cms.config.ts declaring collections + blocks for the @webhouse/cms admin. The github-variant adds a LiveRefresh component (SSE) for dev hot-reload. Not a runtime library — every project owns its copy.

`nextjs-shadcn-base` is already duplicated across coverletter-generator + senti-website-redesign — this scaffold is what they hand-copy.

## Solution
**scaffold.** Whole-app skeleton; no two sites share an evolution path after stamping. Ruthless rule: whole-app skeletons = scaffold. @webhouse/cms is a runtime dep consumed by the generated project (not copied); the scaffold wrapper is copy-owned. Not labelled hybrid because lib/content.ts is ~100 lines of pure Node fs — trivial to copy, not worth a package boundary.

## Scope

### In scope
- Extract from `webhouse/boilerplates-cms`: `nextjs-boilerplate/src/app/{layout.tsx,globals.css,page.tsx,[slug]/page.tsx,blog/page.tsx,robots.ts,sitemap.ts}`, `src/lib/content.ts`, `src/components/{navbar,footer,block-renderer}.tsx`, `next.config.ts`, `cms.config.ts`, `package.json`; plus `nextjs-github-boilerplate/src/components/live-refresh.tsx`.
- A `create-stack-a` CLI (modeled on cms packages/create-cms) with a `--github` variant flag.

### Out of scope
- Per-brand visual divergence.
- Big-bang migration of running sites.
- The Stack B scaffold (F002).

## Architecture

### Best source (reference implementation)
`webhouse/boilerplates-cms` — the maintained scaffold: two live variants (plain filesystem + GitHub-backed), complete App Router skeleton with dark-mode, Tailwind v4 @theme tokens, headless content reader, block renderer, nav/footer, dynamic routes, sitemap/robots, standalone output, SSE live-refresh.

### Other implementations seen
- `webhouse/cms` `packages/create-cms/src/index.ts` — simpler skeleton generator (lib/content.ts + cms.config.ts only); reference for the minimal variant + the CLI pattern.

### Headless core vs. adapters
- **Core (no React, no next/*):** `lib/content.ts` — pure Node fs/path: getCollection<T>(name), getDocument<T>(collection,slug), readGlobal(); interfaces Document<T>, GlobalData, PageData, PostData, SeoData, Block. cms.config.ts schema (defineConfig/defineCollection/defineBlock) is also framework-agnostic.
- **Stack A:** the full scaffold — layout.tsx, globals.css @theme, Navbar/Footer/BlockRenderer client components, generateStaticParams, sitemap/robots, next.config.ts (standalone + iframe headers), LiveRefresh.
- **Stack B:** only lib/content.ts + cms.config.ts translate; page files/next-specific APIs have no equivalent. No Stack B variant exists yet — a separate future effort.

### Public API
```
npx @broberg/create-stack-a <name> [--github]
```
Stamps the scaffold, detects pnpm/yarn/npm, installs, writes CLAUDE.md, .mcp.json, .claude/settings.json, .env.example, .gitignore, start.sh. Generated surface: src/lib/content.ts, src/app/{layout,page,[slug]/page,blog/page,blog/[slug]/page,sitemap,robots}, src/components/{navbar,footer,block-renderer,article-body}, cms.config.ts, next.config.ts.

## Stories
- **F003.1** — Audit + freeze the canonical nextjs-boilerplate variant — _AC:_ builds clean (next build) on Next latest + React 19 + Tailwind v4; CLAUDE.md Project-layout filled; README documents each file; no dead code.
- **F003.2** — Extract create-stack-a CLI into components — _AC:_ `npx @broberg/create-stack-a my-site` runs end-to-end in a temp dir and produces a project that passes `next build`; writes all dotfiles + start.sh.
- **F003.3** — Add --github variant flag — _AC:_ `--github` stamps the SSE LiveRefresh + /api/content-stream variant; common files shared via a template layer (no nav/footer/content duplication).
- **F003.4** — Tailwind v4 @theme brand layer — _AC:_ globals.css has a delimited `/* BRAND TOKENS */` block; BRANDING.md explains the 5 vars to change; no raw hex outside the block.
- **F003.5** — data-testid anchors on interactive scaffold components — _AC:_ navbar-menu-toggle, navbar-theme-toggle, navbar-link-{slug}, blog-card-{slug}, block-cta-btn-{i}; Lens testid-gap check reports zero new gaps.
- **F003.6** — Publish + smoke-test on a real new site — _AC:_ a real site scaffolded via the published CLI deploys to Fly (arn); sitemap.xml + robots.txt resolve; dark mode no-flash; next build clean + standalone.

## Acceptance criteria
1. @broberg/stack-a-base builds + typechecks clean; headless lib/content.ts imports no React/next/*.
2. Each story (F003.1–F003.6) meets its own AC.
3. Piloted in boilerplates-cms and adopted back with no regression (runtime-verified).
4. One real new site is scaffolded via the CLI (not copy-paste) and deploys.

## Dependencies
- F001 — Design tokens + theme preset (blocks).
- External: @webhouse/cms (^0.2.x runtime dep in generated project), @webhouse/cms-cli, next, react/react-dom, react-markdown+remark-gfm, @tailwindcss/postcss, typescript.
- Related: F031 Greenfield-scaffolder consumes this.

## Rollout
Strangler: 1) audit both boilerplate variants build clean on current stack; 2) extract into packages/stack-a-base with a create-stack-a CLI (modeled on cms create-cms); 3) publish; 4) scaffold the next 1-2 new Stack A sites with it; 5) retire ad-hoc copy-paste, point setup docs at the CLI. Never big-bang running sites.

LEAP-candidate: no — stays in `components`.

## Open Questions
- Ship shadcn/ui stubs (Button, Card) out of the box, or stay vanilla Tailwind?
- next.config.ts X-Frame-Options: ALLOWALL (webhouse.app iframe) — right default for all sites, or opt-in?
- cms.config.ts scaffolded filesystem-only, or wire the github adapter too (needs GITHUB_TOKEN)?
- A minimal variant (no blog/BlockRenderer) for microsites?

## Effort estimate
**M** — owner session: `boilerplates-cms`. Reuse model: scaffold.

## Risks
@webhouse/cms is an evolving external dep — a breaking minor breaks all scaffolded sites that ran update; pin ^0.2.x + document upgrade path. Next.js 'latest' is a moving target — pin ^16 once stable. The github-variant LiveRefresh depends on the /api/content-stream route path — add a Lens smoke test that the SSE endpoint returns 200 in dev.