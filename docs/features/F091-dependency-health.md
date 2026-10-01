# F091 — Dependency health in every repo

## The order

Christian, 1/10 2026: *«Vi skal have kigget på npm dependencies, er der drift, er der sikkerheds huller der skal lappes, er der nye versioner vi sagtens kan følge med op hos — det skal selvfølgelig køre i hvert repo med respekt for den løsning der er udviklet og kører.»* Not necessarily an npm package; CI scripts or similar.

Three questions, per repo and across the fleet:
1. **Security holes**: a known vulnerability in something we install.
2. **New versions**: what we could move up to without trouble.
3. **Drift**: the same dependency at different versions in different repos.

## The constraint that shapes everything: «respect the solution that runs»

- **Nothing changes a repo without passing that repo's own gate.** Updates arrive as pull requests; the repo's existing CI decides.
- **Measuring is separate from changing.** The scanner is read-only. Changing is done by PRs, and blocking only by the narrow rule in F091.3.
- **Major versions are never automatic.** A major is a PR on its own, and a session or Christian takes it deliberately.
- **Exact pins stay exact.** The fleet pins `@broberg/*` exactly on purpose (D-…: exact-pin prod-auth deps). Updates bump the pin; they never loosen it to a range.
- **Each repo adopts on its own clock** (D-5f65b6 spirit). components builds the tool; owners take it in.

## Design: same shape as the secret gate (F090)

| Part | What | Changes a repo? |
|---|---|---|
| **deps-health** (F091.1) | Reusable workflow (`workflow_call`) in broberg-ai/components. Detects npm/pnpm/bun and workspaces, runs the package manager's own `audit` + `outdated`, writes one JSON report. Weekly + on PR. | No, read-only |
| **Dependabot template** (F091.2) | GitHub's own updater (free, no app). Weekly. Patch+minor **grouped into one PR**, each major its own PR, security updates on, `versioning-strategy: increase` so pins stay pins. | Opens PRs; the repo's gate decides |
| **Block rule** (F091.3) | deps-health fails only on a **high/critical vuln with a fix available**, not on the repo's reviewed-ignore list (each entry with an expiry date). Everything else stays a report. | Blocks deploy only then |
| **Fleet view** (F091.4) | Weekly report built on F083's existing fleet scan (it already reads every package.json in every repo). Adds versions-in-use per shared dependency (drift) and the per-repo vuln/outdated counts. Lands in cardmem as an artifact. | No |
| **Rollout** (F091.5) | Each owner session adds two small files. | Each owner does it |

Why Dependabot and not a home-made updater: it is GitHub-native, free, already understands npm/pnpm/bun workspaces, and opens normal PRs that hit each repo's existing gate. A home-made bot would duplicate it and still need the same gate.

## Open question for Christian (the one decision that is his)

**May patch/minor update PRs merge themselves when the repo's own gate is green?**
- **Yes** (recommended for security fixes at least): holes get closed without anyone pressing a button. The house rule "a green gate is the order" (F302) already points this way.
- **No**: every update waits for a session to merge it; safer, but updates pile up, which is how drift happens.

Majors stay manual either way.

## Non-goals

- Rewriting a repo's dependencies or changing its package manager.
- Upgrading majors automatically.
- Python/Swift/Docker images (npm ecosystems first; Dependabot can add those later per repo).

## Reuse

- F083 `scripts/scan-fleet-deps.mjs` + `data/fleet-deps.json`: already a daily, auto-discovering scan of every package.json in the fleet. F091.4 extends it instead of building a second scanner.
- F090 secret-gate: the reusable-workflow + pinned-tag + self-test pattern is copied, not reinvented.
- Dependabot (GitHub-native) for the update PRs. Discovery has no `@broberg/*` dependency-update package; none is needed.
