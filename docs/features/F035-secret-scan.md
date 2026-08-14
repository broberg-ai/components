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

---

## F035.6 — `classify()`: single-token type detection (v0.1.7)

**Requested by:** `cardmem` (intercom #15522, 2026-07-03) for its **F214 Secrets Vault** — a "paste a key → detect its type" UI. cardmem currently runs its own loop over the exported `SECRET_PATTERNS` (cloning each regex without the `g` flag → `.test`). This is the exact self-service detector the original F035 plan (Scope §2) anticipated — it belongs **in the package** so every consumer shares one classification, not just redaction. Reuse-first: extend the shared npm, don't let a per-repo copy drift.

**What it adds:** the *inverse* of redaction. `redactSecrets` neutralises secrets inside free text; `classify` identifies the type of a **single pasted token**.

```ts
interface ClassifyResult { label: string; description: string; }
function classify(value: string, opts?: RedactOptions): ClassifyResult | null;
```

**Semantics:**
- **First-match-wins over the ordered `SECRET_PATTERNS`** (same most-specific-first order as redaction), so a `sk-ant-…` value classifies as `anthropic-api-key`, never the generic `openai-api-key`.
- Trims the input; empty / whitespace-only → `null`. No match → `null`.
- Resets each pattern's `lastIndex` before `.test` (mirrors `hasSecret`) so the shared global regexes can't carry state between calls.
- Honours `opts.extraPatterns` for parity with `redactSecrets` / `hasSecret` (consumer patterns run **after** canonical → canonical attribution wins).
- Returns `description` (the pattern's human string, e.g. `"OpenAI API key (sk-… / sk-proj-…)"`) in addition to the machine `label` — a detection UI wants the human name. Structurally a superset of cardmem's requested `{ label }`, so their `.label` read is unaffected.

**Field-anchored patterns (mistral / vimeo / cloudflare-api-token / labeled-hex-secret / deepseek fallback) only match if the pasted value includes their `NAME=` context** — a bare provider token classifies via its prefix pattern, which is the correct behaviour for a paste-a-key box (a bare Mistral key with no prefix is genuinely unidentifiable and returns `null`).

**No new patterns, no behaviour change to `redactSecrets`/`hasSecret`** — additive export only. Patch/minor bump → **v0.1.7**, auto-published via the existing OIDC `secret-scan-v*` tag workflow (Trusted Publisher already set up).

### F035.6 Acceptance criteria
- `classify(value)` returns `{ label, description }` for a value matching a canonical pattern, `null` for no match / empty / whitespace.
- First-match-wins verified: `sk-ant-…` → `anthropic-api-key` (not `openai-api-key`); `sk-or-v1-…` → `openrouter-api-key`.
- Field-anchored patterns don't fire on a bare token (e.g. a bare 32-char base62 → `null`, not `mistral-api-key`); they DO fire when the `NAME=value` context is pasted.
- `opts.extraPatterns` honoured, canonical attribution still wins.
- Calling `classify` does not corrupt a subsequent `redactSecrets`/`hasSecret` (no `lastIndex` bleed) — asserted.
- `@broberg/secret-scan` v0.1.7 on npm with the new export + type; README documents `classify`.

## F035.8 — Announced secrets: when the label is the only evidence (v0.2.0)

Filed by **buddy** after cardmem found a plaintext password as the **first line
of an ingested mail** and `redactSecrets()` passed it through unchanged. Every
pattern in this package matches a key *format* — the value identifies itself.
`Adgangskode: hunter2` has no format at all; the value is arbitrary human text
and the only signal is the word someone wrote next to it.

Verified against the published **0.1.8 before any code was written**: all seven
announced forms passed through untouched while format detection still worked. So
the tests are a real red, not a suite fitted to an implementation.

### The measurement that decided the default

The card's noise numbers describe a *generic* label+separator+value pattern. They
are not a measurement of what we shipped, so the shipped pattern was measured on
its own — **2026-08-14, 548 tracked files, 544 readable as text**, containing
essentially no real secrets:

| pattern | matches (all noise) |
| --- | --- |
| generic label+sep+value (from the card) | 305 → 202 after refining |
| **shipped narrow vocabulary** | **97** |
| shipped + template/env-reference guard | **97** — the guard changed nothing |
| shipped + min-value-length 6 | 82 |

Per label: `secret` **61**, `api key` **33**, `password` **4**, every Danish
label **0**. So 94 of the 97 are the two words that are also ordinary
**identifiers in source code** (`secret: config.secret`, `apiKey: Record<…>`).

That reframes the result. It is not merely "the pattern is noisy" — **its
precision depends entirely on the corpus**. In an inbound mail body
`Adgangskode:` is a strong signal; in a TypeScript file it is a variable name.
The package cannot know which it is looking at; only the caller can. **That** is
why the decision belongs to the caller and the default cannot be on — the
opposite of this repo's usual defaults-ON stance (webpush F067.1, lens-engine
F065).

The template/env-reference guard (`${FOO}`, `<your-key>`) was written, measured,
and **deleted**: 97 → 97. It would have shipped as plausible-looking dead weight.

### Design decisions

- **`confidence: 'format' | 'announced'`** on every finding, so a consumer can
  weigh a shape-match differently from a label-claim.
- **The announced pass runs LAST** and refuses a value that is already a
  redaction marker, so `API key: sk-ant-…` keeps its specific
  `anthropic-api-key` attribution instead of flattening to a generic label.
- **The announcing label is kept** in the output — `Adgangskode:
  [REDACTED:announced-secret]` — so a human or model reading the redacted text
  can still tell what was removed.
- **`hasSecret` honours `opts.announced`.** Without this, a caller who passes the
  new option and is told `false` gets a confident wrong answer rather than a
  missing feature — the failure class this repo keeps being bitten by.
- **`hasAnnouncedSecret(text)` is a boolean with no redaction built**, because
  buddy's use is to REFUSE: for untrusted inbound text heading to a model, a
  false positive costs a slightly worse classification and a false negative costs
  a leak. That is the better half of this feature and it came from the consumer.
- **Not shipped:** buddy's own regex (3–32 alphanumerics alone on a first line),
  which they flagged themselves — it matches `Hej`, `Tak`, `FYI`. Harmless where
  a non-match cuts nothing, dangerous in anything that redacts.

### Mutation evidence (four distinct red patterns)

A mutation that reddens everything only proves the suite runs; different
patterns prove it discriminates.

| mutation | red |
| --- | --- |
| drop the announced pass | **9** — only the `{announced:true}` block |
| force announced ON by default | **2** — only the default-off tests |
| `hasAnnouncedSecret` always true | **2** — the prose case + empty input |
| `hasSecret` ignores the option | **2** — the code-file case + the honours-option test |

### F035.8 Acceptance criteria

1. Findings carry `confidence`; asserted for **every** pattern in the existing
   sample loop, not a representative few.
2. Default off, proven by a test that fails if the default flips.
3. All seven verified forms redact under `{ announced: true }`.
4. `hasAnnouncedSecret(text)` returns a boolean without building a redaction.
5. Format detection unaffected; specific attribution survives an announcing line.
6. The measured number, its date and its corpus size are in the README.
7. buddy's case proven both ways — the mail line fires, the prose does not.
8. Mutation-proven with distinct red patterns (table above).
