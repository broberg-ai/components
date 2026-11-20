# F115 - Supply-chain and code security

Owner order 20/11 2026: security must be as strong as it can be for every package and every dependency, measured against global services and standards. LLM review (security-review, code-review) stays a supplement. Everything that may block a release must be deterministic and able to go red.

## What already exists (measured 20/11 2026)
- secret-gate (gitleaks, full history, self-test) in test.yml
- dependency-health daily: pnpm audit + OSV.dev + CISA KEV, data/dependency-health.json. NOT blocking.
- advisory-watch reusable workflow with a gate mode. Not wired into this repo's own test.yml or publish.yml.
- sso-security gate (packaged artefact + consumer tree). sso only.
- publish via OIDC Trusted Publisher with --provenance and pnpm install --frozen-lockfile
- image-hygiene for Fly apps
- GitHub secret scanning + push protection enabled

## Gaps (one story each)
1. Release gate: a high/critical advisory blocks test and publish (advisory-watch gate mode + .github/advisory-ack.json)
2. Static analysis: CodeQL for JS/TS, blocking on high/critical
3. Automatic dependency updates: Dependabot version + security updates, grouped
4. SBOM (CycloneDX) per package at release + npm audit signatures
5. Install-script and young-version defence: pnpm onlyBuiltDependencies allowlist + minimumReleaseAge
6. Pin every GitHub Action to a commit SHA, plus a gate that fails on an unpinned one
7. Repo settings: secret-scanning extra patterns + validity checks (additive). Branch protection is an owner decision.
8. Tarball content audit for every package (generalises the sso gate)

## Rules for every story
- Deterministic, red-able, with a self-test or mutation proving it can fail.
- A gate that turns red on existing findings ships with an explicit, reasoned acknowledgement list, never a silenced rule.
- Visible: result shows in the CI run summary and the existing dependency-health / Discovery data where relevant.
