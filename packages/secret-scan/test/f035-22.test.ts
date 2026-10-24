// F035.22 — every key @broberg/apikey mints is redacted, whatever its prefix
// (buzzalert #4388: Buzz's bz_ key went to its log in clear text).
import { describe, expect, it } from "vitest";
import { redactSecrets, hasSecret, classify } from "../src/index";

const HEX = "a1b2c3d4e5f60718".repeat(4); // 64 lower-case hex

describe("F035.22 — <prefix>_<64 hex> from @broberg/apikey", () => {
  it("an unknown prefix (bz_, xyz_, buzz2_) is caught by redact, hasSecret and classify", () => {
    for (const key of [`bz_${HEX}`, `xyz_${HEX}`, `buzz2_${HEX}`]) {
      const r = redactSecrets(`Authorization: Bearer ${key}`);
      expect(r.redacted).not.toContain(HEX);
      expect(r.findings.map((f) => f.label)).toEqual(["apikey-prefixed-key"]);
      expect(hasSecret(key)).toBe(true);
      expect(classify(key)?.label).toBe("apikey-prefixed-key");
    }
  });
  it("named fleet prefixes keep their own label", () => {
    expect(classify(`piw_${HEX}`)?.label).toBe("cardmem-webhook-key");
    expect(classify(`uk_${HEX}`)?.label).toBe("upmetrics-key");
    expect(classify(`pa_${HEX}`)?.label).toBe("cardmem-key");
    expect(classify(`trail_${HEX}`)?.label).toBe("trail-key");
  });
  it("leaves digests alone: sha256:<hex>, a bare 64-hex, 63 or 65 hex, upper-case hex", () => {
    for (const text of [`digest sha256:${HEX}`, `etag ${HEX}`, `bz_${HEX.slice(1)}`, `bz_${HEX}f`, `bz_${HEX.toUpperCase()}`]) {
      expect(redactSecrets(text).findings.filter((f) => f.label === "apikey-prefixed-key")).toEqual([]);
    }
  });
});
