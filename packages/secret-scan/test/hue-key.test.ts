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
