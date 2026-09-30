// F035.16 — UpCloud API tokens were unredacted and unclassified.
//
// Filed by cardmem (#1022) on Christian's order: classify('ucat_01M3…') → null
// on 0.9.3. The report carried a masked example and no length — so the shape
// comes from UpCloud itself, not from the mask: their API docs and their own Go
// client's test fixture, both `ucat_` + exactly 26 Crockford base32 (a ULID).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { redactSecrets, classify } from "../src/index";

/** UpCloud API docs, create-token response (developers.upcloud.com/1.3/24-api-tokens). */
const DOCS = "ucat_01DQE3AJDEBFEKECFM558TGH2F";
/** UpCloudLtd/upcloud-go-api, upcloud/token_test.go. */
const GO_FIXTURE = "ucat_01DEADBEEFDEADBEEFDEADBEEF";

describe("the tokens UpCloud actually issues", () => {
  it("are ucat_ + exactly 26 Crockford base32 — the assumption this pattern rests on", () => {
    for (const t of [DOCS, GO_FIXTURE]) {
      expect(t).toMatch(/^ucat_[0-9A-HJKMNP-TV-Z]{26}$/);
    }
  });

  it.each([DOCS, GO_FIXTURE])("classifies %s", (t) => {
    expect(classify(t)?.label).toBe("upcloud-api-token");
  });

  it("classifies a lowercased token too — Crockford decodes either case", () => {
    expect(classify(DOCS.toLowerCase())?.label).toBe("upcloud-api-token");
  });

  it("redacts the token out of a real request line and leaves the rest byte-identical", () => {
    const line = `curl -H "Authorization: Bearer ${DOCS}" https://api.upcloud.com/1.3/account`;
    const { redacted } = redactSecrets(line);
    expect(redacted).not.toContain(DOCS);
    expect(redacted.startsWith('curl -H "Authorization: Bearer ')).toBe(true);
    expect(redacted.endsWith('" https://api.upcloud.com/1.3/account')).toBe(true);
  });
});

describe("the scanner does not flag ITSELF", () => {
  // The bundle keeps comments. The first 0.10.0 tag had these two specimens in
  // the pattern's comment, so dist/ carried them and the pre-commit gate's test
  // (which stages dist/index.js in a fixture repo) was refused by its own
  // scanner. Asserting on src is enough: nothing reaches dist that is not here.
  it("src/index.ts contains no credential its own patterns would find", () => {
    const src = readFileSync(fileURLToPath(new URL("../src/index.ts", import.meta.url)), "utf8");
    expect(redactSecrets(src).findings.map((f) => f.label)).toEqual([]);
  });
});

describe("THE NEGATIVE CONTROLS: the length is exact", () => {
  it("25 characters is not a token", () => {
    expect(classify(DOCS.slice(0, -1))).toBe(null);
  });

  it("27 characters is not a token — and does not match its first 26", () => {
    const long = `${DOCS}X`;
    expect(classify(long)).toBe(null);
    expect(redactSecrets(long).redacted).toBe(long);
  });

  it("UpCloud's own redaction marker ucat_[REDACTED] stays readable", () => {
    expect(classify("ucat_[REDACTED]")).toBe(null);
    expect(redactSecrets("token=ucat_[REDACTED]").redacted).toBe("token=ucat_[REDACTED]");
  });

  it("a U (not Crockford) in the body is not a token", () => {
    const withU = `ucat_${"U".repeat(26)}`;
    expect(classify(withU)).toBe(null);
  });
});
