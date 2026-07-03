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
// findings → [{ label: "anthropic-api-key", count: 1 }]

hasSecret("nothing here"); // false
```

`redactSecrets` is **pure + deterministic**: clean input returns byte-identical
with `findings: []`. It replaces every detected secret with `[REDACTED:<label>]`
and never blocks the write — the surrounding knowledge survives.

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

## API

```ts
interface SecretPattern { label: string; description: string; regex: RegExp; }
interface RedactionFinding { label: string; count: number; }
interface RedactionResult { redacted: string; findings: RedactionFinding[]; }
interface RedactOptions { extraPatterns?: SecretPattern[]; }
interface ClassifyResult { label: string; description: string; }

const SECRET_PATTERNS: SecretPattern[];
function redactSecrets(text: string, opts?: RedactOptions): RedactionResult;
function hasSecret(text: string, opts?: RedactOptions): boolean;
function classify(value: string, opts?: RedactOptions): ClassifyResult | null; // single-token type detection
function redactionMarker(label: string): string; // `[REDACTED:${label}]`
```

MIT · part of the [`@broberg/*`](https://github.com/broberg-ai/components) shared-library family.
