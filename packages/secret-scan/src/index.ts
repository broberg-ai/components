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
  /** global regex (used for replace-all + counting) */
  regex: RegExp;
}

/** Ordered most-specific → least. Every regex carries the `g` flag. */
export const SECRET_PATTERNS: SecretPattern[] = [
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
    label: 'trail-key',
    description: 'Trail personal API key (trail_…)',
    regex: /\btrail_[A-Za-z0-9]{20,}/g,
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
];

export interface RedactionFinding {
  label: string;
  count: number;
}

export interface RedactionResult {
  /** input with every secret replaced by `[REDACTED:<label>]` */
  redacted: string;
  /** per-pattern counts of what was redacted (empty = clean) */
  findings: RedactionFinding[];
}

export interface RedactOptions {
  /**
   * Extra consumer/per-tenant patterns, run AFTER the canonical set (so canonical
   * attribution wins). Backs a future self-service "paste a key → detector" UI.
   */
  extraPatterns?: SecretPattern[];
}

/** Replacement marker for a redacted secret. */
export const redactionMarker = (label: string): string => `[REDACTED:${label}]`;

function patternsFor(opts?: RedactOptions): SecretPattern[] {
  return opts?.extraPatterns && opts.extraPatterns.length > 0
    ? [...SECRET_PATTERNS, ...opts.extraPatterns]
    : SECRET_PATTERNS;
}

/**
 * Scan `text` and replace every detected secret with its redaction marker.
 * Pure: clean input returns byte-identical (`findings: []`).
 */
export function redactSecrets(text: string, opts?: RedactOptions): RedactionResult {
  if (!text) return { redacted: text, findings: [] };
  let redacted = text;
  const findings: RedactionFinding[] = [];
  for (const p of patternsFor(opts)) {
    let count = 0;
    redacted = redacted.replace(p.regex, () => {
      count++;
      return redactionMarker(p.label);
    });
    if (count > 0) findings.push({ label: p.label, count });
  }
  return { redacted, findings };
}

/** True if `text` contains at least one detectable secret. */
export function hasSecret(text: string, opts?: RedactOptions): boolean {
  return patternsFor(opts).some((p) => {
    p.regex.lastIndex = 0;
    return p.regex.test(text);
  });
}
