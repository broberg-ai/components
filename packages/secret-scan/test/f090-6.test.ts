// F090.6 — the gaps cardmem's fleet git gate (F036.23) measured on 4/11 2026, with
// values GENERATED here (never a realistic literal in the repo).
import { describe, expect, it } from "vitest";
import { hasSecret, redactSecrets } from "../src/index";

const pick = (alphabet: string, n: number) => Array.from({ length: n }, (_, i) => alphabet[(i * 7 + 3) % alphabet.length]).join("");
const ALNUM = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const HEX = "0123456789abcdef";
const labels = (t: string) => redactSecrets(t).findings.map((f) => f.label);

describe("F090.6 — uk_ (Upmetrics) in every length a generator can produce", () => {
  it("the real format (48 lowercase hex) and cardmem's planted 40-mixed are both caught as upmetrics-key", () => {
    expect(labels(`x-upmetrics-key: uk_${pick(HEX, 48)}`)).toEqual(["upmetrics-key"]);
    expect(labels(`UPMETRICS_API_KEY=uk_${pick(ALNUM, 40)}`)).toContain("upmetrics-key");
  });
  it("a short uk_ word is not a key", () => {
    expect(hasSecret("see uk_settings and uk_flag_enabled")).toBe(false);
  });
});

describe("F090.6 — Bearer with no known prefix", () => {
  it("a high-entropy bearer value is caught and removed", () => {
    const token = pick(ALNUM, 40);
    const r = redactSecrets(`curl -H "Authorization: Bearer ${token}" https://api.example`);
    expect(r.findings.map((f) => f.label)).toContain("bearer-token");
    expect(r.redacted).not.toContain(token);
  });
  it("placeholders and words after Bearer are left alone (negative controls)", () => {
    for (const t of [
      "Authorization: Bearer <token>",
      "Authorization: Bearer ${TOKEN}",
      "Authorization: Bearer $API_TOKEN",
      "send it as a Bearer token in the header",
      "Bearer abcdefghijklmnopqrstuvwxyzabcd", // a long lowercase word: no digit
    ]) expect(hasSecret(t), t).toBe(false);
  });
});

describe("F090.6 — token=/key=/secret= with no known prefix", () => {
  it("query-string and env forms are caught", () => {
    expect(labels(`https://x.example/hook?token=${pick(ALNUM, 32)}`)).toContain("labeled-token-param");
    expect(labels(`SECRET=${pick(ALNUM, 30)}`)).toContain("labeled-token-param");
  });
  it("identifiers, placeholders and short values are not", () => {
    for (const t of [
      "key=user_profile_settings_overview",
      "token=undefined",
      "token=${process.env.TOKEN}",
      "key=abc123",
      "monkey=Abcdefghijklmnopqrstuvwx1234", // «key» inside a longer name is not the field
    ]) expect(hasSecret(t), t).toBe(false);
  });
});
