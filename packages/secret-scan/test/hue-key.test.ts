import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { classify, hasSecret, redactSecrets, SECRET_PATTERNS } from "../src/index.js";

/**
 * F035.7 — Philips Hue application key. Filed by beacon, who measured BEFORE
 * adopting the package and found their one valuable credential sailed through.
 *
 * F035.10 — and then the pattern that caught it turned out to catch npm
 * checksums too, because it was the only prefix-less pattern in this package
 * matching on entropy alone. It is now anchored on a field name, like every
 * other prefix-less secret here. The tests below are split accordingly:
 * what the SCANNER sees, what CLASSIFY sees, and the boundary between them.
 */

// Synthetic, never a real credential: 40 chars, mixed case, Hue-shaped.
const HUE_KEY = "FAKEfakeAbCdEf0123456789AbCdEf01234TEST5";

// Real 40-char lowercase hex SHAs (from this repo's history and Lens run rows).
const SHAS = [
  "bd4a595dd9da878af0b3df270b654c95e97ffc1b",
  "45d43de45d43de45d43de45d43de45d43de45d43",
];

// ---------------------------------------------------------------------------
// F035.10 — the defect trail reported, measured on a REAL lockfile
// ---------------------------------------------------------------------------

describe("F035.10 — the pattern must not match npm integrity digests", () => {
  const lockfile = readFileSync(new URL("../../../pnpm-lock.yaml", import.meta.url), "utf8");

  // 0.5.0's regex, kept verbatim as the fixture. The BEFORE number is asserted
  // so this test proves the fix removed something real — without it, the test
  // below would pass just as well on an input that never matched anything.
  const OLD_REGEX = /\b(?=[A-Za-z0-9-]{40}\b)(?=[A-Za-z0-9-]*[a-z])(?=[A-Za-z0-9-]*[A-Z])[A-Za-z0-9-]{40}\b/g;

  it("0.5.0 DID match this lockfile — the input is not accidentally clean", () => {
    const hits = lockfile.match(OLD_REGEX) ?? [];
    expect(hits.length).toBeGreaterThan(20);
    // and the hits really were checksums, not something else
    const digestHits = lockfile
      .split("\n")
      .filter((l) => l.includes("sha512-") && OLD_REGEX.test(l));
    expect(digestHits.length).toBeGreaterThan(20);
  });

  it("the shipped pattern matches ZERO times in a real pnpm-lock.yaml", () => {
    const hue = SECRET_PATTERNS.find((p) => p.label === "hue-application-key");
    expect(hue, "the pattern was deleted rather than fixed").toBeTruthy();
    const re = new RegExp(hue!.regex.source, hue!.regex.flags);
    expect(lockfile.match(re) ?? []).toEqual([]);
  });

  it("a whole lockfile scans clean under redactSecrets", () => {
    // The consumer-facing claim, not the regex-level one: a repo running this
    // as a pre-commit gate must be able to commit a dependency update.
    const { findings } = redactSecrets(lockfile);
    expect(findings.filter((f) => f.label === "hue-application-key")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// what the SCANNER still catches — the fix must not be "delete the pattern"
// ---------------------------------------------------------------------------

describe("hue-application-key is still caught in the shapes it really occurs in", () => {
  it.each([
    ["the v2 HTTP header", `hue-application-key: ${HUE_KEY}`],
    ["an env var", `HUE_APPLICATION_KEY=${HUE_KEY}`],
    ["a quoted JSON field", `{"hue_application_key":"${HUE_KEY}"}`],
    ["the v1 bridge username", `hue_username: ${HUE_KEY}`],
    ["a bridge-named field", `bridge-key: ${HUE_KEY}`],
  ])("%s", (_label, text) => {
    expect(hasSecret(text)).toBe(true);
    const { redacted, findings } = redactSecrets(text);
    expect(redacted).not.toContain(HUE_KEY);
    expect(findings.map((f) => f.label)).toContain("hue-application-key");
  });
});

// ---------------------------------------------------------------------------
// classify() asks a DIFFERENT question and gets a different bar
// ---------------------------------------------------------------------------

describe("classify() still names a bare key — the vault paste-a-key path", () => {
  it("names a bare Hue key with no field around it", () => {
    // cardmem's Secrets Vault: the user has ALREADY said this is a secret and
    // asks what kind. There is no surrounding text to corrupt and no checksum
    // to confuse it with, so the evidence bar is not the scanner's.
    const result = classify(HUE_KEY);
    expect(result).not.toBeNull();
    expect(result?.label).toBe("hue-application-key");
    expect(result?.description).toMatch(/hue/i);
  });

  it("does NOT name a 40-char fragment inside a longer value", () => {
    // ^…$ anchored: the value-only shape can never fire on part of something.
    expect(classify(`sha512-${HUE_KEY}+sg/xyz==`)).toBeNull();
  });

  it("does not name a SHA", () => {
    for (const sha of SHAS) expect(classify(sha)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// the boundary, asserted so nobody "fixes" it back
// ---------------------------------------------------------------------------

describe("DELIBERATELY not scanned: a bare key in free text (F035.10)", () => {
  it("a 40-char Hue-shaped value with no field name is NOT flagged by the scanner", () => {
    // This is the documented trade, not an oversight. The same shape is what a
    // window inside an npm sha512 digest looks like, and a pattern that cannot
    // tell a key from a checksum breaks every lockfile commit — at which point
    // the whole gate gets switched off and the 38 patterns that work protect
    // nothing. See the README's "Deliberately NOT detected".
    const { findings } = redactSecrets(`the key is ${HUE_KEY} apparently`);
    expect(findings.filter((f) => f.label === "hue-application-key")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// F035.9's cases — still true, and now true for a stronger reason
// ---------------------------------------------------------------------------

describe("git commit SHAs and prose are NOT treated as secrets", () => {
  for (const sha of SHAS) {
    it(`leaves ${sha.slice(0, 8)}… alone inside prose`, () => {
      const line = `deploy ${sha} finished in 42s`;
      const { redacted, findings } = redactSecrets(line);
      expect(redacted).toBe(line);
      expect(findings.filter((f) => f.label === "hue-application-key")).toEqual([]);
    });
  }

  it.each([
    ["hyphenated English prose, exactly 40 chars", "do-not-log-a-request-body-and-assume-it-"],
    ["a lowercase slug", "the-quick-brown-fox-jumps-over-a-lazy-do"],
    ["an UPPERCASE SHA-1", "DA39A3EE5E6B4B0D3255BFEF95601890AFD80709"],
    ["a lowercase SHA-1", "da39a3ee5e6b4b0d3255bfef95601890afd80709"],
  ])("does NOT flag %s", (_label, text) => {
    expect(text).toHaveLength(40); // the fixture is what it claims to be
    const { findings } = redactSecrets(text);
    expect(findings.filter((f) => f.label === "hue-application-key")).toEqual([]);
  });

  it("REGRESSION, from the commit it blocked: the phrase inside a real sentence", () => {
    const line = "replaced in 0.1.1 with an explicit do-not-log-a-request-body-and-assume-this-catches-it note";
    const { findings } = redactSecrets(line);
    expect(findings.filter((f) => f.label === "hue-application-key")).toEqual([]);
  });
});
