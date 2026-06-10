# F035 — @broberg/secret-scan: fleet secret-redaction primitive

**Status:** in progress — v0.1.0 publishes this turn; **Done is GATED on trail's migration + re-validation** (see Acceptance criteria).
**Owner:** `components` (publishes the npm + curates the canonical pattern set).
**Lifted from:** `broberg/trail` **F197** — detector `packages/shared/src/secret-scan.ts`; handoff brief `docs/features/F197-secret-scan-handoff.md` (written for this extraction); trail plan-doc `F197-secret-scan-gate.md`. Canonical source = trail `main` (commit `b3f07e8`/`10a15a9`, 2026-06-10).
**End-state (Christian):** components owns + publishes `@broberg/secret-scan`; `@trail/shared` re-exports it (`export * from '@broberg/secret-scan'`); every fleet repo installs it and calls `redactSecrets` at its write + egress boundaries.

## Motivation
The fleet's cc sessions dogfood their decisions into a shared second-brain KB. Those sessions handle real credentials — a session that pastes a key into a note **commits a live secret into the wiki**, which then syncs/replicates = effectively leaked. Not hypothetical: trail's retro-scan found **9 real leaked keys** already in the `buddy-sessions` KB (6 upmetrics `uk_`, 3 cardmem Bearer). A single, neutral, audited **secret-redaction standard** belongs in one shared place — not copy-pasted per repo where it drifts. components is that neutral home (the same family as `@broberg/fleet-client` / `ai-sdk`).

## Scope (in)
1. **Lift trail's pure detector verbatim** into `packages/secret-scan/src/index.ts`: the ordered `SECRET_PATTERNS` (~28 named, low-false-positive regexes), `redactSecrets`, `hasSecret`, `redactionMarker`, and types `SecretPattern` / `RedactionFinding` / `RedactionResult`. Keep the API names identical so trail's re-export is drop-in.
2. **Add a backward-compatible `extraPatterns` option** — `redactSecrets(text, { extraPatterns? })` / `hasSecret(text, { extraPatterns? })`. Consumer/per-tenant patterns run **after** the canonical set (canonical attribution wins). `redactSecrets(text)` keeps working unchanged. This is the backend hook for Christian's future self-service "paste a key → detector" UI (trail F197.2/.3).
3. **Ship ESM + CJS + d.ts** (tsup), exports surfacing exactly the names above, mirroring `@broberg/theme`'s monorepo conventions (pnpm workspace + turbo + tsup).
4. **Port trail's verify sweep as the package regression fixture** (vitest): one positive sample per pattern, benign 0-FP guards (git shas, sha256, UUIDs, URLs, code, no-digit `re_`), order-sensitivity assertions, byte-identical clean input, finding counts, and the `extraPatterns` path.
5. **Publish v0.1.0 to npm** (bootstrap token this turn).

## Scope (out / follow-ups)
- **Retro-scan TOOL with live I/O stays consumer-side.** trail keeps its `scan-kb-secrets.ts` (it PUTs to trail's API), now importing `redactSecrets` from the npm. The npm core stays pure/dep-free; a generic record-scanner can be added later if ≥2 repos need it (YAGNI for v0.1.0).
- **Self-service per-tenant pattern UI** (trail F197.2/.3) — `extraPatterns` is the hook; the UI is not in this package.
- **OIDC trusted-publishing + CI** (mirror `theme`'s `publish.yml`, tag `secret-scan-v*`) — **Christian sets this up post-bootstrap**; v0.1.0 is hand-published with the token he provided.

## Architecture
- **Pure, dependency-free, deterministic** — regex + string only, no I/O, `lib: ES2022`, no DOM/node. So the same detection runs in a Hono engine gate, a CLI, an admin preview UI, and any repo; trivially testable.
- **Order-sensitive (load-bearing):** most-specific patterns run before generic ones (`sk-ant-` before OpenAI `sk-`; `sk-or-v1-` (OpenRouter) before `sk-`). Each match is consumed before the next pattern runs → order = attribution. A test asserts it.
- **Never a bare high-entropy/hex pattern** (the single biggest FP trap — would hit git shas). Prefix-less service secrets are caught only via the `labeled-hex-secret` name-context pattern: a 40+ hex value assigned to a field whose *name* contains secret/token/password/api-key.
- **Redact, don't reject** — replace the secret substring with `[REDACTED:<label>]`, keep the surrounding knowledge.

## Public API
```ts
interface SecretPattern { label: string; description: string; regex: RegExp; } // global regex
interface RedactionFinding { label: string; count: number; }
interface RedactionResult { redacted: string; findings: RedactionFinding[]; }
interface RedactOptions { extraPatterns?: SecretPattern[]; }

const SECRET_PATTERNS: SecretPattern[];                               // ordered most-specific → least
function redactSecrets(text: string, opts?: RedactOptions): RedactionResult; // pure; clean input → byte-identical, findings:[]
function hasSecret(text: string, opts?: RedactOptions): boolean;
function redactionMarker(label: string): string;                     // `[REDACTED:${label}]`
```

## Two recommended integration shapes (documented in README)
- **Write boundary** — `redactSecrets(text)` before persist (ingest gate): secrets never enter storage.
- **Egress** — scrub before a value leaves to a user/LLM (the chat retrieved-context scrub is the highest-value guard: the model never sees the secret).

## Dependencies
**Runtime: none.** Dev: tsup, typescript, vitest. No framework, no node/DOM in core.

## Rollout
1. Build + test + publish `@broberg/secret-scan` v0.1.0 (this turn; bootstrap token).
2. Ping trail that v0.1.0 is on npm.
3. trail adds the dep, turns `@trail/shared`'s `secret-scan.ts` into `export * from '@broberg/secret-scan'`, and **re-runs its F197 verify gate against the npm** (0 leaks / 0 FP parity).
4. **Only after trail confirms parity is F035 Done.**
5. Christian adds OIDC trusted-publishing (`publish.yml`) + makes it CI-friendly.

## Acceptance criteria
- `@broberg/secret-scan` v0.1.0 on npm; `npm i` resolves the named exports + types.
- Detector lifted verbatim (ordered patterns, specific-before-generic); pure, dep-free, ES2022.
- Regression suite green: per-pattern positives, benign 0-FP, order-sensitivity, byte-identical clean, counts, `extraPatterns`.
- **DONE GATE (binding):** trail migrates `@trail/shared` to re-export the npm and re-validates its gate passes (0 leaks / 0 FP). **F035 is NOT Done until trail confirms** — components shipping the npm is necessary but not sufficient.
