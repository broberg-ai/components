# F031 — Cardmem Greenfield-Scaffolder (Plain npm vs pnpm+Turbo monorepo)

> L4 Capstone · scaffold · effort **M** · impact **high** · owner `cardmem`. Status: Backlog.
> Graduate-candidate: no — stays in `components` (engine lives in cardmem; thin core npm here).

## Motivation
A CLI + daemon action that, given a target directory (or a repo slug to create), outputs a complete runnable project skeleton — either a plain npm/Bun single-package project or a pnpm+Turbo monorepo — pre-wired with cardmem onboarding files (.mcp.json, .claude/skills/, hooks, CLAUDE.md sections), an optional GitHub repo, gitignored secrets, and an Init epic. It is the single entry point replacing the current manual copy-from-buddy workflow for net-new repos. Directly fulfils Christian's CB-note: cardmem should scaffold greenfield repos with a Plain (npm) vs monorepo (pnpm+Turbo) choice. Two template flavors minimum: Stack A (Next.js) + Stack B (Bun/Hono), plus a plain monorepo shell. Cloud-served + versioned so a canonical-template change propagates within ~5 min.

## Solution
**scaffold.** The output is a whole-repo skeleton, not a shared runtime library — each generated project owns its files; nothing to sync at runtime. The closest analogue (@webhouse/create-cms) is a one-shot create-* CLI that writes files + exits. cardmem's scaffoldWrite + finalizeScaffold + applyTemplates stack handles the cardmem layer the same way (idempotent writes, copy-owned outputs). runtime-package fails all three tests (output not identical across repos, stack evolves frequently, syncing a package.json template is trivial). Scaffold is correct.

## Scope

### In scope
- Build on `broberg/cardmem` `apps/agent/src/import.ts` + `apps/server/src/scaffold-templates.ts` + `apps/cli/src/index.ts` + `packages/mcp-tools/src/tools/github-repo.ts` (+ F018/F014.7/F060 docs).
- ScaffoldFlavor + TemplateSpec map + scaffoldProject() + detectFlavor() + CLI subcommand + SPA wizard flavor picker.

### Out of scope
- Per-project post-generation divergence (copy-owned).
- Replacing cardmem's existing scaffold engine (this extends it).

## Architecture

### Best source (reference implementation)
`broberg/cardmem` — the canonical production scaffold engine: cloud-served ScaffoldTemplate objects (scaffold-templates.ts), daemon scaffoldWrite/finalizeScaffold/autoFixAllGaps/applyTemplates (import.ts ~1194 lines), `cardmem add .` orchestration (cli/index.ts + actions.ts), GitHub repo creation (github-repo.ts). F018 names the five flavors (next-rsc, bun-hono-preact, mcp-server, monorepo, webhouse-saas-starter). The missing piece = project-level package.json/turbo.json/tsconfig skeletons.

### Other implementations seen
- `webhouse/cms` `packages/create-cms/src/index.ts` — proven published create-* CLI (detects PM, writes tree, installs, prints next steps); the UX the plain-npm mode should feel like.
- `webhouse/boilerplates-cms` `nextjs-boilerplate/` — reference Stack-A content the next-rsc flavor emits; github-variant SSE live-refresh reusable in the Next+GitHub template.

### Headless core vs. adapters
- **Core (no React/next/Hono):** ScaffoldFlavor enum (plain-npm, monorepo, stack-a, stack-b, mcp-server); TemplateSpec map (flavor → [{path, content, mode, section_marker?}], content inline or cloud-fetched matching the ScaffoldTemplate shape); scaffoldProject({flavor, projectName, outDir, mcpKey?, commitAndPush?}) calling existing scaffoldWrite + finalizeScaffold; detectFlavor(localPath); re-exports ScaffoldTemplate/ScaffoldResult/TemplateManifest/sha256 verbatim. pnpm+Turbo path additionally writes pnpm-workspace.yaml + turbo.json + root workspaces package.json. No hono/react/next/preact imports.
- **Stack B (cardmem daemon adapter):** Hono POST /scaffold/create calling scaffoldProject → ScaffoldResult; new daemon route + `cardmem create <flavor> <name>` CLI subcommand.
- **Stack A (SPA wizard adapter):** project-create-panel.tsx gains a flavor picker step; cardmem_create_github_repo gains an optional stack_flavor field selecting the template bundle for the initial commit.

### Public API
```ts
export type ScaffoldFlavor = 'plain-npm'|'monorepo'|'stack-a'|'stack-b'|'mcp-server';
export interface GreenfieldOpts { flavor: ScaffoldFlavor; projectName: string; outDir: string; mcpKey?: string; commitAndPush?: boolean; cardmemTemplates?: ScaffoldTemplate[] }
export function scaffoldProject(opts: GreenfieldOpts): Promise<GreenfieldResult>;
// POST /scaffold/create { flavor, project_name, local_path, commit_and_push? } → GreenfieldResult
// cardmem create stack-a my-new-app [--org broberg-ai] [--public]
```

## Stories
- **F031.1** — Stack-B flavor via `cardmem create` CLI — _AC:_ `cardmem create stack-b my-app` produces a valid Bun/Hono/Preact project at ./my-app (package.json, src/index.ts, tsconfig, .gitignore, CLAUDE.md stub, cardmem scaffold files); `bun install && bun dev` starts the server; requires an existing GitHub repo or --no-github.
- **F031.2** — Stack-A (Next.js 16) flavor — _AC:_ `cardmem create stack-a my-site` produces a Next 16/React 19/Tailwind v4/shadcn App Router skeleton matching boilerplates-cms nextjs-boilerplate; `pnpm install && pnpm dev` renders home at localhost:3000 with no errors; new-york/neutral theme applied.
- **F031.3** — pnpm+Turbo monorepo flavor — _AC:_ `cardmem create monorepo my-mono` produces a pnpm workspace with root pnpm-workspace.yaml + turbo.json (build→test) + apps/web (Next shell) + apps/server (Hono shell); `pnpm install` succeeds; `pnpm build` runs Turbo without errors; cardmem scaffold files at root.
- **F031.4** — SPA wizard flavor picker — _AC:_ /projects/new shows a flavor picker step (plain-npm, stack-a, stack-b, monorepo) before org/repo-name; selecting pre-fills gitignore_template + passes the flavor's seed files to cardmem_create_github_repo; the created repo has the flavor's files in the first commit; data-testid project-create-flavor-picker + project-create-flavor-<name>.
- **F031.5** — Flavor auto-detect on `cardmem add .` — _AC:_ a repo with turbo.json → flavor=monorepo; next.config.ts → stack-a; bun.lockb + hono dep → stack-b; unknown → plain-npm; detection is advisory (logged), doesn't change which files are scaffolded (cardmem scaffold layer is flavor-agnostic).
- **F031.6** — Template drift propagation for flavor files — _AC:_ when a canonical stack-b template file changes in cardmem main, applyTemplates (F075.3) detects the SHA mismatch + updates enrolled repos with auto_update_templates=true; manifest.semver bumped in TEMPLATES-CHANGELOG.md; old-version repos see the update label in the cardmem Audit panel.

## Acceptance criteria
1. @broberg/greenfield-scaffolder builds + typechecks clean; headless core imports no framework packages.
2. Each story (F031.1–F031.6) meets its own AC.
3. Piloted in cardmem and adopted back with no regression (runtime-verified).
4. A second consumer migrates onto the shared package with identical behaviour (a 2nd new repo scaffolded via the CLI).

## Dependencies
- F003 — Stack A base (related). F002 — Stack B base (related). External: cardmem daemon (scaffoldWrite/finalizeScaffold/applyTemplates), cardmem server (cloud templates), cardmem MCP (create_github_repo, initialize_project), pnpm + turbo (dev-machine presence for monorepo), node:fs/child_process.

## Rollout
Strangler: 1) pilot `cardmem create stack-b my-new-app` as a CLI subcommand calling a new /scaffold/create daemon route over the existing scaffoldWrite + finalizeScaffold (zero new infra); 2) once the bundle shape is stable, move it to apps/agent/src/greenfield-templates.ts (still in cardmem); 3) add Stack A + monorepo flavors, validate each against a test repo; 4) wire the SPA wizard flavor picker; 5) once 2+ new repos use it, promote to @broberg/greenfield-scaffolder in components; 6) cardmem daemon imports from the package. Never big-bang.

Graduate-candidate: no — stays in `components`.

## Open Questions
- monorepo apps/web + apps/server: own cardmem board projects or share the root's? (onboarding registers the repo root today.)
- F018 'webhouse-saas-starter' overlap with @webhouse/create-cms — superset that replaces it, or sibling that defers for CMS-backed sites?
- SPA wizard: full skeleton committed by the GitHub App in the seed step (25-file octokit limit) or via post-clone daemon scaffold?
- Stack-A: install shadcn at scaffold time (npx shadcn init, +30s + network) or just config files?
- Version pinning: exact pins (reproducible, stale faster) or ^ ranges (latest patches, day-1 peer conflicts)?

## Effort estimate
**M** — owner session: `cardmem`. Reuse model: scaffold.

## Risks
Security: the greenfield path MUST call finalizeScaffold (not skip it) even for brand-new repos with no prior .mcp.json, so the gitignore rule is committed before any first git add -A (untrackMcpJsonIfTracked + GITIGNORE_RULES). Template freshness: stack templates go stale fast (Tailwind v4 syntax, shadcn changes, Next majors) — the 5-min cloud cache handles hook/skill drift but NOT package.json dep versions (baked into content; manual bump cycle). Monorepo complexity: misconfigured turbo.json pipeline outputs cause silent build failures on first CI run. pnpm version skew: pnpm <8 differs on workspace-protocol resolution — pin engines.pnpm in the root package.json.