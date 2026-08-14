# @broberg/secret-scan

Pure, dependency-free **secret/credential redaction** for the broberg.ai fleet.
Catch leaked API keys and tokens at your write + egress boundaries so a key never
lands in a database, a chat answer, a search result, or a shared knowledge base.

Lifted from [`broberg/trail` F197](https://github.com/broberg-ai/trail) — the
second-brain safeguard that found 9 real leaked keys already sitting in a shared
KB. `components` owns + publishes it; every repo consumes the same canonical
pattern set, so detection never drifts.

```bash
npm i @broberg/secret-scan
```

## Usage

```ts
import { redactSecrets, hasSecret } from "@broberg/secret-scan";

const { redacted, findings } = redactSecrets("the key is sk-ant-api03-… use it");
// redacted → "the key is [REDACTED:anthropic-api-key] use it"
// findings → [{ label: "anthropic-api-key", count: 1, confidence: "format" }]

hasSecret("nothing here"); // false
```

`redactSecrets` is **pure + deterministic**: clean input returns byte-identical
with `findings: []`. It replaces every detected secret with `[REDACTED:<label>]`
and never blocks the write — the surrounding knowledge survives.

## Announced secrets — when the label is the only evidence (v0.2.0, opt-in)

`Adgangskode: hunter2` has **no format to match.** Everything above recognises a
key by its *shape* (`sk-ant-…`, `ghp_…`, `AKIA…`); here the value is arbitrary
human text and the only signal is that someone wrote the word "password" next to
it. cardmem found exactly this as the **first line of an ingested mail**, and
`redactSecrets()` passed it through unchanged.

```ts
redactSecrets("Adgangskode: hunter2");                      // ← UNCHANGED. Off by default.
redactSecrets("Adgangskode: hunter2", { announced: true });
// redacted → "Adgangskode: [REDACTED:announced-secret]"   ← the label is kept on purpose
// findings → [{ label: "announced-secret", count: 1, confidence: "announced" }]
```

Findings now carry `confidence`, so you can tell the two axes apart: `"format"`
(the value identifies itself — safe anywhere) vs `"announced"` (a label claims
the next word is a credential).

### Why it is opt-in — the measurement, not a hunch

> Measured **2026-08-14** against this repo: **548 tracked files, 544 readable as
> text**, containing essentially no real secrets. The shipped pattern matched
> **97 times, all of them noise.** Per label: `secret` **61**, `api key` **33**,
> `password` **4**, every Danish label **0**.

So 94 of the 97 come from the two words that are also ordinary **identifiers in
source code** — `secret: config.secret`, `apiKey: Record<…>`. That is the real
finding, and it is sharper than "the pattern is noisy": **its precision depends
entirely on what you are scanning.** In an inbound mail body `Adgangskode:` is a
strong signal; in a TypeScript file it is a variable name. The package cannot
know which corpus it is looking at — **only you can** — so you make the call, and
the default cannot be on.

That is the opposite of this repo's usual defaults-ON stance (webpush F067.1,
lens-engine F065). The numbers above are the reason, and they are why tuning is
not the answer either: a broader label+separator+value pattern measured **305**
on the same corpus, and refining it only reached **202**. A template/env-guard
(`${FOO}`, `<your-key>`) was written and then dropped — it changed the count by
**exactly 0**, because the noise here is identifiers, not templates.

### `hasAnnouncedSecret` — for when the right answer is to refuse

```ts
import { hasAnnouncedSecret } from "@broberg/secret-scan";

if (hasAnnouncedSecret(mailBody)) return; // don't send this to a model at all
```

A boolean, with no redaction built. For **untrusted inbound text heading to an
LLM**, refusing beats redacting: a false positive costs a slightly worse
classification, a false negative costs a leak. (buddy's reasoning, F035.8 — and
it is the better half of this feature.)

It fires on `Password: hunter2` and **not** on `"I forgot my password"` — a
label with no separator and value is prose, not a credential. Beware the
tempting-but-wrong version: a bare "3–32 alphanumerics on the first line" regex
matches `Hej`, `Tak` and `FYI`. Harmless where a non-match costs nothing,
dangerous in anything that redacts.

**Detection order is load-bearing.** The announced pass runs *last* and refuses a
value that is already a redaction marker, so `API key: sk-ant-…` still redacts as
`anthropic-api-key` rather than flattening to a generic `announced-secret`.

## Classify a single token — `classify`

The inverse of redaction: given a **single pasted token**, tell the caller what
kind of secret it is. Backs a "paste a key → detect its type" UI so every
consumer shares one classification (not just one redaction).

```ts
import { classify } from "@broberg/secret-scan";

classify("sk-ant-api03-…"); // → { label: "anthropic-api-key", description: "Anthropic API key (sk-ant-…)" }
classify("npm_" + "…");      // → { label: "npm-token", description: "npm publish/automation token (npm_ + 36 base62)" }
classify("just some text");  // → null
```

**First-match-wins** over the same ordered `SECRET_PATTERNS`, so `sk-ant-…` is
`anthropic-api-key`, never the generic `openai-api-key`. Input is trimmed;
empty / whitespace-only / no-match → `null`. It honours `extraPatterns` too
(`classify(value, { extraPatterns })`), with canonical attribution still winning.

Field-anchored patterns (`mistral` / `vimeo` / `cloudflare-api-token` /
`labeled-hex-secret` / the `deepseek` fallback) only classify when the pasted
value includes their `NAME=value` context — a bare provider token classifies via
its prefix, and a prefix-less bare token (e.g. a raw Mistral key) is genuinely
unidentifiable and returns `null`.

## Two recommended integration shapes

1. **Write boundary (ingest gate)** — redact before you persist, so secrets never
   enter storage:
   ```ts
   await db.insert({ content: redactSecrets(content).redacted });
   ```
2. **Egress guardrail** — scrub before a value leaves to a user or an LLM. The
   highest-value guard is scrubbing retrieved context before it enters a prompt,
   so the model can never see (and never echo) a secret that predates the gate.

## Custom / per-tenant patterns

Add your own patterns on top of the canonical set — they run **after** the
canonical patterns, so canonical attribution always wins:

```ts
redactSecrets(text, {
  extraPatterns: [{ label: "acme-key", description: "ACME key", regex: /\bACME-[0-9]{6}\b/g }],
});
```

## What it detects

A curated, **ordered** set (`SECRET_PATTERNS`) of named, low-false-positive
regexes — most-specific first so attribution is correct:

- **LLM:** Anthropic (`sk-ant-…`, incl. `oat01-`), OpenAI (`sk-`/`sk-proj-`),
  OpenRouter (`sk-or-v1-`), ElevenLabs, fal.ai, Google/Gemini (`AIza…`),
  Google OAuth (`GOCSPX-`), Mistral (field-anchored).
- **Cloud / infra:** AWS (`AKIA…`), GitHub, GitLab, Slack, Stripe live, Resend,
  Fly.io, Cloudflare (global key · API token via field-context · Turnstile secret),
  Supabase (`sbp_` / `sb_secret_`), npm (`npm_…`).
- **Fleet:** upmetrics (`uk_`), cardmem (`pa_/pi_/pk_`, `piw_`), cms (`wh_`),
  trail (`trail_`), cronjobs (`cj_` + 43 base64url).
- **Generic:** JWT (`eyJ…` — also Turso + Supabase service_role tokens), PEM
  private-key blocks, Discord bot/MFA tokens, and `labeled-hex-secret` (a 40+ hex
  value assigned to a `secret`/`token`/`password`/`api-key`-named field).
- **Field-anchored (context-only, to avoid FP on bare tokens):** Cloudflare API
  token, Mistral, Vimeo — matched only next to their env-var name.

### Design notes

- **Pattern-based, not entropy** — a redacted *real* fact corrupts knowledge, so
  we accept missing an exotic token over false-positiving.
- **Never a bare hex pattern** — it would hit git shas/hashes. Prefix-less service
  secrets are caught only via the `labeled-hex-secret` name-context rule.
- **Order is API** — specific patterns run before generic ones (`sk-ant-` before
  `sk-`); a test asserts it.
- **`hue-application-key` is the one unprefixed shape, and it runs LAST.** A Hue
  v2 key is 40 chars of `[A-Za-z0-9-]` with nothing to anchor on, so the regex
  carries a negative lookahead — `\b(?![0-9a-f]{40}\b)[A-Za-z0-9-]{40}\b` — that
  excludes **git commit SHAs**. This is not an optimisation: telemetry and error
  output are full of SHAs, and a redactor that mangles commit hashes gets turned
  off within a week, after which it protects nothing. Hue keys are mixed-case,
  SHAs are lowercase hex. Do not "simplify" the lookahead away; `test/hue-key.test.ts`
  asserts real SHAs stay untouched, standalone and in prose.

## API

```ts
interface SecretPattern { label: string; description: string; regex: RegExp; }
type SecretConfidence = "format" | "announced";
interface RedactionFinding { label: string; count: number; confidence: SecretConfidence; }
interface RedactionResult { redacted: string; findings: RedactionFinding[]; }
interface RedactOptions { extraPatterns?: SecretPattern[]; announced?: boolean; }
interface ClassifyResult { label: string; description: string; }

const SECRET_PATTERNS: SecretPattern[];
const ANNOUNCED_LABEL: string;                   // "announced-secret"
function redactSecrets(text: string, opts?: RedactOptions): RedactionResult;
function hasSecret(text: string, opts?: RedactOptions): boolean; // honours opts.announced
function hasAnnouncedSecret(text: string): boolean;              // the refuse-path
function classify(value: string, opts?: RedactOptions): ClassifyResult | null; // single-token type detection
function redactionMarker(label: string): string; // `[REDACTED:${label}]`
```

MIT · part of the [`@broberg/*`](https://github.com/broberg-ai/components) shared-library family.
