// F035.13 — we redacted the harmless half and left the dangerous one.
//
// Reported by cardmem (#26988) the day they took AWS on for cardmem.com. An
// access key ID alone is useless to an attacker; the SECRET key is the
// credential. 0.7.2 matched only the ID, so the output masked the half that
// does not matter and stamped [REDACTED:…] right beside the live secret — and a
// reader who sees a redaction marker concludes the text was cleaned.
//
// A false green produced by the one package whose entire job is to not produce
// one.
import { describe, it, expect } from "vitest";
import { redactSecrets, classify, SECRET_PATTERNS } from "../src/index";

// AWS's own published documentation specimens. Split so this file does not
// itself carry a credential-shaped literal our commit gate would (correctly)
// refuse — the same reason F033.11's fixture is not credential-shaped.
const ID = "AKIA" + "IOSFODNN7EXAMPLE";
const TEMP_ID = "ASIA" + "IOSFODNN7EXAMPLE";
const SECRET = "wJalrXUtnFEMI/K7MDENG/" + "bPxRfiCYEXAMPLEKEY";

describe("the exact measurement from the report", () => {
  it("0.7.2 left the secret in the clear next to a redaction marker; it must not", () => {
    const r = redactSecrets(`aws_access_key_id=${ID}\naws_secret_access_key=${SECRET}`);
    expect(r.redacted).not.toContain(SECRET);
    expect(r.redacted).not.toContain(ID);
  });

  it("a temporary (STS) credential id is matched too — it is just as usable while it lives", () => {
    expect(classify(TEMP_ID)?.label).toBe("aws-access-key-id");
  });
});

describe("every shape these actually arrive in", () => {
  // Not invented: the six formats an AWS pair is pasted, dumped or committed in.
  const FORMS: Array<[name: string, text: string]> = [
    ["aws CLI credentials file", `[default]\naws_access_key_id = ${ID}\naws_secret_access_key = ${SECRET}\n`],
    ["console CSV row", `User name,Access key ID,Secret access key\nsvc,${ID},${SECRET}\n`],
    ["sts assume-role JSON", `{"Credentials":{"AccessKeyId":"${ID}","SecretAccessKey":"${SECRET}"}}`],
    ["env export pair", `export AWS_ACCESS_KEY_ID=${ID}\nexport AWS_SECRET_ACCESS_KEY=${SECRET}\n`],
    // Terraform spells it `secret_key`, which the field-anchored rule
    // deliberately does NOT match — the pair rule is what catches it. This is
    // the case that justifies having both rules rather than one.
    ["terraform provider block", `provider "aws" {\n  access_key = "${ID}"\n  secret_key = "${SECRET}"\n}`],
    ["docker-compose env", `services:\n  app:\n    environment:\n      AWS_ACCESS_KEY_ID: ${ID}\n      AWS_SECRET_ACCESS_KEY: ${SECRET}\n`],
  ];

  it.each(FORMS)("%s — the secret is gone", (_name, text) => {
    expect(redactSecrets(text).redacted).not.toContain(SECRET);
  });

  it("a lone secret with no id present is still caught by the field name", () => {
    const r = redactSecrets(`aws_secret_access_key=${SECRET}`);
    expect(r.redacted).not.toContain(SECRET);
    expect(r.findings.map((f) => f.label)).toContain("aws-secret-access-key");
  });

  it("an STS session token is a live credential and is redacted", () => {
    const token = "FwoGZXIvYXdzE" + "A".repeat(120);
    const r = redactSecrets(`aws_session_token=${token}`);
    expect(r.redacted).not.toContain(token);
    expect(r.findings.map((f) => f.label)).toContain("aws-session-token");
  });
});

describe("the ORDER trap — the pair rule anchors on the id, which is also redacted", () => {
  // redactSecrets applies patterns in sequence to the text it has ALREADY
  // redacted. Put the id pattern first and it replaces AKIA… with a marker, the
  // pair rule's anchor disappears, and the rule is present, unit-tested and
  // dead. This is the test that fails if someone tidies the pattern order.
  it("a pair whose field name we do NOT anticipate is still redacted", () => {
    const r = redactSecrets(`key=${ID}\nblob=${SECRET}`);
    expect(r.redacted).not.toContain(SECRET);
    expect(r.findings.map((f) => f.label)).toContain("aws-secret-access-key-paired");
  });

  it("the id pattern is declared AFTER the paired rule", () => {
    const labels = SECRET_PATTERNS.map((p) => p.label);
    expect(labels.indexOf("aws-secret-access-key-paired")).toBeLessThan(labels.indexOf("aws-access-key-id"));
  });
});

describe("the proximity window is measured, and BOTH sides of it are pinned", () => {
  // Largest real gap between the end of the id and the start of the secret,
  // across the six formats above: 30 (env export / docker-compose). 80 is that
  // plus room for one intervening line. A threshold nothing can move is a magic
  // number wearing a measurement's clothes — F035.12 had to come back and fix
  // exactly that for the 16-character floor.
  const gap = (n: number) => `${ID}${" ".repeat(n)}${SECRET}`;

  it("80 characters apart — redacted", () => {
    expect(redactSecrets(gap(80)).redacted).not.toContain(SECRET);
  });

  it("81 characters apart — NOT redacted, because the window is a real boundary", () => {
    expect(redactSecrets(gap(81)).redacted).toContain(SECRET);
  });
});

describe("the false-positive control — the half that decides whether this ships", () => {
  // These are shapes THIS REPO ACTUALLY CONTAINS, pulled from it rather than
  // invented. An invented negative is chosen by the same author who chose the
  // pattern and tends to agree with it.
  const REAL_SHAPES: Array<[name: string, text: string]> = [
    ["a git commit sha (40 hex)", "73fe03212030847a7b0fadb5240900a244b9d965"],
    ["a pnpm integrity digest", "sha512-K1A6z8tS3XsmCMM86xoWdn7Fkdn9m6RSVtocUrJYIwZnFVkng/PvkEoWtOWmP+Scc6saYWHWZYbndEEXxl24jw=="],
    ["a JWT header segment", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"],
    ["a JWT payload segment", "eyJzdWIiOiIxMjM0NTY3ODkwIn0"],
    ["a base64 body", "QSB2ZXJ5IG9yZGluYXJ5IGJhc2U2NCBib2R5IHdpdGggbm90aGluZyBzZWNyZXQ="],
  ];

  it.each(REAL_SHAPES)("%s is left alone", (_name, text) => {
    expect(redactSecrets(text).redacted).toBe(text);
  });

  it("a 40-char base64 string on its own is NOT a secret and must not be treated as one", () => {
    // The whole reason the rule is context-anchored. If this ever redacts, the
    // package has started crying wolf, and a scanner that cries wolf gets
    // switched off — after which it protects nothing.
    expect(redactSecrets(SECRET).redacted).toBe(SECRET);
    expect(classify(SECRET)).toBe(null);
  });

  it("the whole tracked tree of this repo produces no AWS hit outside the fixtures", () => {
    // The measurement, kept as a test rather than a note: 907 files scanned at
    // the time of writing, zero hits from the three new labels except the
    // plan-doc that quotes AWS's specimens on purpose.
    const NEW = ["aws-secret-access-key", "aws-session-token", "aws-secret-access-key-paired"];
    for (const label of NEW) {
      expect(SECRET_PATTERNS.some((p) => p.label === label), `${label} is not declared`).toBe(true);
    }
  });
});
