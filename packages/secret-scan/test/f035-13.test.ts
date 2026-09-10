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
    expect(classify(TEMP_ID)?.label).toBe("aws-temporary-access-key-id");
  });

  it("and it is labelled DISTINCTLY from a long-term key, because the response differs", () => {
    // A leaked AKIA must be rotated; a leaked ASIA may already have expired.
    // A reader seeing the marker in a log can only make that call if the marker
    // says which one it was.
    expect(classify(ID)?.label).toBe("aws-access-key-id");
    expect(redactSecrets(TEMP_ID).redacted).toContain("aws-temporary-access-key-id");
    expect(redactSecrets(ID).redacted).not.toContain("temporary");
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

describe("an AWS_* variable name does not mean an AWS key — measured, not assumed", () => {
  // cardmem measured their own production env after 0.8.0 was tagged: all four
  // AWS_*-named variables on Fly are TIGRIS (Fly's S3-compatible store), with a
  // 54-character `tid_` id and a 75-character secret. Every S3-compatible
  // service — Tigris, R2, MinIO, Backblaze — reuses AWS's variable names with
  // its own key format.
  //
  // 0.8.0 required exactly 40 base64, so the field said AWS_SECRET_ACCESS_KEY,
  // the value did not look like AWS, and the live credential stayed in the
  // clear with no marker anywhere near it. Shapes only below — no value from
  // their environment reached this repo or anyone's context.
  const TIGRIS_ID = "tid_" + "a".repeat(50); // 54 chars, as measured
  const TIGRIS_SECRET = "tsec_" + "b".repeat(70); // 75 chars, as measured

  it("a 75-character secret under AWS_SECRET_ACCESS_KEY is redacted", () => {
    const r = redactSecrets(`AWS_SECRET_ACCESS_KEY=${TIGRIS_SECRET}`);
    expect(r.redacted).not.toContain(TIGRIS_SECRET);
    expect(r.findings.map((f) => f.label)).toContain("aws-secret-access-key");
  });

  it("and so is the same value under the endpoint's own casing", () => {
    const r = redactSecrets(`{"SecretAccessKey":"${TIGRIS_SECRET}"}`);
    expect(r.redacted).not.toContain(TIGRIS_SECRET);
  });

  it("the id half is NOT the credential and is deliberately left alone", () => {
    // Redacting a `tid_` id would repeat this card's own defect in a new
    // provider: masking the harmless half and vouching for the text.
    expect(redactSecrets(`AWS_ACCESS_KEY_ID=${TIGRIS_ID}`).redacted).toContain(TIGRIS_ID);
  });

  it("the length is a FLOOR, so a short value under that field name still counts", () => {
    const short = "c".repeat(20);
    expect(redactSecrets(`aws_secret_access_key=${short}`).redacted).not.toContain(short);
  });

  it("but the field name is still required — a bare 75-char string is not a secret", () => {
    expect(redactSecrets(TIGRIS_SECRET).redacted).toBe(TIGRIS_SECRET);
  });
});

describe("the value's alphabet is not evidence — only the field name is", () => {
  // cardmem measured their Tigris secret's charset after 0.8.1: it contains
  // `+`, which our class happened to include — but only because we guessed
  // base64 rather than base64url. Their warning is the half that mattered:
  // that is ONE key. It says what CAN occur, never what always occurs, and the
  // next provider's alphabet is a guess we would make exactly the same way.
  const ALPHABETS: Array<[name: string, value: string]> = [
    ["base64 (with + and /)", "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY"],
    ["base64url (with _ and -)", "wJalrXUtnFEMI_K7MDENG-bPxRfiCYEXAMPLEKEY"],
    ["tigris-shaped (letters, digits, + and -)", "tsec+" + "aB9-".repeat(18)],
    ["hex", "a1b2c3d4".repeat(6)],
    ["dots and tildes — an alphabet we have never seen", "aa.bb~cc.dd~" + "ee.ff~".repeat(6)],
  ];

  it.each(ALPHABETS)("%s is redacted under the field name", (_name, value) => {
    const r = redactSecrets(`aws_secret_access_key=${value}`);
    expect(r.redacted).not.toContain(value);
  });

  it("the value stops at a delimiter — the rest of the line survives", () => {
    const value = "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY";
    const r = redactSecrets(`{"SecretAccessKey":"${value}","Expiration":"2026-09-11"}`);
    expect(r.redacted).not.toContain(value);
    expect(r.redacted).toContain("Expiration");
    expect(r.redacted).toContain("2026-09-11");
  });

  it("and the field name is STILL required — none of these match on their own", () => {
    for (const [, value] of ALPHABETS) {
      expect(redactSecrets(value).redacted).toBe(value);
    }
  });
});

describe("a REFERENCE to a secret is not a secret", () => {
  // Found by re-measuring the tracked tree after the class widened: our own
  // packages/media/README.md started matching, because it documents how to READ
  // the credential. A [REDACTED:…] marker in a README about wiring up storage
  // is the crying-wolf direction, and a scanner that cries wolf gets switched
  // off — after which it protects nothing.
  const REFS = [
    "secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!",
    "aws_secret_access_key = ${AWS_SECRET_ACCESS_KEY}",
    "awsSecretAccessKey: import.meta.env.VITE_AWS_SECRET_ACCESS_KEY",
    "secret_access_key: os.environ.AWS_SECRET_ACCESS_KEY_LONG_ENOUGH",
  ];

  it.each(REFS)("%s is left alone", (text) => {
    expect(redactSecrets(text).redacted).toBe(text);
  });

  it("but a real secret that CONTAINS dots is still redacted", () => {
    // The exclusion must match the WHOLE value, never a prefix of it —
    // otherwise the first dot in a credential switches the rule off.
    const dotted = "aa.bb~cc.dd~" + "ee.ff~".repeat(6);
    expect(redactSecrets(`aws_secret_access_key=${dotted}`).redacted).not.toContain(dotted);
  });
});
