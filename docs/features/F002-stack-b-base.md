# F002 — @broberg/stack-b-base — Stack B base scaffold

> L0 Rails · scaffold · effort **M** · impact **high** · owner `cardmem`. Status: Backlog. **PRIORITIZED — most-used stack.**
> Graduate-candidate: no — small core npm/scaffold that stays in `components`.

## Motivation
A copy-owned project scaffold (not a runtime dependency) that gives every new Stack B service the same starting skeleton: Bun + Hono 4.6 server entry, pnpm+Turbo monorepo shell, bun:sqlite/libSQL via Drizzle, Zod, Upmetrics error-reporting, Litestream-on-Fly boot script, typed health endpoint, Bearer-auth middleware, in-process rate limiter, and an optional Preact/Vite/Tailwind v4 SPA layer. Stamped once per new project, then owned by that repo. Christian's intent: cardmem should be able to boot a fresh project up straight away from this. The four live Stack B repos — dns-api (minimal), cardmem (full monorepo + SPA + Litestream), buddy (workspace), cctalk (node-adapter) — share the same structural DNA while diverging on domain logic.

## Solution
**scaffold (copy-owned).** Each repo carries divergent domain logic from day one (dns-api: BIND/SSH zones; cardmem: Better Auth + MCP + SSE + Litestream; buddy: PTY + bots + dispatch; cctalk: QR pairing + voice relay). No two server entry files could share a runtime package. The cross-cutting pieces that ARE near-identical (Dockerfile, fly.toml, start.sh, tsconfig.base, health, auth, rate-limiter, turbo.json) are too small + path-interwoven to publish as a heavy runtime dep. Stamp once, diverge freely, sync intentionally. Optionally a tiny `@broberg/stack-b-core` exposes five pure utilities (health, bearer-auth factory, rate-limiter factory, parseEnvFile, shutdownHandler) for repos that want them without copy-paste.

## Scope

### In scope
- Extract scaffold template set from `broberg/cardmem`: `Dockerfile`, `fly.toml`, `start.sh`, `tsconfig.base.json`, `turbo.json`, `pnpm-workspace.yaml`, `apps/server/src/{index,auth}.ts`, `apps/web/{package.json,vite.config.ts}`, `packages/db/src/index.ts`, `packages/shared/src/index.ts`.
- A `create-stack-b` generator with `--no-spa` / `--no-db` flags + optional `@broberg/stack-b-core` (5 pure utilities).

### Out of scope
- Domain logic of any source repo.
- Forcing existing repos to converge (copy-owned, adopt incrementally).
- The Stack A scaffold (F003).

## Architecture

### Best source (reference implementation)
`broberg/cardmem` — most complete Stack B instance: multi-stage Dockerfile (litestream→deps→web-build→runtime), Litestream start.sh, Better Auth + Drizzle, Preact/Vite/Tailwind SPA from the same Bun process, Upmetrics init, bun:sqlite/libSQL dual-driver, health endpoint, SSE, graceful SIGTERM. Already serves scaffold templates via `apps/server/src/scaffold-templates.ts` + `/api/scaffold`.

### Other implementations seen (contract cross-check)
- `webhouse/dns-api` `src/{index,auth,rate-limit,audit}.ts` + `Dockerfile` + `fly.toml` — minimal variant; cleanest standalone auth + rate-limit; 'server-only, no SPA' tier.
- `webhouse/buddy` `apps/server/src/index.ts` — workspace variant; uses @broberg/db-sdk; `bun --hot` dev.
- `cbroberg/cctalk` `server.js` — @hono/node-server (Node) instead of Bun.serve; documents the adapter contract.

### Headless core vs. adapters
- **Core (`@broberg/stack-b-core`, no framework/bun globals):** createHealthResponse(service,version); makeBearerAuthMiddleware(getKey); makeRateLimiter(windowMs,max); parseEnvFile(path) (defensive .env loader from cardmem — PM2 concat bug + Fly-no-file guard); shutdownHandler(stops,server) (SIGINT/SIGTERM, from trail).
- **Stack B target:** generates apps/server (Bun.serve+Hono, idleTimeout:0 for SSE), apps/web (Preact10+Vite5+@tailwindcss/vite), packages/db (Drizzle dual-driver), packages/shared (Zod, health). Fly multi-stage Dockerfile + start.sh Litestream restore-on-boot. Upmetrics gated on UPMETRICS_DSN.
- **Stack A:** N/A by definition — nothing here imports next/*, react, @vercel/*.

### Public API
Generator, not a runtime import:
```
npx @broberg/create-stack-b <name> [--no-spa] [--no-litestream] [--no-db]
```
Generates root package.json, pnpm-workspace.yaml, turbo.json, tsconfig.base.json, Dockerfile, fly.toml (region=arn), start.sh, apps/server (+auth+rate-limit), apps/web (omitted with --no-spa), packages/db (omitted with --no-db), packages/shared, .env.example, CLAUDE.md stub (+cardmem section), .mcp.json stub.

## Stories
- **F002.1** — Extract scaffold template set from cardmem server — _AC:_ generator against a blank dir produces a project that `bun run dev` starts and returns 200 on /health.
- **F002.2** — Add --no-spa and --no-db flags — _AC:_ dns-api shape regenerates cleanly with both flags (no apps/web, no packages/db, Dockerfile/fly.toml adjusted).
- **F002.3** — Publish @broberg/stack-b-core headless utilities — _AC:_ exports the 5 fns, zero framework/bun-global deps, `bun test` green; cardmem + dns-api import without build breakage.
- **F002.4** — Validate scaffold against live dns-api — _AC:_ regenerate with --no-spa --no-db, diff vs dns-api: only domain files differ; structural files match/equivalent.
- **F002.5** — Add CLAUDE.md + .mcp.json stubs to output — _AC:_ generated CLAUDE.md has a filled Project-layout table + canonical cardmem section; new project enrollable in one session.
- **F002.6** — Document Litestream env contract — _AC:_ .env.example lists all six Litestream vars with comments matching start.sh; README explains restore-on-boot, links cardmem Dockerfile.

## Acceptance criteria
1. @broberg/stack-b-base builds + typechecks clean; @broberg/stack-b-core imports no framework/bun globals.
2. Each story (F002.1–F002.6) meets its own AC.
3. Piloted in cardmem and adopted back with no regression (runtime-verified).
4. dns-api regenerates from the scaffold with only domain-specific differences.

## Dependencies
- External: @upmetrics/sdk, hono ^4.6, drizzle-orm, @libsql/client, zod, pnpm, turbo, litestream (pinned binary).
- Related: F031 Greenfield-scaffolder consumes this.

## Rollout
Strangler: 1) extract generator from cardmem (already has /api/scaffold + scaffold-templates.ts); 2) add --no-spa/--no-db; 3) publish create-stack-b; 4) validate by regenerating dns-api + diff; 5) next new Stack B project uses it day one; 6) migration guide for existing repos to adopt stack-b-core utilities.

Graduate-candidate: no — stays in `components`.

## Open Questions
- Generator inside cardmem (existing /api/scaffold infra) or standalone @broberg/create-stack-b? cardmem is lower friction.
- bun:sqlite vs libSQL dual-driver — offer --sqlite-only to skip libsql (~300KB)?
- --node flag for @hono/node-server teams, or out of scope for 'Stack B'?
- pnpm 9 vs 10 — standardise on 10?
- Ship @broberg/stack-b-core runtime pkg, or copy the 5 fns verbatim (under 100 lines — copy-owned defensible)?

## Effort estimate
**M** — owner session: `cardmem`. Reuse model: scaffold.

## Risks
Scaffold drift (four repos already diverged: Dockerfiles, pnpm 9 vs 10, node vs Bun) — mitigated by changelog-driven adoption. Litestream binary pin (0.3.13) needs active bumping — add a renovate rule / TEMPLATES-CHANGELOG note. stack-b-core adds a real dep — keep it extremely thin (5 pure fns) and semver-pin tightly.
