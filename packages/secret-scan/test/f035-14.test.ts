// F035.14 — HelpDesk keys were unredacted, and the PREVIEW must stay readable.
//
// Filed by cardmem (#27031); the shape was measured by helpdesk on three real
// minted keys. cardmem deliberately sent NO regex in their first message,
// because Christian's example had a masked tail and a mask is not 1:1 with the
// real length. A pattern derived from it would never have matched a real key —
// and would never have failed loudly, because a pattern that matches nothing
// looks exactly like a pattern with nothing to find.
//
// This file is the MIRROR of f035-13: there the risk was a pattern that can
// only be too NARROW, here it is one that can only be too BROAD.
import { describe, it, expect } from "vitest";
import { generateKey } from "@broberg/apikey";
import { redactSecrets, classify } from "../src/index";

// Minted by the REAL minter, not hand-typed, so the fixture cannot drift from
// what HelpDesk actually issues. @broberg/apikey is ours: generateKey(p, 32)
// returns `${p}_${randomBytes(32).toString("hex")}` — exactly 64 lowercase hex.
const KEY = generateKey("hd_live");

/** HelpDesk's deliberately-visible preview: prefix + 6 hex. NOT a secret. */
const PREVIEW = "hd_live_f4b4cf";

describe("the key the minter actually produces", () => {
  it("is exactly hd_live_ + 64 lowercase hex — the assumption this pattern rests on", () => {
    // If @broberg/apikey ever changes its default byte count, THIS is the test
    // that says so, rather than the pattern silently matching nothing.
    expect(KEY).toMatch(/^hd_live_[0-9a-f]{64}$/);
    expect(KEY).toHaveLength(8 + 64);
  });

  it("is classified", () => {
    expect(classify(KEY)?.label).toBe("helpdesk-api-key");
  });

  it("is redacted", () => {
    expect(redactSecrets(KEY).redacted).not.toContain(KEY);
  });
});

describe("THE NEGATIVE CONTROL: the preview must stay readable", () => {
  // hd_live_f4b4cf is what a human reads to see WHICH key was revoked. It is
  // shown on purpose, in HelpDesk's UI and in their logs. Redact it and we
  // break a value designed to be read.
  //
  // If you are here because you want to catch shortened keys too: this is why
  // you cannot. The length is exact deliberately.
  it("classify('hd_live_f4b4cf') is null — it is a preview, not a credential", () => {
    expect(classify(PREVIEW)).toBe(null);
  });

  it("redactSecrets leaves the preview byte-identical", () => {
    expect(redactSecrets(PREVIEW).redacted).toBe(PREVIEW);
  });

  it("and tells the two apart IN THE SAME LINE — which is what a real log looks like", () => {
    // In isolation either could pass for the wrong reason. A HelpDesk log line
    // carries both at once, and only this case proves they are distinguished
    // in context rather than one at a time.
    const line = `revoked key ${PREVIEW} (was ${KEY}) at 2026-09-10T13:00:00Z`;
    const out = redactSecrets(line).redacted;
    expect(out).not.toContain(KEY);
    expect(out).toContain(PREVIEW);
    expect(out).toContain("2026-09-10T13:00:00Z");
  });
});

describe("the length is pinned on BOTH sides — 64 is not a magic number", () => {
  const hex = (n: number) => "a".repeat(n);

  it("63 hex is not a key", () => {
    expect(classify(`hd_live_${hex(63)}`)).toBe(null);
  });

  it("64 hex is", () => {
    expect(classify(`hd_live_${hex(64)}`)?.label).toBe("helpdesk-api-key");
  });

  it("65 hex is not — and the first 64 of it must not match either", () => {
    // Without the trailing lookahead this would match a 64-char PREFIX of a
    // 65-char string, i.e. report a key where there is none.
    const long = `hd_live_${hex(65)}`;
    expect(classify(long)).toBe(null);
    expect(redactSecrets(long).redacted).toBe(long);
  });
});

describe("uppercase hex does not match", () => {
  it("randomBytes().toString('hex') is lowercase, so accepting uppercase widens for nothing", () => {
    expect(classify(`hd_live_${"A".repeat(64)}`)).toBe(null);
  });

  it("nor does a lowercase key with an uppercase hex digit stuck on the end", () => {
    const s = `hd_live_${"a".repeat(64)}F`;
    expect(redactSecrets(s).redacted).toBe(s);
  });
});
