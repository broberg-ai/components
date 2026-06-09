---
# Machine-readable header — the Research Adapter worker reads this to ROUTE + PRE-FILTER
# (same "YAML tokens + prose" spirit as DESIGN.md). The prose below is what THIS repo's
# cc session reads when it receives a research task, so it can judge fit fast.
slug: components
name: Components — the @broberg/* shared-component monorepo + design-system universe
stack: [typescript, pnpm-workspaces, turbo, tsup, vitest, next-16, react-19, tailwind-v4, shadcn, bun, hono, preact]
research_interests:
  - design-systems
  - design-tokens               # DESIGN.md, W3C DTCG, Style Dictionary
  - tailwind-v4                  # CSS-first @theme, no v3/legacy
  - shadcn-ui
  - headless-ui-patterns         # headless core + thin per-stack adapters
  - react-19                     # useSyncExternalStore, RSC, hooks
  - cross-framework-adapters     # one core → React + Preact
  - monorepo-tooling             # pnpm workspaces, Turbo, tsup
  - npm-publishing               # OIDC trusted-publisher, provenance, semver
  - component-reuse-models       # runtime-package vs copy-owned vs scaffold
  - design-consistency           # drift prevention, DESIGN.md as contract (F123 seam)
  - accessibility                # WCAG, a11y for shared UI
not_interested:
  - app-business-logic           # the consuming app's own domain
  - backend-infra-deploy         # cms/whop territory
  - llm-ai-internals             # ai-sdk territory
  - observability-cost           # upmetrics territory
  - cms-content-modelling        # cms territory
  - e-commerce-payments          # sanneandersen territory
landing_path: docs/research/
---

# Components — Research Target

> You (the components cc session) just received a **research task**: an article aimed at
> components. Read this to orient WITHOUT spending startup tokens, then judge the article
> against components and land your research per "How to land your research" below.

## What I am
The incubator + home for the small, genuinely-shared **`@broberg/*` core npm packages**, and the home of the **component inventory + vision** (32 epics across 5 layers, in `docs/INVENTORY.md`). Bigger components LEAP/Graduate out into their own owner-repos; components keeps only the small, truly-shared core.

## What I do
- Maintain the **scored inventory** (best-implementation-per-pattern across the estate, with real file refs) as cardmem F-plans.
- Extract those patterns into **`@broberg/*` packages**: a framework-agnostic **headless core** + thin per-stack adapters; ship them to npm (e.g. `@broberg/theme` v0.2.0 — tokens + theme store + DESIGN.md→Tailwind-v4 generator).
- Keep the inventory current as new shared elements land fleet-wide.

## Stack
TypeScript · pnpm workspaces + Turbo · tsup (ESM+CJS+dts) · vitest. **Two target stacks:** Stack A (Next.js 16 / React 19 / Tailwind v4 / shadcn new-york) + Stack B (Bun / Hono / Preact / Tailwind v4). Publishes `@broberg/*` to npm.

## Key concepts (where an idea would plug in)
- **The 5-layer inventory** — L0 rails → L1 identity → L2 shell → L3 domain → L4 capstone.
- **Reuse models** — 📦 runtime-package (identical ≥3 repos) · 📋 copy-owned (diverges per brand) · 🏗️ scaffold · 🔀 hybrid. *Over-sharing is the bigger risk.*
- **Headless core + thin adapters** — shared framework-agnostic TS; no `next/*` in core.
- **DESIGN.md** as the agent-readable design contract (F001.8 ships a DESIGN.md→v4 generator); the **F123 design-consistency gate** seam with cardmem.

## Research interests — judge the article against THESE
Design systems · design tokens (DESIGN.md / W3C DTCG / Style Dictionary) · Tailwind v4 (CSS-first `@theme`) · shadcn/ui · headless-UI / cross-framework adapter patterns · React 19 (`useSyncExternalStore`, RSC) · monorepo tooling (Turbo / pnpm / tsup) · npm publishing (OIDC, provenance) · component reuse/extraction patterns · accessibility · design-drift prevention.
**NOT relevant:** app business logic, backend/infra/deploy, LLM/AI internals, observability/cost, CMS content-modelling, e-commerce/payments — route those to the owning repo.

## Current focus (timely research lands best here)
- **`@broberg/theme`** shipped (F001, v0.2.0) — tokens + store + DESIGN.md→v4 generator.
- Next **L0 core packages** from the inventory: config-single-source (F004), mail (F005), media/R2 (F006), MCP-toolkit (F007).
- **DESIGN.md / F123** seam — components owns the v4 generator + the contract format; cardmem enforces.

## Hard constraints (any adopted idea MUST respect these)
- **Tailwind v4 only** — no v3 / legacy support (the estate standardises on v4).
- **Headless core imports no framework** — no `next/*`, no React/Preact in the core; adapters are thin + per-stack.
- **Copy-owned UI diverges per brand** — don't force one framework/style into a runtime package.
- **`data-testid` on every interactive element** (F086, Lens-ready).
- **No native dialogs/controls; no hardcoded values** (one source, trickle down).
- **Strangler migration** — pilot in one repo → extract → spread; never big-bang.

## How to land your research
Write `docs/research/<slug>.md` in THIS repo via the cardmem landing tool. The doc must answer:
1. **TL;DR** — the article in 2–3 lines.
2. **Relevance to components** — which layer / package / concept above it touches + fit strength (high / med / low) and why.
3. **Adaptation** — concretely how the idea could land (which `@broberg/*` package or inventory epic, real concepts), respecting the Hard constraints.
4. **Next step** — a suggested card / experiment (or "file-and-forget" if low fit). This is the SDLC hand-off into the board.
