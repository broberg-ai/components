# F032 — create-app CLI + machine-readable manifest (AI product builder)

> L4 Capstone · scaffold · effort **L** · impact **high** · owner `cms`. Status: Backlog.
> Graduate-candidate: YES — should get its own repo + cardmem project (recommendation, confirm with Christian).

## Motivation
A zero-config CLI scaffolder invoked as `npm create @broberg/app my-project` (or `bunx @broberg/create-app`) that writes a complete opinionated project skeleton — CLAUDE.md, .mcp.json, .claude/settings.json, lib stubs, env.example, start.sh — and emits a machine-readable `create-app.manifest.json` recording what was generated, which template version was used, and what env-vars + capabilities the project expects. The manifest is the contract between the scaffolder and downstream tooling (cardmem Init drift-check, Lens enrollment, CI validation): it replaces hand-maintained READMEs with a stable JSON surface agents + scripts can query. Two stack variants from day one: Stack A (Next.js + React) for customer webapps, Stack B (Bun + Hono + Preact) for backend/MCP. This is the capstone 'product builder machine' — built AFTER the L0-L3 packages exist.

## Solution
**scaffold.** The CLI output is a per-project skeleton immediately copy-owned by the target repo — scaffolded once then diverges freely. @webhouse/create-cms proves the pattern (writes config + CLAUDE.md + .mcp.json + package.json + start.sh in one Node pass, hands ownership to the project). cardmem scaffold-templates.ts adds a content-hash manifest + drift detection on top. Neither the files nor their diverged state can be kept in sync as a runtime-package — scaffold is the only honest model. The one runtime-package piece is the headless Prompt Contract engine (PromptContract types, buildSystemPrompt, generatePromptContract from CPM @cpm/shared) — stateless + reused in both CLI + web UI without per-project divergence.

## Scope

### In scope
- Build on `webhouse/cms` `packages/create-cms/src/index.ts` + `docs/features/F147-webapp-blueprint.md`.
- @broberg/create-app-core (ScaffoldManifest types + buildManifest + resolveTemplates + writeScaffold + detectPackageManager + Prompt Contract re-export) + Stack A/B template sets + npm-create bin.

### Out of scope
- Per-project post-scaffold divergence (copy-owned).
- Reimplementing the Prompt Contract engine (re-export from @cpm/shared).

## Architecture

### Best source (reference implementation)
`webhouse/cms` — `packages/create-cms/src/index.ts` (most complete published create-* CLI: PM detection, 8+ scaffold files, coloured progress, install, ships as npm create @webhouse/cms) + `docs/features/F147-webapp-blueprint.md` (the exact two-stack scaffolder + 5-capability contract: auth/content/chat/payments/storage).

### Other implementations seen
- `broberg/cardmem` `apps/server/src/scaffold-templates.ts` + `apps/cli/src/index.ts` — TemplateManifest + TemplateFileEntry (content-hash + semver + per-file sha + drift + stale-on-error caching) = the manifest design to adopt; `cardmem add .` shorthand to interop with.
- `cbroberg/codepromptmaker` `packages/shared/src/prompts/*` + `types/{prompt,runner}.ts` + `packages/cli/bin/cpm.mjs` — headless Prompt Contract engine (PromptContract, buildSystemPrompt RAG few-shot, generatePromptContract, AutonomyLevel/RunnerSession) + a typed Commander CLI without a build step.

### Headless core vs. adapters
- **Core (@broberg/create-app-core, no React/next):** ScaffoldManifest/ScaffoldTemplateEntry types (ported from cardmem TemplateManifest: sha256 + semver + per-file mode); buildManifest(templates) + sha256(s); resolveTemplates(stack, capabilities[], projectName) → ordered ScaffoldTemplate[] for the stack + capability selection (auth/content/chat/payments/storage from F147); writeScaffold(dir, templates, projectName) (fs write loop, manifest-aware); detectPackageManager(); re-exports PromptContract + generatePromptContract from @cpm/shared. No react/next/hono.
- **Stack A (Next 16/React 19/Tailwind v4/shadcn):** template set — app/(public), app/(auth)/login, lib/auth.ts (magic-link + passkey against BROBERG_AUTH_URL), lib/cms.ts, lib/eir.ts (trail chat), lib/stripe.ts (Connect + platform fee), api/revalidate (ICD F145). CLAUDE.md F147 hard-rules (no local auth, no hardcoded content). Adapter supplies template strings + stack:'nextjs' discriminant; imports zero next/* at core.
- **Stack B (Bun/Hono 4.6/Preact/bun:sqlite+Drizzle):** template set — src/index.ts (Hono), src/routes, src/db (Drizzle stub), .mcp.json.example, fly.toml (region arn). Auth via fetch against BROBERG_AUTH_URL (no NextAuth). CLAUDE.md forbids next/*.

### Public API
```ts
export interface ScaffoldManifest { version: string; semver?: string; stack: 'nextjs'|'hono'; capabilities: string[]; files: Array<{name; relative_path; mode; sha}>; generated_at: string }
export function resolveTemplates(stack: 'nextjs'|'hono', capabilities: string[], projectName: string): ScaffoldTemplate[];
export function buildManifest(templates, stack, capabilities): ScaffoldManifest;
export function writeScaffold(dir, templates, projectName): void;
export function detectPackageManager(): 'pnpm'|'yarn'|'npm'|'bun';
export { PromptContract, generatePromptContract } from '@cpm/shared';
// bin: create-app — npm create @broberg/app my-project [--stack nextjs|hono] [--capabilities auth,content,chat]; emits create-app.manifest.json
```

## Stories
- **F032.1** — Manifest-aware scaffold writer — _AC:_ writeScaffold() writes all template files + always emits create-app.manifest.json at root (version = sha256 of sorted file shas, stack, capabilities[], generated_at, per-file {name,relative_path,mode,sha}); a second run with identical inputs produces an identical version hash.
- **F032.2** — Stack A (Next.js) template set — _AC:_ resolveTemplates('nextjs',['auth','content']) covers CLAUDE.md (F147 hard-rules), cms.config.ts, lib/auth.ts, lib/cms.ts, lib/env.ts, .env.example (BROBERG_* vars), app/(auth)/login/page.tsx, api/revalidate/route.ts, .claude/settings.json, start.sh; all write without error; a fresh project passes pnpm tsc --noEmit.
- **F032.3** — Stack B (Bun/Hono) template set — _AC:_ resolveTemplates('hono',['auth']) covers src/index.ts (Hono), src/routes/auth.ts (Bearer client against BROBERG_AUTH_URL), src/db/schema.ts (Drizzle bun:sqlite stub), fly.toml (region arn), .mcp.json.example, CLAUDE.md; generated project runs bun run src/index.ts without import errors.
- **F032.4** — Prompt Contract injection — _AC:_ with ANTHROPIC_API_KEY present, the CLI calls generatePromptContract({description: projectName + capabilities}) + appends the fullPrompt as a ## Prompt Contract section in CLAUDE.md; absent → the section is omitted with a placeholder comment; verified by reading the generated CLAUDE.md in both cases.
- **F032.5** — npm create entry point + PM detection — _AC:_ package.json bin.create-app → dist/index.js; `npm create @broberg/app my-site` (no pre-install) scaffolds + installs with the detected PM + coloured progress (create-cms style); test in a temp dir asserts create-app.manifest.json exists + version is a 64-char hex string.
- **F032.6** — cardmem drift-check interop — _AC:_ the manifest's per-file sha entries match cardmem buildManifest() for the same content (sha256 byte-identical); the cardmem daemon can GET /api/scaffold/templates, buildManifest(), compare version to the committed create-app.manifest.json, and correctly report up-to-date/behind without false positives.

## Acceptance criteria
1. @broberg/create-app-cli builds + typechecks clean; headless core imports no framework packages.
2. Each story (F032.1–F032.6) meets its own AC.
3. Piloted in cms and adopted back with no regression (runtime-verified).
4. A second consumer migrates onto the shared package with identical behaviour (a 2nd new app scaffolded via npm create).

## Dependencies
- F031 — Greenfield-scaffolder (blocks). External: @cpm/shared (Prompt Contract engine), @anthropic-ai/sdk (via @cpm/shared), cardmem scaffold-templates manifest types (port), tsup (build), commander/bun argv.

## Rollout
Strangler: 1) pilot in cms: extract create-cms/src/index.ts into packages/create-app/ adding manifest output + the F147 two-stack template set (create @webhouse/cms keeps working); 2) extract @broberg/create-app-core into components as a published package; 3) port @cpm/cli generate to call the core engine; 4) cardmem scaffold-templates.ts adopts the shared manifest types (replaces inline TemplateManifest); 5) every new customer-webapp onboards via npm create @broberg/app. Then GRADUATE to own repo+project.

Graduate-candidate: YES — should get its own repo + cardmem project (recommendation, confirm with Christian).

## Open Questions
- create-app.manifest.json committed (drift-check needs it) or gitignored (easier to regenerate)? cardmem commits .mcp.json.example, gitignores .mcp.json — same split may apply.
- Prompt Contract step require ANTHROPIC_API_KEY at scaffold time or always optional/deferred? (CPM generatePromptContract throws if absent — graceful fallback needed.)
- Stack B fly.toml: scaffold a real Fly app name (needs fly auth + network) or a placeholder the deploying session fills?
- Package name @broberg/create-app-core or @webhouse/ to match create-cms namespace?

## Effort estimate
**L** — owner session: `cms`. Reuse model: scaffold.

## Risks
Main risk: template-set drift between create-app and cardmem scaffold-templates.ts (two sources of truth for repo contents) — mitigate by cardmem adopting TemplateManifest from @broberg/create-app-core (story 6 AC enforces byte-identical sha256). Secondary: F147 capability stubs (lib/auth.ts, lib/eir.ts) go stale as upstream services evolve — the generated CLAUDE.md must include the module-URL pattern from create-cms (fetch the AI-guide module at build time) so cc-sessions read current contracts, not baked stubs. This is the capstone — it must be built AFTER L0-L3 packages exist (don't scaffold references to packages that aren't published).