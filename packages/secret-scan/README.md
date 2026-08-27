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

> ### ⚠️ `redactSecrets(text)` does **not** catch an announced secret
>
> ```ts
> redactSecrets("Adgangskode: hunter2")
> // → { redacted: "Adgangskode: hunter2", findings: [] }   ← password intact
> ```
>
> There are **two detection axes** and only the format one is on by default.
> `findings: []` here does not mean "clean" — it means the announced axis was
> never examined.
>
> **Since 0.3.0 you can check that instead of remembering it.** Every result
> carries `scanned` — which axes the call actually examined:
>
> ```ts
> redactSecrets("Adgangskode: hunter2").scanned              // ["format"]
> redactSecrets(body, { announced: true }).scanned           // ["format", "announced"]
>
> const r = redactSecrets(body, { announced: true });
> if (!r.scanned.includes("announced")) throw new Error("announced axis not scanned");
> ```
>
> It is computed from the **options**, not from what was found, so a clean scan
> and an unscanned one never look alike. **Honest limit:** this does not
> *prevent* the mistake — someone who forgets the flag can equally forget to
> check `scanned`. It makes the mistake **detectable** rather than merely
> documented, which is the difference between a check and an agreement.
>
> Gating untrusted inbound text? Use **`hasAnnouncedSecret(text)`**, or pass
> `{ announced: true }`. Do not treat an empty `findings` as safe.
>
> buddy came within one message of reporting this package as broken: their probe
> used the defaults, so it could not see the axis they were testing. The
> behaviour is correct — the **names** are the trap. Two functions that sound
> interchangeable, one of which is only complete with a flag.

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

### Bare `kode` is not in the list (v0.4.0)

**In Danish, `kode` mostly means SOURCE CODE.** The credential words are
`kodeord` and `adgangskode`, and both are still matched. Until 0.4.0 the bare
form was included and fired on ordinary technical prose — measured by buddy over
**82,662 lines of real Danish transcription**:

```
"Det er min kode: se linje 40"      "Kode: const x = 1"
"Merge-kode: konflikten er løst"    "QR-kode: scan den"
```

And the old behaviour was **arbitrary**, which is what settled it: `\b` meant
`Landekode:` / `Postkode:` / `Fejlkode:` never matched (no word boundary inside
the word) while `QR-kode:` did (a hyphen *is* one). Whether a compound got
flagged came down to whether someone happened to type a hyphen.

**The cost, stated rather than hidden:** `Her er min kode: hunter2` is no longer
detected, and that is a real Danish way to announce a password. Deliberate — a
token that means "source code" half the time is noise in every corpus, not just
buddy's. There is a test pinning the miss, so if it ever comes back it comes back
as a decision. Need it? File it; don't re-add it locally.

**A label needs something to follow it.** `Password:` on its own is `false`; the
value must actually be there. buddy found this the sharp way after adopting
0.2.0 — their own patch keyed on *label + separator* and flagged an ordinary
mail that merely said "I forgot my password". That is the line between a guard
and a noise source.

**A value on the next line still counts.** `Adgangskode:\nhunter2` fires, because
mail wraps and a wrapped secret is still a secret. The deliberate cost: a line
ending in `password:` followed by a paragraph will redact that paragraph's first
word. One visibly-marked word, never a silent miss — and both halves are tested,
so neither is an accident of the regex.

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

### A `null` has two meanings — check the length floor first

Every token pattern carries a **minimum length** (typically `{20,}`). So a
`null` from `classify()` means **either** of two things, and they are
indistinguishable from the return value alone:

1. no pattern matches this string; **or**
2. a pattern exists, but your sample was **shorter than its floor**.

```ts
classify("rk_live_51ABCdef");                 // → null   (8 chars after the prefix — under the floor)
classify("rk_live_51" + "A".repeat(90));      // → { label: "stripe-secret-key", … }
```

**Before you report a missing pattern, re-probe with a realistic-length value.**
Two gap reports in two days were both this, and both were withdrawn: a short
sample measured the *floor* and was read as missing *coverage*.

The floor is deliberate and load-bearing. Without it the literal string
`sk_live_` in prose, a doc or a code comment would be flagged — and a redactor
that fires on prose gets switched off within a week, after which it protects
nothing. Do not lower it.

**And measure the version you actually run.** Patterns are added over time
(`whsec_` landed in **0.4.0**), and a caret on a `0.x` version locks the minor —
`^0.1.7` can never resolve `0.4.0`, so a consumer never picks these up by
itself. Check the **installed** version, not the source tree and not the roster,
before concluding a pattern is absent.

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

### Deliberately NOT detected

- **Stripe publishable keys (`pk_live_` / `pk_test_`).** These are *publishable*
  by design — they ship in browser bundles and in setup instructions. They are
  not a leak risk, and redacting one would corrupt copy-pasted setup docs for no
  gain. This is a **decided scope boundary, not a gap**: a secret-scanner that
  masks a public value trains people to ignore it. Requested and declined,
  2026-08-25.

- **A bare Hue application key sitting in free text** (40 mixed-case chars with
  no field name near it). `hue-application-key` is **context-only**: it fires on
  a `hue`/`bridge`-named field, not on the shape alone.

  This is the same trade as above, and it was paid for. Until 0.5.1 the pattern
  matched on shape, and the shape of a Hue key is also the shape of a
  40-character window inside an npm integrity digest:

  ```
  resolution: {integrity: sha512-ABkD1WhyfPZprKRQI3bhATjeiFuNWC9PXhfGWqL+sg/…}
                                  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ matched
  ```

  33 hits in one real `pnpm-lock.yaml`. Any repo running this package as a
  pre-commit gate could no longer commit a lockfile change — so no dependency
  update at all. **A gate nobody can satisfy is a gate someone switches off**,
  and then the other 38 patterns protect nothing either. Do not remove the
  anchor to "improve coverage": that is the change that breaks everything.

  **`classify()` is unaffected** and still names a bare key. It answers a
  different question — its caller has already said "this is a secret, what
  kind?", so there is no surrounding text to corrupt and no checksum to confuse
  it with. Same value, two questions, two evidence bars.

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
interface RedactionResult {
  redacted: string;
  findings: RedactionFinding[];
  scanned: readonly SecretConfidence[];   // 0.3.0 — which axes were examined
}
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

## Upgrading to 0.4.0

Two changes from buddy, measured against a real Danish corpus and their own DB:

- **Added** `whsec_` (Stripe webhook signing secret) to the format axis. Clean
  gap, no trade-off — they found real ones sitting in plaintext because their
  scrub runs the format axis only, so a prefixed secret we miss is a secret
  nobody catches.
- **Removed** bare `kode` from the announced axis (see above). If you relied on
  it, `kodeord` and `adgangskode` still work.

## Upgrading to 0.3.0

`RedactionResult` gained a required `scanned` field. Additive for anyone reading
`redacted` / `findings` — **but a deep-equality assertion on the whole result
object will fail**, e.g. `expect(redactSecrets("")).toEqual({ redacted: "", findings: [] })`.
That is exactly the one test in this package's own suite that broke, and it was
kept as a whole-object compare rather than loosened, because it is the only
thing that shows a consumer what they will feel.

MIT · part of the [`@broberg/*`](https://github.com/broberg-ai/components) shared-library family.
