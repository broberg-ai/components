import { describe, it, expect } from "vitest";
import {
  redactSecrets,
  hasSecret,
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
