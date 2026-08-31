/**
 * @broberg/secret-scan — fleet secret/credential redaction.
 *
 * `redactSecrets(text)` replaces every matched secret with `[REDACTED:<label>]`
 * and reports what it found. PURE + deterministic (regex/string only, no deps,
 * no I/O) so an engine write-gate, an egress scrub, a CLI, an admin preview UI,
 * and any repo all share the EXACT same detection — and it's trivially testable.
 *
 * Lifted verbatim from broberg/trail F197 (the second-brain safeguard); see
 * docs/features/F035-secret-scan.md. components owns + publishes this; @trail/shared
 * re-exports it.
 *
 * Design choices:
 * - Pattern-based, NOT entropy/generic-randomness — a redacted real fact would
 *   corrupt knowledge, so we accept missing an exotic token over false positives.
 * - Order matters: most-specific patterns run first (e.g. `sk-ant-` before the
 *   generic OpenAI `sk-`; `sk-or-v1-` before `sk-`), because each match is
 *   consumed before the next pattern runs → order = attribution.
 * - Redact, never reject — the surrounding knowledge survives; only the
 *   credential substring is neutralised.
 * - NEVER a bare high-entropy/hex pattern (it would hit git shas/hashes).
 *   Prefix-less service secrets are caught only via `labeled-hex-secret` (a 40+
 *   hex value assigned to a secret/token/password/api-key-named field).
 *
 * Two recommended integration shapes for consumers:
 *  (a) write boundary — `redactSecrets(text)` before persist (ingest gate);
 *  (b) egress — scrub before a value leaves to a user/LLM (highest-value guard).
 */

export interface SecretPattern {
  /** stable id shown in the redaction marker + findings */
  label: string;
  /** human description of what this matches */
  description: string;
  /** The matcher. GLOBAL on the internal list, because the redaction pass
   *  replaces every occurrence — and NON-GLOBAL on everything this module
   *  exports (`SECRET_PATTERNS`, `VALUE_ONLY_PATTERNS`), because a shared `/g`
   *  regex carries `lastIndex` between calls and answers differently each time.
   *  Through 0.7.0 this comment claimed the opposite, and it is the tooltip a
   *  consumer sees: following it, `while ((m = p.regex.exec(text)))` never
   *  advances and spins forever. */
  regex: RegExp;
}

/** Ordered most-specific → least. Every regex carries the `g` flag. */
// The INTERNAL list. Global (`/g`) because the redaction pass replaces every
// occurrence. Never exported directly — see SECRET_PATTERNS below for why.
const PATTERNS: SecretPattern[] = [
  {
    label: 'private-key',
    description: 'PEM private key block (RSA/EC/OPENSSH/DSA/PGP)',
    regex:
      /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g,
  },
  {
    label: 'anthropic-api-key',
    description: 'Anthropic API key (sk-ant-…)',
    regex: /sk-ant-(?:api03-)?[A-Za-z0-9_-]{20,}/g,
  },
  {
    // OpenRouter — distinct from OpenAI; runs BEFORE the generic sk- (which would
    // otherwise also match + mislabel it).
    label: 'openrouter-api-key',
    description: 'OpenRouter API key (sk-or-v1- + 64 hex)',
    regex: /\bsk-or-v1-[0-9a-f]{64}/g,
  },
  {
    // DeepSeek — shares the sk- prefix with OpenAI, so it MUST run before the
    // generic openai pattern (specific-before-generic = correct attribution).
    // DeepSeek's documented shape is sk- + 32 lowercase hex (GitGuardian confirms
    // an sk- prefix but hides the exact regex); the hex-only body + {32,} length
    // distinguishes it from OpenAI's mixed-case base62 keys, so a real OpenAI key
    // is never mislabelled. The field-anchored fallback below catches any
    // DEEPSEEK_API_KEY value that doesn't fit this canonical shape.
    label: 'deepseek-api-key',
    description: 'DeepSeek API key (sk- + 32 lowercase hex)',
    regex: /\bsk-[0-9a-f]{32,}(?![0-9a-z])/g,
  },
  {
    label: 'openai-api-key',
    description: 'OpenAI API key (sk-… / sk-proj-…)',
    regex: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g,
  },
  {
    // ElevenLabs — sk_ with UNDERSCORE (vs OpenAI sk-), 48 hex.
    label: 'elevenlabs-api-key',
    description: 'ElevenLabs API key (sk_ + 48 hex)',
    regex: /\bsk_[0-9a-f]{48}\b/g,
  },
  {
    // fal.ai — uuid:hex32 (key_id:key_secret); the colon is the signal.
    label: 'fal-api-key',
    description: 'fal.ai key (uuid:hex32)',
    regex: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{32}\b/g,
  },
  {
    // Black Forest Labs (FLUX) API key — bfl_ prefix + a long token (sample
    // bfl_Qo1…). The distinctive prefix + {20,} length keeps false positives near
    // zero; image-provider sibling of the fal key above.
    label: 'bfl-api-key',
    description: 'Black Forest Labs / FLUX API key (bfl_ + token)',
    regex: /\bbfl_[A-Za-z0-9_-]{20,}/g,
  },
  {
    label: 'google-api-key',
    description: 'Google / Gemini API key (AIza…)',
    regex: /AIza[0-9A-Za-z_-]{35}/g,
  },
  {
    label: 'google-oauth-secret',
    description: 'Google OAuth client secret (GOCSPX-…)',
    regex: /GOCSPX-[A-Za-z0-9_-]{28}/g,
  },
  {
    label: 'aws-access-key-id',
    description: 'AWS access key id (AKIA…)',
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    label: 'github-token',
    description: 'GitHub token (ghp_/gho_/ghs_/ghu_/ghr_…)',
    regex: /\bgh[posru]_[A-Za-z0-9]{36,}\b/g,
  },
  {
    // GitHub fine-grained PAT — distinct prefix `github_pat_` (not caught by the
    // classic gh[posru]_ above), then base62 + a `_` separator (~82 chars total).
    // The prefix is so distinctive that {50,} keeps false positives at zero.
    label: 'github-fine-grained-pat',
    description: 'GitHub fine-grained personal access token (github_pat_…)',
    regex: /\bgithub_pat_[A-Za-z0-9_]{50,}/g,
  },
  {
    label: 'gitlab-token',
    description: 'GitLab personal access token (glpat-…)',
    regex: /\bglpat-[A-Za-z0-9_-]{20,}/g,
  },
  {
    label: 'slack-token',
    description: 'Slack token (xox[baprs]-…)',
    regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  },
  {
    label: 'stripe-secret-key',
    description: 'Stripe live secret/restricted key (sk_live_/rk_live_…)',
    regex: /\b[rs]k_live_[A-Za-z0-9]{20,}/g,
  },
  {
    // Filed by buddy, who found REAL ones sitting in plaintext in their own
    // transcription DB. Their scrub deliberately runs the format axis ONLY, so a
    // prefixed secret we do not match is a secret nobody catches — a precise
    // prefix is the only route that helps them. Zero false-positive risk: the
    // literal `whsec_` does not occur by accident.
    label: 'stripe-webhook-secret',
    description: 'Stripe webhook signing secret (whsec_…)',
    regex: /\bwhsec_[A-Za-z0-9+/=_-]{20,}/g,
  },
  {
    // Resend (re_…). Lookahead requires a digit in the body so we don't redact
    // long snake_case identifiers like re_compute_the_thing.
    label: 'resend-api-key',
    description: 'Resend API key (re_ + token)',
    regex: /\bre_(?=[A-Za-z0-9_]*\d)[A-Za-z0-9_]{24,}\b/g,
  },
  {
    label: 'supabase-access-token',
    description: 'Supabase personal/management access token (sbp_ + 40 hex)',
    regex: /\bsbp_[0-9a-f]{40}/g,
  },
  {
    label: 'supabase-secret-key',
    description: 'Supabase secret API key (sb_secret_…)',
    regex: /\bsb_secret_[A-Za-z0-9_-]{20,}/g,
  },
  {
    // Used by every @broberg/* publish — the highest-value leak from a .env / commit history.
    label: 'npm-token',
    description: 'npm publish/automation token (npm_ + 36 base62)',
    regex: /\bnpm_[A-Za-z0-9]{36}\b/g,
  },
  {
    label: 'fly-api-token',
    description: 'Fly.io API token (FlyV1 fm2_… / fo1_…)',
    regex: /(?:FlyV1 fm2_[A-Za-z0-9+/=_-]{20,}|\bfo1_[A-Za-z0-9_-]{20,})/g,
  },
  {
    // Also covers Turso DB/platform auth tokens AND Supabase anon/service_role
    // keys — both are JWTs (eyJ…), so the single JWT pattern catches them.
    label: 'jwt',
    description: 'JSON Web Token (eyJ…) — incl. Turso + Supabase service_role tokens',
    regex: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  },
  {
    // genApiKey = randomBytes(24).hex → uk_ + exactly 48 lowercase hex.
    label: 'upmetrics-key',
    description: 'Upmetrics project key (uk_ + 48 hex)',
    regex: /\buk_[0-9a-f]{48}/g,
  },
  {
    label: 'cardmem-key',
    description: 'Cardmem personal/incident/project key (pa_/pi_/pk_ + 64 hex)',
    regex: /\bp[aik]_[A-Za-z0-9]{20,}/g,
  },
  {
    // cardmem inbox-webhook key — piw_ isn't matched by p[aik]_ above (3rd char 'w' ≠ '_').
    label: 'cardmem-webhook-key',
    description: 'Cardmem inbox-webhook key (piw_ + 64 hex)',
    regex: /\bpiw_[0-9a-f]{64}/g,
  },
  {
    // VERIFIED WITH THE OWNER, 2026-08-28: `trail_` + exactly 64 LOWERCASE HEX.
    // trail generated 2000 keys through @broberg/apikey's generateKey('trail')
    // and counted the alphabet: 0-9a-f only, length 64-64, no `-`, no `_`. Source
    // is `${prefix}_${randomBytes(bytes).toString("hex")}`, bytes=32, with a hard
    // floor of 16 — so even a future caller asking for the minimum yields 32 hex
    // chars, still above {20,}.
    //
    // Recorded because the QUESTION is easy to re-ask and the ANSWER is not: this
    // is one of the few patterns here assuming alphanumerics only, and had trail
    // used base64url (the more common one-liner) the `-` and `_` would break the
    // run, {20,} would never be satisfied, and the WHOLE key would pass through
    // unredacted — not partially, entirely. Measured rather than assumed, because
    // two sampled keys cannot tell hex from base64url that has not hit a `-` yet.
    label: 'trail-key',
    description: 'Trail personal API key (trail_ + 64 hex; verified 2026-08-28)',
    regex: /\btrail_[A-Za-z0-9]{20,}/g,
  },
  {
    // Cronjobs API key (cronjobs.webhouse.net) — cj_ + randomBytes(32).base64url =
    // exactly 43 base64url chars (46 total). Prefix + fixed length = very low FP.
    // The UI's truncated cj_<8 chars>… preview is shorter than {43} → not matched.
    // Negative lookahead (not \b) because base64url's `-` breaks a trailing \b.
    label: 'cronjobs-api-key',
    description: 'Cronjobs API key (cj_ + 43 base64url)',
    regex: /\bcj_[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g,
  },
  {
    // randomBytes(32).hex → wh_ + 64 lowercase hex (67 chars total).
    label: 'cms-access-token',
    description: 'webhouse.app CMS access token (wh_ + 64 hex)',
    regex: /\bwh_[0-9a-f]{64}/g,
  },
  {
    // Cloudflare API token (R2 / DNS management) — 40 base64url chars, NO prefix.
    // A bare {40} would false-positive broadly, so this is CONTEXT-ONLY: it only
    // fires next to a cf/cloudflare-api-token-named field. Runs before
    // labeled-hex-secret so a hex-valued CF token is attributed correctly.
    label: 'cloudflare-api-token',
    description: 'Cloudflare API token (cf/cloudflare-api-token field + 40 base64url)',
    regex: /\b(?:cf|cloudflare)_?api_?token\b\s*[:=]\s*["'`]?[A-Za-z0-9_-]{40}(?![A-Za-z0-9_-])/gi,
  },
  {
    // Mistral API key — prefix-less ~32 base62 (Christian-confirmed sample). A bare
    // [A-Za-z0-9]{32} would FP on every ID/hash, so CONTEXT-ONLY: anchored on a
    // mistral-(api-)key/token-named field. Runs before labeled-hex for attribution.
    label: 'mistral-api-key',
    description: 'Mistral API key (mistral-(api-)key/token field + 24+ base62)',
    regex: /\bmistral(?:[_-]?api)?[_-]?(?:key|token)\b\s*[:=]\s*["'`]?[A-Za-z0-9]{24,}(?![A-Za-z0-9])/gi,
  },
  {
    // DeepSeek — field-anchored fallback for any DEEPSEEK_API_KEY/TOKEN value that
    // doesn't fit the canonical sk-+hex shape (mirrors the Mistral context-only
    // approach). The field name is the signal → near-zero false positives. The
    // sk-+hex format pattern above already attributes the canonical shape; this
    // backstops a format change or an opaque token.
    label: 'deepseek-api-key',
    description: 'DeepSeek API key (deepseek-(api-)key/token field + 20+ token)',
    regex: /\bdeepseek(?:[_-]?api)?[_-]?(?:key|token)\b\s*[:=]\s*["'`]?[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/gi,
  },
  {
    // Vimeo personal access token — ~32 lowercase hex, no prefix (sanne). A bare
    // hex32 would FP massively (MD5/UUID), so CONTEXT-ONLY: anchored on a
    // vimeo-(access-)token-named field.
    label: 'vimeo-access-token',
    description: 'Vimeo access token (vimeo-(access-)token field + 20+ base62)',
    regex: /\bvimeo(?:[_-]?access)?[_-]?token\b\s*[:=]\s*["'`]?[A-Za-z0-9]{20,}(?![A-Za-z0-9])/gi,
  },
  {
    // Context-based catch for prefix-less high-entropy service secrets
    // (CMS_JWT_SECRET, revalidateSecret, fleet openssl-rand-hex secrets): a 40+
    // hex value assigned to a field whose name contains
    // secret/token/password/api-key. The name requirement keeps the
    // false-positive rate near zero (a bare 40/64-hex would hit shas/hashes).
    label: 'labeled-hex-secret',
    description: 'A 40+ hex value assigned to a secret/token/password/api-key-named field',
    regex: /\b[A-Za-z0-9_-]*(?:secret|token|password|api[_-]?key)\b\s*[:=]\s*["'`]?[0-9a-f]{40,}/gi,
  },
  {
    // Discord bot token — three base64url segments. Anchored both sides so it
    // can't partial-match a longer dotted string.
    label: 'discord-bot-token',
    description: 'Discord bot token (3 base64url segments)',
    regex: /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{24,26}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,40}(?![A-Za-z0-9_-])/g,
  },
  {
    label: 'discord-mfa-token',
    description: 'Discord MFA token (mfa. + 84 chars)',
    regex: /\bmfa\.[A-Za-z0-9_-]{84}\b/g,
  },
  {
    // Cloudflare Turnstile PROD secret (sanne, verified 2/2) — 0x4 + 6×A prefix,
    // then 26 base64url (35 total). The 24-char SITE key + 1x/2x/3x TEST keys are
    // intentionally NOT matched (the {26} length gate misses them) so a public
    // key is never redacted.
    label: 'cloudflare-turnstile-secret',
    description: 'Cloudflare Turnstile secret key (0x4AAAAAA + 26 base64url, 35 total)',
    regex: /0x4AAAAAA[A-Za-z0-9_-]{26}(?![A-Za-z0-9_-])/g,
  },
  {
    label: 'cloudflare-global-key',
    description: 'Cloudflare global API key (37-hex)',
    regex: /\b[0-9a-f]{37}\b/g,
  },
  {
    // LAST on purpose: this is the only unprefixed shape in the list, so every
    // anchored pattern above must get first refusal.
    //
    // Philips Hue v2 application key — 40 chars of [A-Za-z0-9-] with NO prefix,
    // so there is nothing to anchor on. The negative lookahead is load-bearing,
    // not decoration: a bare [A-Za-z0-9-]{40} also matches a GIT COMMIT SHA, and
    // telemetry/error output is full of those. A redactor that eats commit
    // hashes gets switched off within a week, after which it protects nothing.
    //
    // F035.10 — THAT SENTENCE CAME TRUE ABOUT THIS VERY PATTERN. It was the only
    // prefix-less pattern here matching on ENTROPY ALONE, and base64 is
    // mixed-case alphanumeric, so it fired inside npm integrity digests:
    //
    //   resolution: {integrity: sha512-ABkD1WhyfPZprKRQI3bhATjeiFuNWC9PXhfGWqL+sg/…}
    //                                   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ matched
    //
    // 33 hits in components' own pnpm-lock.yaml, 32 of them digests. (`-` is in
    // the class but is not a word character, so \b anchors happily mid-digest.)
    // Reported by trail, whose gate then could not commit a lockfile change —
    // i.e. no dependency update at all. A gate nobody can satisfy is a gate
    // someone switches off, which costs more than the hole it closed.
    //
    // It is now CONTEXT-ONLY like every other prefix-less secret in this file
    // (cloudflare-api-token, mistral-api-key, vimeo-access-token,
    // labeled-hex-secret): the field name is the signal, not the randomness.
    // Deliberately given up: a bare 40-char Hue key in prose with no field name.
    // See the README's "Deliberately NOT detected" — do not remove the anchor to
    // "fix" that; a pattern that cannot tell a key from a checksum is worse than
    // no pattern. (Original pattern contributed by beacon, F035.7.)
    label: 'hue-application-key',
    description: 'Philips Hue application key (hue/bridge-named field + 40 chars)',
    // The `["'`]?` BEFORE the separator is not decoration: a Hue key most often
    // arrives as JSON — {"hue_application_key": "…"} — and the four older
    // context-only patterns in this file all omit it, so they miss the quoted
    // form. Noted rather than silently changed there; that is its own card.
    regex: /\b(?:hue|bridge)[_-]?(?:application[_-]?key|username|user|key)\b["'`]?\s*[:=]\s*["'`]?[A-Za-z0-9-]{40}(?![A-Za-z0-9-])/gi,
  },
];

/**
 * Shapes that identify a secret by its VALUE ALONE, with no field name.
 *
 * These are deliberately NOT in `SECRET_PATTERNS`, because a scanner runs over
 * arbitrary text where an unanchored entropy match is a disaster: the Hue shape
 * (40 mixed-case alphanumerics) is also what a 40-character window inside an npm
 * `sha512-…` digest looks like, which is how 0.5.0 blocked every lockfile commit
 * in every repo running the gate (F035.10).
 *
 * `classify()` is a different question, and that is the whole reason this list
 * exists. Its caller has ALREADY asserted the string is a secret — they pasted
 * it into a vault field and asked "what kind?" — so there is no checksum to
 * confuse it with and no text to corrupt. Answering "unknown" there costs a
 * consumer a working feature (cardmem's Secrets Vault type-detection) for a
 * false-positive risk that only exists when scanning.
 *
 * Same value, two questions: "is there a secret in this text?" and "what kind of
 * secret is this?" They do not deserve the same evidence bar.
 */
// ONE source for the value-only rule, two anchorings derived from it. Written
// twice by hand, the two forms drift the first time anyone tunes one of them.
//
// The lookaheads are the discriminator: 40 chars of [A-Za-z0-9-] that contain
// BOTH a lower- and an upper-case letter. A git SHA (40 lowercase hex) therefore
// never matches, which is the collision that would otherwise dominate.
const HUE_KEY_BODY = String.raw`(?=[A-Za-z0-9-]*[a-z])(?=[A-Za-z0-9-]*[A-Z])[A-Za-z0-9-]{40}`;

const VALUE_ONLY: ReadonlyArray<SecretPattern> = [
  {
    label: 'hue-application-key',
    description: 'Philips Hue application key (40 chars, no prefix)',
    // Anchored: `classify` is handed ONE value and asks what it is.
    regex: new RegExp(String.raw`^(?=[A-Za-z0-9-]{40}$)${HUE_KEY_BODY}$`),
  },
];

// Unanchored: `redactSecrets({ valueOnly: true })` runs over free text, where the
// key sits inside a sentence. Same body, word-bounded.
//
// THIS IS THE ONE THAT EATS PROSE, which is why it is opt-in. Measured over two
// trees with the identical pattern (F035.12):
//
//              lockfiles          everything else
//   components 1 file, 33 hits    15 files, 35 hits   class names, hyphenated prose
//   beacon     8 hits             0 prose             12 deliberate fixtures
//
// The charset includes the HYPHEN, so a 40-character run of kebab-case slug or
// hyphenated English matches — `gate-the-submit-button-on-status-not-on-`,
// `WebStandardStreamableHTTPServerTransport`. No file-level exemption reaches
// that; it is prose, not lockfiles.
//
// So the right default depends on the CALL SITE, not on the quality of the
// pattern. beacon redacts logs: a false positive costs a masked word, a false
// negative costs their bridge key. Our commit gate blocks commits: a false
// positive costs a developer a blocked README. Same pattern, opposite cost —
// which is what makes it a parameter rather than a fix.
const VALUE_ONLY_UNANCHORED: ReadonlyArray<SecretPattern> = [
  {
    label: 'hue-application-key',
    description: 'Philips Hue application key (40 chars, no prefix)',
    regex: new RegExp(String.raw`\b${HUE_KEY_BODY}\b`, 'g'),
  },
];

/**
 * Every pattern this package matches, for callers that want to inspect or audit
 * the roster.
 *
 * THE EXPORTED REGEXES ARE NOT GLOBAL, and that is a deliberate difference from
 * the ones used internally (F035.12). A `/g` regex carries `lastIndex` BETWEEN
 * CALLS, so the obvious way to inspect one lies. Measured on published 0.6.0:
 *
 *   p.regex.test(sample)  -> true    lastIndex now 20
 *   p.regex.test(sample)  -> false   <- same input, different answer
 *
 * Anyone measuring our own patterns — which is exactly what a consumer auditing
 * a redaction does — got alternating answers and no indication why. The copies
 * below are stateless, so testing them is idempotent.
 *
 * VALUE_ONLY_PATTERNS is exported for the same reason it exists: `classify` can
 * return a label that is in NEITHER list if only one of them is published, and a
 * roster that under-describes what the package detects is worse than no roster.
 */
/** A global copy, for the replace pass. A caller's `extraPatterns` regex may
 *  arrive without `/g`, in which case `String.replace` would substitute only the
 *  FIRST occurrence and leave the rest in the text. */
const asGlobal = (re: RegExp): RegExp =>
  re.flags.includes('g') ? re : new RegExp(re.source, `${re.flags}g`);

const withoutGlobal = (list: ReadonlyArray<SecretPattern>): ReadonlyArray<SecretPattern> =>
  Object.freeze(
    list.map((p) =>
      Object.freeze({ ...p, regex: new RegExp(p.regex.source, p.regex.flags.replace('g', '')) }),
    ),
  );

/** Every format pattern, ordered most-specific → least, as STATELESS copies —
 *  safe to `.test()` repeatedly. See `withoutGlobal` above for what shared
 *  `lastIndex` did to anyone auditing our own patterns before 0.7.0. */
export const SECRET_PATTERNS: ReadonlyArray<SecretPattern> = withoutGlobal(PATTERNS);

/** The value-only axis — shapes identified from the VALUE ALONE, with no field
 *  name beside them. Opt-in at the call site (`{ valueOnly: true }`); see the
 *  option's own documentation for why the default is off. */
export const VALUE_ONLY_PATTERNS: ReadonlyArray<SecretPattern> = withoutGlobal(VALUE_ONLY);

/**
 * WHY a finding was flagged — the two detection axes this package has.
 *
 * `format`   the VALUE carries the signal: `sk-ant-…`, `ghp_…`, `AKIA…`. Shape
 *            alone identifies it, so it is safe to run on anything.
 * `announced` the LABEL carries the signal: `Adgangskode: hunter2`. The value is
 *            arbitrary human text with no shape to match, so the only evidence
 *            is that someone wrote the word "password" next to it.
 */
export type SecretConfidence = 'format' | 'announced';

export interface RedactionFinding {
  label: string;
  count: number;
  /** which axis matched — see SecretConfidence. */
  confidence: SecretConfidence;
}

export interface RedactionResult {
  /** input with every secret replaced by `[REDACTED:<label>]` */
  redacted: string;
  /** per-pattern counts of what was redacted (empty = nothing found ON THE AXES IN `scanned`) */
  findings: RedactionFinding[];
  /**
   * Which axes this call actually EXAMINED — always `['format']`, plus
   * `'announced'` when `opts.announced` was set.
   *
   * It exists because `findings: []` alone cannot tell you which question was
   * asked. `redactSecrets("Adgangskode: hunter2")` and `redactSecrets("hello")`
   * both return an empty `findings`, and until 0.3.0 nothing in the return value
   * distinguished "we found nothing" from "we never looked there".
   *
   * A caller that must be sure can now ASSERT rather than trust the docs:
   *
   * ```ts
   * const r = redactSecrets(body, { announced: true });
   * if (!r.scanned.includes('announced')) throw new Error('announced axis not scanned');
   * ```
   *
   * Note the honest limit: this does not PREVENT the mistake — someone who
   * forgets the flag can equally forget to check this. It makes the mistake
   * *detectable* instead of merely documented, which is the difference between a
   * check and an agreement. Filed by buddy, who had just declined the same
   * "we'll agree to label things" fix from another session on the grounds that
   * an agreement holds only until the first person forgets it, and said it would
   * be cheap to use that argument in one direction and not the other.
   */
  scanned: readonly SecretConfidence[];
}

export interface RedactOptions {
  /**
   * Extra consumer/per-tenant patterns, run AFTER the canonical set (so canonical
   * attribution wins). Backs a future self-service "paste a key → detector" UI.
   */
  extraPatterns?: SecretPattern[];
  /**
   * Also detect ANNOUNCED secrets — `Adgangskode: hunter2` — where the label is
   * the only evidence. **Off by default, and it must stay that way.** See
   * ANNOUNCED_LABEL for the measurement that decided it.
   */
  announced?: boolean;

  /**
   * Also apply the VALUE-ONLY axis — shapes identified from the value alone,
   * with no field name beside them (today: the Philips Hue application key).
   *
   * OFF BY DEFAULT, and the reason is not that the pattern is bad (F035.12).
   *
   * cardmem's rule, which settled the design: **the decision to accept a weak
   * signal belongs to whoever can RENDER the uncertainty. A surface that cannot
   * show "guess" must not be given guesses.** Their vault shows a credential's
   * type as a chip beside the name, with nowhere to say "low confidence", so a
   * guess they accepted would silently become an assertion the owner acts on.
   * They take the empty answer instead.
   *
   * beacon's calculus is the opposite and equally correct: they redact logs, so
   * a false positive costs a masked word and a false negative costs their bridge
   * key. Their two call paths — masking each string separately, and passing a
   * bridge error message as free text — structurally cannot supply a field name,
   * so the field-anchored rule can never fire for them.
   *
   * MEASURED, same pattern, two corpora, opposite answers:
   *
   *   components  2 lockfiles (39 hits) + 9 other files (20 hits) — class names,
   *               documentation, `WebStandardStreamableHTTPServerTransport`
   *   beacon      8 lockfile hits, 0 prose, 12 deliberate fixtures
   *
   * So there is no single correct default, which is exactly what makes this a
   * parameter rather than a fix. An OPTION rather than a `confidence` field on
   * the result, deliberately: a field is ignorable by destructuring the label,
   * and a caller who did not ask for weak guesses must not be able to receive
   * one by accident. The parameter name is the warning, at the one place it
   * cannot be skipped.
   */
  valueOnly?: boolean;
}

/** Marker label for a secret detected by its announcing label rather than shape. */
export const ANNOUNCED_LABEL = 'announced-secret';

/**
 * Label + separator + value. The label list is deliberately short and concrete;
 * this is not a general "looks like config" detector.
 *
 * WHY THIS IS OPT-IN, MEASURED RATHER THAN GUESSED. Over this repo on
 * 2026-08-14 — 548 tracked files, 544 readable as text, containing essentially
 * no real secrets — this exact regex matched **97 times**, and every one was
 * noise. Per label: `secret` 61, `api key` 33, `password` 4, and every Danish
 * label 0. So 94 of the 97 are the two words that are also ordinary IDENTIFIERS
 * in source code (`secret: config.secret`, `apiKey: Record<…>`).
 *
 * That is the real finding, and it is sharper than "the pattern is noisy": its
 * precision depends entirely on WHAT IS BEING SCANNED. In an inbound mail body
 * — buddy's actual case — `Adgangskode:` is a strong signal. In a TypeScript
 * file it is a variable name. **The package cannot know which corpus it is
 * looking at; only the caller can.** So the caller makes the decision, and the
 * default cannot be on. (This is the opposite of this repo's usual defaults-ON
 * stance — webpush F067.1, lens-engine F065 — and the numbers above are why.)
 *
 * A broader label+separator+value pattern measured 305 on the same corpus, and
 * refining it only reached 202 — no amount of tuning makes a generic version
 * safe. A template/env-reference guard (`${FOO}`, `<your-key>`) was written and
 * then dropped: it changed the count by exactly 0, because the noise here is
 * identifiers, not templates.
 *
 * The value must not already be a redaction marker, so this can run AFTER the
 * format pass without flattening its more specific attribution.
 *
 * NOT IN THE LIST, AND DELIBERATELY (v0.4.0): bare `kode`. **In Danish, `kode`
 * mostly means SOURCE CODE** — the credential words are `kodeord` and
 * `adgangskode`, both still matched. Until 0.4.0 the bare form was included and
 * fired on ordinary technical prose; measured by buddy over 82,662 lines of real
 * Danish transcription: "Det er min kode: se linje 40" · "Kode: const x = 1" ·
 * "Merge-kode: konflikten er løst" · "QR-kode: scan den".
 *
 * And the behaviour was ARBITRARY, which is the part that settled it: `\b` meant
 * `Landekode:` / `Postkode:` / `Fejlkode:` never matched (no word boundary inside
 * the word) while `QR-kode:` did (a hyphen IS one). Whether a compound was
 * flagged came down to whether someone happened to type a hyphen.
 *
 * THE COST, stated rather than hidden: `Her er min kode: hunter2` is no longer
 * detected, and that is a real Danish way to announce a password. Deliberate — a
 * token that means "source code" half the time is noise in every corpus, not
 * just buddy's. If you need it back, file it; do not re-add it locally.
 */
const ANNOUNCED_SECRET =
  /(\b(?:adgangskode|kodeord|hemmelighed|password|passwd|api[ -]?key|apinøgle|secret|pwd)["'`\]]?\s*[:=]\s*)(\S+)/gi;

/**
 * Delimiters that may WRAP a value without being part of it.
 *
 * D1 (F035.12) — `(\S+)` swallowed these INTO the replaced span, so redacting
 * DELETED them. Measured on published 0.6.0:
 *
 *   config(password='hunter2')     -> config(password=[REDACTED:announced-secret]
 *   Kodeord: hunter2, og derefter  -> Kodeord: [REDACTED:announced-secret] og derefter
 *   brug `password: hunter2`       -> brug `password: [REDACTED:announced-secret]
 *
 * A closing paren, a comma and a backtick, gone. Anyone re-redacting a corpus
 * gets syntactically broken text back — and buddy holds 41k texts to do exactly
 * that. It also inflated every length measurement taken on candidates.
 *
 * THE LIST IS DELIBERATELY NARROW, and what is ABSENT is the load-bearing part:
 * `!` `?` `.` are NOT here. `Sommer2026!` is a real measured password and its
 * final character must go INTO the redaction, not survive it. A trailing quote
 * or bracket is structure; a trailing bang is content. Guessing wrong in the
 * first direction corrupts a corpus; guessing wrong in the second leaks one
 * character of a real secret, so the list only grows on evidence.
 */
const LEADING_DELIMS = /^[([{"'`]+/;
const TRAILING_DELIMS = /[)\]},;"'`]+$/;

/**
 * Is this candidate plausibly a secret VALUE, or just the next word in a
 * sentence?
 *
 * F035.11 — WITHOUT THIS, THE AXIS EATS PROSE. The pattern above is
 * label + separator + `\S+`, and in Danish and English «secret:» is ordinary
 * text. Measured on the published 0.5.1:
 *
 *   'Set som secret: gh secret set MYPAT'
 *     -> 'Set som secret: [REDACTED:announced-secret] secret set MYPAT'
 *   'jeg siger det aldrig — secret: ALDRIG'
 *     -> 'jeg siger det aldrig — secret: [REDACTED:announced-secret]'
 *
 * THE RULE IS DERIVED FROM buddy's NUMBERS, not chosen. Over 40,369 rows of real
 * fleet prose (23,801 intercom messages + 16,568 conversation turns) they found
 * 49 unique candidates after an announcing label. **35 of them were prose, and
 * every one of those 35 was under 16 characters with no digit** — "kun", "jeg",
 * "gh", "aldrig", "ALDRIG", "»". Zero were hex-like. And the axis caught ZERO
 * real secrets that the format rules had not already caught.
 *
 * So: a candidate with no digit, shorter than 16 characters, is prose.
 *
 * THE COST, STATED RATHER THAN HIDDEN, in the house style of the `kode` removal
 * above: `Adgangskode: correcthorse` is no longer detected. That is a real way to
 * write a real password. It is accepted deliberately — an over-broad redaction
 * destroys a corpus as effectively as a narrow one leaks it (buddy's framing),
 * and this axis is the one running over human prose. A value with any digit, or
 * any value of real key length, is unaffected: `hunter2` still goes.
 *
 * The judgement is on the CANDIDATE, never on the label. Narrowing the label list
 * would leave the same greedy `\S+` behind every label that remained.
 */
function plausibleSecretValue(candidate: string): boolean {
  return /\d/.test(candidate) || candidate.length >= 16;
}


/** Replacement marker for a redacted secret. */
export const redactionMarker = (label: string): string => `[REDACTED:${label}]`;

/** The opening of every marker. Derived from redactionMarker rather than typed
 *  again, so the two cannot drift apart — a hand-written '[REDACTED:' here would
 *  keep matching after someone changed the marker format. */
const MARKER_PREFIX = redactionMarker('').slice(0, -1);

function patternsFor(opts?: RedactOptions): SecretPattern[] {
  return opts?.extraPatterns && opts.extraPatterns.length > 0
    ? [...PATTERNS, ...opts.extraPatterns]
    : PATTERNS;
}

/**
 * Scan `text` and replace every detected secret with its redaction marker.
 * Pure: clean input returns byte-identical (`findings: []`).
 *
 * ⚠️ **This does NOT catch an announced secret unless you pass
 * `{ announced: true }`.** `redactSecrets("Adgangskode: hunter2")` returns the
 * password untouched with `findings: []` — which is indistinguishable from
 * "this text is clean", because the announced axis was never examined.
 *
 * The two axes are separate and only one is on by default (see
 * SecretConfidence). If you are gating untrusted inbound text, reach for
 * `hasAnnouncedSecret()` — or pass the flag. Do not assume an empty `findings`
 * means safe.
 *
 * Filed by buddy, who nearly reported this package as behaving wrongly: their
 * probe used the defaults and so could not see the axis they were testing. The
 * behaviour is right; the NAMES are the trap — two functions that sound
 * interchangeable, one of which is only complete with a flag.
 */
export function redactSecrets(text: string, opts?: RedactOptions): RedactionResult {
  // Computed from the OPTIONS, not from what was found — so it answers "which
  // question did this call ask?" identically on empty, clean and dirty input.
  // The empty-text path returns it too, deliberately: a caller asserting on
  // `scanned` must not get a different shape just because the body was blank.
  const scanned: readonly SecretConfidence[] = opts?.announced
    ? ['format', 'announced']
    : ['format'];
  if (!text) return { redacted: text, findings: [], scanned };
  let redacted = text;
  const findings: RedactionFinding[] = [];
  for (const p of patternsFor(opts)) {
    let count = 0;
    redacted = redacted.replace(p.regex, () => {
      count++;
      return redactionMarker(p.label);
    });
    if (count > 0) findings.push({ label: p.label, count, confidence: 'format' });
  }
  // VALUE-ONLY runs between format and announced: after the shapes that are safe
  // everywhere, before the label-driven axis, and only when the caller asked.
  if (opts?.valueOnly) {
    for (const p of VALUE_ONLY_UNANCHORED) {
      let count = 0;
      const next = redacted.replace(asGlobal(p.regex), (match: string) => {
        if (match.includes(MARKER_PREFIX)) return match;
        count++;
        return redactionMarker(p.label);
      });
      if (count > 0) {
        redacted = next;
        findings.push({ label: p.label, count, confidence: 'format' });
      }
    }
  }

  // Announced runs LAST, and only on request. Order is not cosmetic: the format
  // pass has already replaced everything it recognises, and this regex refuses a
  // value that is already a marker — so `API key: sk-ant-…` keeps its specific
  // `anthropic-api-key` attribution instead of being flattened to a generic one.
  // The announcing label itself is KEPT in the output; only the value goes, so
  // the redacted text still reads `Adgangskode: [REDACTED:announced-secret]` and
  // a human or model reading it can still tell what was removed.
  if (opts?.announced) {
    let count = 0;
    const redactedAnnounced = redacted.replace(
      ANNOUNCED_SECRET,
      (match: string, prefix: string, value: string) => {
        // ALREADY REDACTED -> leave it alone, so the format pass keeps its
        // specific attribution. The old guard was a `(?!\[REDACTED:)` lookahead
        // in the regex, which only fired when the marker was the FIRST character
        // of the value — so a QUOTED key was flattened (measured on 0.6.0):
        //
        //   API key: "sk-ant-api03-…"  ->  API key: [REDACTED:announced-secret]
        //   findings: anthropic-api-key, announced-secret
        //
        // The redacted text stopped saying WHICH kind of key it had been. This
        // tests for the marker ANYWHERE in the value rather than listing the
        // delimiters that could precede it — a list would have missed brackets,
        // parentheses and whatever nobody thought of next.
        if (value.includes(MARKER_PREFIX)) return match;

        // Split the wrapping delimiters off before judging AND before replacing,
        // so they survive into the output (D1). The judgement is on the CORE:
        // `'hunter2'` and `hunter2` are the same candidate.
        const lead = LEADING_DELIMS.exec(value)?.[0] ?? '';
        const trail = TRAILING_DELIMS.exec(value.slice(lead.length))?.[0] ?? '';
        const core = value.slice(lead.length, value.length - trail.length);

        // An implausible candidate is left EXACTLY as it was — byte for byte,
        // including the label. `match` rather than a rebuild on purpose: the
        // pieces are equal today and stop being equal the moment anyone adds a
        // group. Returning what was actually matched cannot drift.
        if (!core || !plausibleSecretValue(core)) return match;
        count++;
        return prefix + lead + redactionMarker(ANNOUNCED_LABEL) + trail;
      },
    );
    if (count > 0) {
      redacted = redactedAnnounced;
      findings.push({ label: ANNOUNCED_LABEL, count, confidence: 'announced' });
    }
  }
  return { redacted, findings, scanned };
}

/**
 * True if `text` announces a credential by label — `Adgangskode: hunter2` —
 * without building a redaction. Cheap enough to run on every inbound message.
 *
 * This exists because for untrusted inbound text heading to a model, the right
 * response is often to REFUSE rather than redact: a false positive costs a
 * slightly worse classification, a false negative costs a leak. That use needs a
 * boolean, not a redactor. (buddy's reasoning, F035.8.)
 */
export function hasAnnouncedSecret(text: string): boolean {
  if (!text) return false;
  // ROUTED THROUGH THE SAME PREDICATE as redactSecrets on purpose. A bare
  // `.test()` here would answer "yes" for a string redactSecrets leaves
  // untouched, and the two would disagree about the same input — which is worse
  // than either answer, because a caller can only ever ask one of them.
  //
  // THE INVARIANT IS NARROWER THAN "THEY AGREE", and the narrower one is what is
  // true (F035.12). They answer different questions and their FINDINGS can
  // legitimately differ:
  //
  //   hasAnnouncedSecret('password: AKIA…')        -> true
  //   redactSecrets(same).findings                 -> [aws-access-key-id]
  //
  // Not a bug: the format pass runs FIRST and recognised the value, so it holds
  // the better attribution and the announced pass correctly declines to flatten
  // it. An earlier comment here claimed the two simply agree; that claim was
  // broader than the code, which is the shape this repo keeps naming.
  //
  // What IS guaranteed, and what a caller can rely on:
  //
  //   hasAnnouncedSecret(t) === true  =>  redactSecrets(t, { announced: true })
  //                                       changes the text
  //
  // i.e. the boolean never promises a redaction that does not happen. It says
  // nothing about WHICH label does the work. Asserted in the suite over both the
  // agreeing and the disagreeing cases, so the weaker claim cannot silently
  // become the stronger one again.
  ANNOUNCED_SECRET.lastIndex = 0;
  for (let m = ANNOUNCED_SECRET.exec(text); m !== null; m = ANNOUNCED_SECRET.exec(text)) {
    // Same delimiter-stripping as the redactor, for the same reason: the two
    // must agree about what the CANDIDATE is, or they disagree about the input.
    const value = m[2] ?? '';
    if (value.includes(MARKER_PREFIX)) continue;
    const lead = LEADING_DELIMS.exec(value)?.[0] ?? '';
    const trail = TRAILING_DELIMS.exec(value.slice(lead.length))?.[0] ?? '';
    const core = value.slice(lead.length, value.length - trail.length);
    if (core && plausibleSecretValue(core)) {
      ANNOUNCED_SECRET.lastIndex = 0;
      return true;
    }
  }
  return false;
}

/**
 * True if `text` contains at least one detectable secret. Honours
 * `opts.announced` — a caller who asks for the announced axis and is told
 * `false` must be able to believe it.
 */
export function hasSecret(text: string, opts?: RedactOptions): boolean {
  if (opts?.announced && hasAnnouncedSecret(text)) return true;
  return patternsFor(opts).some((p) => {
    p.regex.lastIndex = 0;
    return p.regex.test(text);
  });
}

export interface ClassifyResult {
  /** the matching pattern's stable label (e.g. `openai-api-key`) */
  label: string;
  /** the matching pattern's human description (e.g. `OpenAI API key (sk-… / sk-proj-…)`) */
  description: string;
}

/**
 * Classify a SINGLE pasted token — the INVERSE of redaction. Returns the first
 * (most-specific) pattern the value matches, or `null`. Backs a "paste a key →
 * detect its type" UI (cardmem F214 Secrets Vault) so every consumer shares the
 * same classification, not just the same redaction.
 *
 * First-match-wins over the ordered `SECRET_PATTERNS`, so `sk-ant-…` classifies
 * as `anthropic-api-key`, never the generic `openai-api-key`. Field-anchored
 * context-only patterns (mistral / vimeo / cloudflare-api-token /
 * labeled-hex-secret / deepseek-fallback) only match when the pasted value
 * includes their `NAME=` context; a bare provider token classifies via its
 * prefix pattern, and a prefix-less bare token (e.g. a raw Mistral key) is
 * genuinely unidentifiable → `null`. `opts.extraPatterns` run AFTER the
 * canonical set (canonical attribution wins). Input is trimmed; empty /
 * whitespace-only → `null`.
 */
export function classify(value: string, opts?: RedactOptions): ClassifyResult | null {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;
  for (const p of patternsFor(opts)) {
    p.regex.lastIndex = 0;
    if (p.regex.test(v)) return { label: p.label, description: p.description };
  }
  // Only after every anchored pattern has declined, and only when the caller
  // OPTED IN: shapes named from the value alone. Anchored to the WHOLE string
  // (^…$), so this can never fire on a fragment of a longer value.
  //
  // The gate is new in 0.6.1. Before it, `classify` consulted this list
  // unconditionally, so a caller could receive `hue-application-key` for a
  // 40-character id it had never heard of — a guess arriving in the same shape
  // as a certainty, with nothing in the return value marking the difference.
  if (!opts?.valueOnly) return null;
  for (const p of VALUE_ONLY) {
    p.regex.lastIndex = 0;
    if (p.regex.test(v)) return { label: p.label, description: p.description };
  }
  return null;
}
