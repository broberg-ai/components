import { describe, it, expect } from "vitest";
import {
  redactSecrets,
  hasSecret,
  classify,
  redactionMarker,
  SECRET_PATTERNS,
  type SecretPattern,
} from "../src/index";

// Ported from trail's verify-f197-secret-gate.ts (the proof of coverage + 0-FP).
// One real-shaped sample per pattern → must redact to the right label.
const SAMPLES: Array<[label: string, sample: string]> = [
  ["anthropic-api-key", "sk-ant-api03-" + "A".repeat(80)],
  ["openai-api-key", "sk-proj-" + "B".repeat(40)],
  ["google-api-key", "AIza" + "C".repeat(35)],
  ["google-oauth-secret", "GOCSPX-" + "D".repeat(28)],
  ["aws-access-key-id", "AKIA" + "EXAMPLE0123456789".slice(0, 16)],
  ["github-token", "ghp_" + "f".repeat(36)],
  ["slack-token", "xoxb-1234567890-abcdefghij"],
  ["stripe-secret-key", "sk_live_" + "g".repeat(24)],
  ["resend-api-key", "re_AbCdEf12GhIjKl34MnOpQr56StUvWx"],
  ["supabase-access-token", "sbp_" + "a1b2c3d4".repeat(5)], // sbp_ + 40 hex
  ["supabase-secret-key", "sb_secret_AbCdEf1234567890GhIjKl"],
  ["npm-token", "npm_" + "a".repeat(36)],
  ["fly-api-token", "FlyV1 fm2_" + "h".repeat(40)],
  ["upmetrics-key", "uk_" + "a1b2c3d4".repeat(6)], // uk_ + 48 hex
  ["cardmem-key", "pa_" + "j".repeat(24)],
  ["trail-key", "trail_" + "k".repeat(24)],
  ["cms-access-token", "wh_" + "deadbeef".repeat(8)], // wh_ + 64 hex
  ["openrouter-api-key", "sk-or-v1-" + "a1b2c3d4".repeat(8)], // sk-or-v1- + 64 hex
  ["elevenlabs-api-key", "sk_" + "a1b2c3d4".repeat(6)], // sk_ + 48 hex
  ["fal-api-key", "01234567-89ab-cdef-0123-456789abcdef:" + "a1b2c3d4".repeat(4)],
  ["bfl-api-key", "bfl_" + "Qo1aBcDe".repeat(4)], // bfl_ + 32 token chars
  ["github-fine-grained-pat", "github_pat_" + "A1b2C3d4e5".repeat(2) + "_" + "f6G7h8I9j0".repeat(6)], // github_pat_ + 22 + _ + 60
  ["cardmem-webhook-key", "piw_" + "a1b2c3d4".repeat(8)], // piw_ + 64 hex
  ["discord-bot-token", "M" + "A".repeat(24) + ".GhIjKl." + "a".repeat(30)],
  ["discord-mfa-token", "mfa." + "a".repeat(84)],
];

describe("redactSecrets — provider samples redacted to the right label", () => {
  for (const [label, sample] of SAMPLES) {
    it(`redacts ${label}`, () => {
      const r = redactSecrets(`my key is ${sample} ok`);
      expect(r.redacted).not.toContain(sample);
      expect(r.redacted).toContain(`[REDACTED:${label}]`);
      expect(r.findings.map((f) => f.label)).toContain(label);
    });
  }

  it("redacts a JWT (also covers Turso + Supabase service_role tokens)", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEFghiJKLmnoPQRstuv";
    expect(redactSecrets(jwt).redacted).toContain("[REDACTED:jwt]");
  });

  it("redacts the Anthropic OAuth variant (sk-ant-oat01-)", () => {
    const oat = "sk-ant-oat01-" + "Z".repeat(95);
    const r = redactSecrets(oat);
    expect(r.redacted).toContain("[REDACTED:anthropic-api-key]");
    expect(r.redacted).not.toContain("Z".repeat(95));
  });

  it("redacts a PEM private-key block", () => {
    const pem =
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA1234\n-----END RSA PRIVATE KEY-----";
    expect(redactSecrets(pem).redacted).toContain("[REDACTED:private-key]");
  });

  it("redacts a labeled prefix-less hex secret", () => {
    const labeled = "CMS_JWT_SECRET=" + "f".repeat(64);
    const r = redactSecrets(labeled);
    expect(r.redacted).toContain("[REDACTED:labeled-hex-secret]");
    expect(r.redacted).not.toContain("f".repeat(64));
  });
});

describe("benign text — no false positives (byte-identical, no findings)", () => {
  const BENIGN = [
    "The commit sha is 59ecd59 and the file is foo.ts.",
    "A sha256 digest: " + "a".repeat(64), // 64-hex — must NOT redact (no labeled field)
    "UUID 019eb117-9846-75c0-bd19-51633444aa5e here.",
    "See https://app.trailmem.com/kb/sanne-andersen/search for details.",
    "function redactSecrets(text: string) { return text; }",
    "re_compute_the_thing without any digit should stay", // resend lookahead guard
  ];
  for (const b of BENIGN) {
    it(`unchanged: "${b.slice(0, 34)}…"`, () => {
      const r = redactSecrets(b);
      expect(r.redacted).toBe(b);
      expect(r.findings).toHaveLength(0);
    });
  }
});

describe("order-sensitivity is load-bearing (specific before generic)", () => {
  it("sk-ant-… → anthropic-api-key, NOT openai-api-key", () => {
    const r = redactSecrets("sk-ant-api03-" + "A".repeat(40));
    const labels = r.findings.map((f) => f.label);
    expect(labels).toContain("anthropic-api-key");
    expect(labels).not.toContain("openai-api-key");
  });
  it("sk-or-v1-… → openrouter-api-key, NOT openai-api-key", () => {
    const r = redactSecrets("sk-or-v1-" + "a1b2c3d4".repeat(8));
    const labels = r.findings.map((f) => f.label);
    expect(labels).toContain("openrouter-api-key");
    expect(labels).not.toContain("openai-api-key");
  });
  it("SECRET_PATTERNS is ordered with the specific keys before the generic sk-", () => {
    const labels = SECRET_PATTERNS.map((p) => p.label);
    expect(labels.length).toBeGreaterThan(20);
    expect(labels.indexOf("anthropic-api-key")).toBeLessThan(labels.indexOf("openai-api-key"));
    expect(labels.indexOf("openrouter-api-key")).toBeLessThan(labels.indexOf("openai-api-key"));
  });
});

describe("api shape", () => {
  it("clean input is byte-identical with empty findings", () => {
    const clean = "just normal prose, nothing secret here.";
    const r = redactSecrets(clean);
    expect(r.redacted).toBe(clean);
    expect(r.findings).toEqual([]);
  });
  it("empty input is handled", () => {
    expect(redactSecrets("")).toEqual({ redacted: "", findings: [] });
  });
  it("counts repeated secrets", () => {
    const k = "sk-ant-api03-" + "A".repeat(40);
    const r = redactSecrets(`${k} and ${k}`);
    expect(r.findings.find((f) => f.label === "anthropic-api-key")?.count).toBe(2);
  });
  it("redactionMarker", () => {
    expect(redactionMarker("foo")).toBe("[REDACTED:foo]");
  });
  it("hasSecret true / false", () => {
    expect(hasSecret("sk-ant-api03-" + "A".repeat(40))).toBe(true);
    expect(hasSecret("nothing to see here")).toBe(false);
  });
});

describe("extraPatterns option (consumer / per-tenant patterns)", () => {
  const acme: SecretPattern = {
    label: "acme-key",
    description: "ACME key (ACME- + 6 digits)",
    regex: /\bACME-[0-9]{6}\b/g,
  };
  it("not redacted without extraPatterns", () => {
    expect(redactSecrets("token ACME-123456 here").redacted).toContain("ACME-123456");
  });
  it("redacted with extraPatterns", () => {
    const r = redactSecrets("token ACME-123456 here", { extraPatterns: [acme] });
    expect(r.redacted).toContain("[REDACTED:acme-key]");
    expect(r.redacted).not.toContain("ACME-123456");
  });
  it("hasSecret honors extraPatterns", () => {
    expect(hasSecret("ACME-123456")).toBe(false);
    expect(hasSecret("ACME-123456", { extraPatterns: [acme] })).toBe(true);
  });
  it("canonical attribution wins (canonical patterns run before extras)", () => {
    // a custom pattern that would also match an anthropic key must not steal it
    const greedy: SecretPattern = { label: "greedy", description: "", regex: /sk-[A-Za-z0-9-]+/g };
    const r = redactSecrets("sk-ant-api03-" + "A".repeat(40), { extraPatterns: [greedy] });
    expect(r.findings.map((f) => f.label)).toContain("anthropic-api-key");
    expect(r.findings.map((f) => f.label)).not.toContain("greedy");
  });
});

describe("v0.1.1 — Cloudflare Turnstile + API token", () => {
  it("redacts a Turnstile PROD secret (35 chars)", () => {
    const secret = "0x4AAAAAA" + "Ab3Df_Gh1Jk2Lm-Np4Qr5St6Uv"; // 9 + 26 = 35
    const r = redactSecrets("turnstile " + secret + " ok");
    expect(r.redacted).toContain("[REDACTED:cloudflare-turnstile-secret]");
    expect(r.redacted).not.toContain(secret);
  });
  it("does NOT redact a Turnstile SITE key (24 chars, public)", () => {
    const site = "0x4AAAAAA" + "Ab3Df_Gh1Jk2Lm-"; // 9 + 15 = 24
    const r = redactSecrets("site " + site + " ok");
    expect(r.redacted).toBe("site " + site + " ok");
    expect(r.findings).toHaveLength(0);
  });
  it("does NOT redact a Turnstile TEST key", () => {
    const r = redactSecrets("1x" + "0".repeat(22));
    expect(r.findings.map((f) => f.label)).not.toContain("cloudflare-turnstile-secret");
  });
  it("redacts a Cloudflare API token via CF_API_TOKEN field context", () => {
    const tok = "AbCdEfGhIj0123456789KlMnOpQrSt_-UvWxYz12"; // 40 base64url, mixed-case
    const r = redactSecrets("CF_API_TOKEN=" + tok);
    expect(r.redacted).toContain("[REDACTED:cloudflare-api-token]");
    expect(r.redacted).not.toContain(tok);
  });
  it("redacts a CLOUDFLARE_API_TOKEN field too", () => {
    const tok = "AbCdEfGhIj0123456789KlMnOpQrSt_-UvWxYz12";
    expect(redactSecrets("CLOUDFLARE_API_TOKEN=" + tok).findings.map((f) => f.label)).toContain("cloudflare-api-token");
  });
  it("does NOT redact a bare 40-char token with no CF field", () => {
    const tok = "AbCdEfGhIj0123456789KlMnOpQrSt_-UvWxYz12";
    const r = redactSecrets("value is " + tok + " here");
    expect(r.findings.map((f) => f.label)).not.toContain("cloudflare-api-token");
  });
});

describe("v0.1.2 — Mistral + Vimeo (context-only, field-anchored)", () => {
  const mistral = "Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0Uv"; // 32 base62, no prefix
  const vimeoHex = "0123456789abcdef0123456789abcdef"; // 32 hex

  it("redacts a MISTRAL_API_KEY value", () => {
    const r = redactSecrets("MISTRAL_API_KEY=" + mistral);
    expect(r.redacted).toContain("[REDACTED:mistral-api-key]");
    expect(r.redacted).not.toContain(mistral);
  });
  it("redacts a MISTRAL_TOKEN field too", () => {
    expect(redactSecrets("MISTRAL_TOKEN=" + mistral).findings.map((f) => f.label)).toContain("mistral-api-key");
  });
  it("does NOT redact a bare 32-char base62 with no Mistral field", () => {
    const r = redactSecrets("the id is " + mistral + " ok");
    expect(r.redacted).toBe("the id is " + mistral + " ok");
    expect(r.findings.map((f) => f.label)).not.toContain("mistral-api-key");
  });
  it("redacts a VIMEO_ACCESS_TOKEN value", () => {
    const r = redactSecrets("VIMEO_ACCESS_TOKEN=" + vimeoHex);
    expect(r.redacted).toContain("[REDACTED:vimeo-access-token]");
    expect(r.redacted).not.toContain(vimeoHex);
  });
  it("does NOT redact a bare 32-hex with no Vimeo field (MD5/UUID safe)", () => {
    const r = redactSecrets("the md5 is " + vimeoHex + " here");
    expect(r.findings.map((f) => f.label)).not.toContain("vimeo-access-token");
  });
});

describe("v0.1.3 — Cronjobs API key (cj_ + 43 base64url)", () => {
  const full = "cj_0123456789012345678901234567890123456789abc"; // cj_ + 43

  it("redacts a full cj_ key in a Bearer header", () => {
    const r = redactSecrets("Authorization: Bearer " + full + " done");
    expect(r.redacted).toContain("[REDACTED:cronjobs-api-key]");
    expect(r.redacted).not.toContain(full);
  });
  it("does NOT redact the truncated UI preview (cj_ + 8 chars)", () => {
    const preview = "cj_aB3dEf9h"; // 8 chars after prefix — shorter than {43}
    const r = redactSecrets("preview " + preview + " shown");
    expect(r.redacted).toBe("preview " + preview + " shown");
    expect(r.findings.map((f) => f.label)).not.toContain("cronjobs-api-key");
  });
});

describe("v0.1.7 — classify() single-token type detection (cardmem F214)", () => {
  it("returns { label, description } for a matching token", () => {
    const r = classify("sk-proj-" + "B".repeat(40));
    expect(r?.label).toBe("openai-api-key");
    expect(r?.description).toContain("OpenAI");
  });

  it("returns null for a non-secret, empty, and whitespace-only input", () => {
    expect(classify("just some normal text")).toBeNull();
    expect(classify("")).toBeNull();
    expect(classify("   \n\t ")).toBeNull();
  });

  it("trims surrounding whitespace before classifying", () => {
    const r = classify("  npm_" + "a".repeat(36) + "  ");
    expect(r?.label).toBe("npm-token");
  });

  it("first-match-wins: sk-ant-… → anthropic-api-key, NOT openai-api-key", () => {
    expect(classify("sk-ant-api03-" + "A".repeat(80))?.label).toBe("anthropic-api-key");
  });

  it("first-match-wins: sk-or-v1-… → openrouter-api-key, NOT openai-api-key", () => {
    expect(classify("sk-or-v1-" + "a1b2c3d4".repeat(8))?.label).toBe("openrouter-api-key");
  });

  it("field-anchored patterns do NOT fire on a bare token", () => {
    // bare 32-char base62 with no MISTRAL_… field → unidentifiable → null
    expect(classify("Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0Uv")).toBeNull();
  });

  it("field-anchored patterns DO fire when the NAME=value context is pasted", () => {
    expect(classify("MISTRAL_API_KEY=Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0Uv")?.label).toBe(
      "mistral-api-key",
    );
  });

  it("honours opts.extraPatterns", () => {
    const acme: SecretPattern = {
      label: "acme-key",
      description: "ACME key",
      regex: /\bACME-[0-9]{6}\b/g,
    };
    expect(classify("ACME-123456")).toBeNull();
    expect(classify("ACME-123456", { extraPatterns: [acme] })?.label).toBe("acme-key");
  });

  it("canonical attribution wins over a greedy extra pattern", () => {
    const greedy: SecretPattern = { label: "greedy", description: "", regex: /sk-[A-Za-z0-9-]+/g };
    const r = classify("sk-ant-api03-" + "A".repeat(40), { extraPatterns: [greedy] });
    expect(r?.label).toBe("anthropic-api-key");
  });

  it("does NOT corrupt a subsequent redactSecrets/hasSecret (no lastIndex bleed)", () => {
    const key = "sk-ant-api03-" + "A".repeat(40);
    classify(key); // advances shared global regexes' lastIndex if unmanaged
    // both must still detect the same key on the very next call
    expect(hasSecret(key)).toBe(true);
    expect(redactSecrets(key).findings.map((f) => f.label)).toContain("anthropic-api-key");
    // and classify itself must be idempotent across repeated calls
    expect(classify(key)?.label).toBe("anthropic-api-key");
    expect(classify(key)?.label).toBe("anthropic-api-key");
  });
});

describe("v0.1.6 — DeepSeek API key (sk- + 32 hex; field-anchored fallback)", () => {
  const dsKey = "sk-0123456789abcdef0123456789abcdef"; // sk- + 32 lowercase hex

  it("redacts a DeepSeek key and labels it deepseek-api-key, NOT openai", () => {
    const r = redactSecrets("DEEPSEEK_API_KEY=" + dsKey);
    expect(r.redacted).toContain("[REDACTED:deepseek-api-key]");
    expect(r.redacted).not.toContain(dsKey);
    const labels = r.findings.map((f) => f.label);
    expect(labels).toContain("deepseek-api-key");
    expect(labels).not.toContain("openai-api-key");
  });

  it("redacts a bare DeepSeek-shaped key (no field) as deepseek-api-key", () => {
    const r = redactSecrets("key " + dsKey + " ok");
    expect(r.findings.map((f) => f.label)).toContain("deepseek-api-key");
    expect(r.redacted).not.toContain(dsKey);
  });

  it("field-anchored: redacts a DEEPSEEK_TOKEN with an opaque (non-sk) value", () => {
    const opaque = "Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8"; // 24 base62, no sk- prefix
    const r = redactSecrets("DEEPSEEK_TOKEN=" + opaque);
    expect(r.redacted).toContain("[REDACTED:deepseek-api-key]");
    expect(r.redacted).not.toContain(opaque);
  });

  it("does NOT steal a real OpenAI key (sk-proj-/mixed-case → still openai)", () => {
    const openai = "sk-proj-AbCdEf0123456789GhIjKlMnOpQr"; // mixed case
    const labels = redactSecrets(openai).findings.map((f) => f.label);
    expect(labels).toContain("openai-api-key");
    expect(labels).not.toContain("deepseek-api-key");
  });

  it("anthropic + openrouter attribution unchanged (they run before deepseek)", () => {
    const ant = "sk-ant-api03-" + "A".repeat(80);
    const or = "sk-or-v1-" + "a".repeat(64);
    const la = redactSecrets(ant).findings.map((f) => f.label);
    const lo = redactSecrets(or).findings.map((f) => f.label);
    expect(la).toContain("anthropic-api-key");
    expect(la).not.toContain("deepseek-api-key");
    expect(lo).toContain("openrouter-api-key");
    expect(lo).not.toContain("deepseek-api-key");
  });

  it("does NOT redact a bare 32-hex git sha (no sk- prefix, no deepseek field)", () => {
    const sha = "0123456789abcdef0123456789abcdef"; // bare 32 hex
    const r = redactSecrets("commit " + sha + " landed");
    expect(r.findings.map((f) => f.label)).not.toContain("deepseek-api-key");
  });
});
