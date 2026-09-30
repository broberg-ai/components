// F035.18 — the scanner hung on long text with no whitespace.
//
// Measured 30 Sep 2026: redactSecrets on 400,000 × 'A' took 31.6 s on 0.10.1.
// One pattern did all of it — aws-secret-access-key-paired, 3.7 s on 50,000
// characters — because its 100-character id search ran at every position
// before the cheap checks. The budgets below are ~10× what the fix measures
// and ~10× under the defect, so a slow CI machine stays green and the old
// ordering cannot.
import { describe, it, expect } from "vitest";
import { redactSecrets, SECRET_PATTERNS } from "../src/index";

const ms = (fn: () => void) => {
  const t = performance.now();
  fn();
  return performance.now() - t;
};

describe("long input without whitespace does not hang", () => {
  it("aws-secret-access-key-paired alone: 50,000 × 'A' in under 500 ms (was 3,700)", () => {
    const p = SECRET_PATTERNS.find((x) => x.label === "aws-secret-access-key-paired")!;
    const v = "A".repeat(50_000);
    p.regex.lastIndex = 0;
    expect(ms(() => v.replace(p.regex, "x"))).toBeLessThan(500);
  });

  it("redactSecrets: 400,000 × 'A' in under 2 s (was 31.6 s)", () => {
    const v = "A".repeat(400_000);
    let out = "";
    const took = ms(() => {
      out = redactSecrets(v).redacted;
    });
    expect(took).toBeLessThan(2_000);
    expect(out).toBe(v); // and nothing in it is a secret
  });

  it("the pair is still found — same answer, only cheaper", () => {
    // A synthetic id + a 40-char value 1 space apart: the CSV shape.
    const id = "AKIA" + "Q".repeat(16);
    const secret = "wJalr" + "X".repeat(30) + "EKEY1";
    const r = redactSecrets(`${id},${secret}`);
    expect(r.redacted).not.toContain(secret);
    expect(r.findings.map((f) => f.label)).toContain("aws-secret-access-key-paired");
  });
});
