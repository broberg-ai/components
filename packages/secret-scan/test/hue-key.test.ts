import { describe, expect, it } from "vitest";
import { classify, hasSecret, redactSecrets } from "../src/index.js";

/**
 * F035.7 — Philips Hue v2 application key.
 *
 * Filed by beacon, who measured BEFORE adopting the package and found their one
 * valuable credential sailed straight through. The SHA-exclusion assertions are
 * the important half: without the lookahead this pattern also eats git commit
 * hashes, and a redactor that mangles commit hashes gets switched off.
 */

// Synthetic, never a real credential: 40 chars, mixed case, Hue-shaped.
const HUE_KEY = "FAKEfakeAbCdEf0123456789AbCdEf01234TEST5";

// Real 40-char lowercase hex SHAs (from this repo's history and Lens run rows).
const SHAS = [
  "bd4a595dd9da878af0b3df270b654c95e97ffc1b",
  "45d43de45d43de45d43de45d43de45d43de45d43",
];

describe("hue-application-key", () => {
  it("is detected", () => {
    expect(HUE_KEY).toHaveLength(40);
    expect(hasSecret(HUE_KEY)).toBe(true);
  });

  it("is redacted, and reported under the right label", () => {
    const { redacted, findings } = redactSecrets(`key: ${HUE_KEY}`);
    expect(redacted).not.toContain(HUE_KEY);
    expect(findings.map((f) => f.label)).toContain("hue-application-key");
  });

  it("is named by classify() — the 'paste a key → detect the type' path", () => {
    const result = classify(HUE_KEY);
    expect(result).not.toBeNull();
    expect(result?.label).toBe("hue-application-key");
    expect(result?.description).toMatch(/hue/i);
  });
});

describe("git commit SHAs are NOT treated as secrets", () => {
  for (const sha of SHAS) {
    it(`leaves ${sha.slice(0, 8)}… alone when standalone`, () => {
      expect(hasSecret(sha)).toBe(false);
      expect(classify(sha)).toBeNull();
    });

    it(`leaves ${sha.slice(0, 8)}… alone inside prose`, () => {
      const line = `deploy ${sha} finished in 42s`;
      const { redacted, findings } = redactSecrets(line);
      expect(redacted).toBe(line);
      expect(findings.filter((f) => f.label === "hue-application-key")).toHaveLength(0);
    });
  }

  it("does not fire on shorter or longer hex runs either", () => {
    expect(hasSecret("a".repeat(39))).toBe(false);
    expect(hasSecret("0123456789abcdef".repeat(3))).toBe(false); // 48 chars
  });
});

describe("hue-application-key — the guard the comment always claimed (F035.9)", () => {
  // The old regex excluded lowercase HEX only, while its comment said "mixed-case
  // is the whole guard". Anything else lowercase went straight through, and an
  // uppercase SHA was flagged as a key. Both are the same root cause: the
  // sentence was a stronger claim than the code implemented.
  it.each([
    ["hyphenated English prose, exactly 40 chars", "do-not-log-a-request-body-and-assume-it-"],
    ["a lowercase slug", "the-quick-brown-fox-jumps-over-a-lazy-do"],
    ["an UPPERCASE SHA-1", "DA39A3EE5E6B4B0D3255BFEF95601890AFD80709"],
    ["a lowercase SHA-1", "da39a3ee5e6b4b0d3255bfef95601890afd80709"],
  ])("does NOT flag %s", (_label, text) => {
    expect(text).toHaveLength(40); // the fixture is what it claims to be
    const { findings } = redactSecrets(text);
    expect(findings.filter((f) => f.label === "hue-application-key")).toHaveLength(0);
  });

  it("REGRESSION, from the commit it blocked: the phrase inside a real sentence", () => {
    // This exact text stopped a legitimate docs commit in components on
    // 2026-08-23. It is prose, not a credential.
    const line = "replaced in 0.1.1 with an explicit do-not-log-a-request-body-and-assume-this-catches-it note";
    const { findings } = redactSecrets(line);
    expect(findings.filter((f) => f.label === "hue-application-key")).toHaveLength(0);
  });

  it.each([
    ["a mixed-case key", "aB3xK9mQ7pL2wR5tY8uI4oP1sD6fG0hJ2kN5vC8z"],
    ["a mixed-case key with many digits", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0"],
  ])("STILL flags %s — the fix must not blind the pattern", (_label, text) => {
    expect(text).toHaveLength(40);
    const { findings } = redactSecrets(text);
    expect(findings.map((f) => f.label)).toContain("hue-application-key");
  });
});
