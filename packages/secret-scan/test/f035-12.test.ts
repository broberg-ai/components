import { describe, expect, it } from "vitest";
import {
  redactSecrets,
  hasAnnouncedSecret,
  classify,
  SECRET_PATTERNS,
  VALUE_ONLY_PATTERNS,
} from "../src/index";

// Assembled, never literal — this package's own fixtures must not need an
// exemption from the gate that scans this repo.
const AWS = "AKIA" + "IOSFODNN7EXAMPLE";
const ANTHROPIC = "sk-ant-api03-" + "A".repeat(20);
const HUE = "ABkD1WhyfPZprKRQI3bhATjeiFuNWC9PXhfGWq" + "Lx";

describe("D1 — a wrapping delimiter must SURVIVE the redaction", () => {
  // Measured on published 0.6.0: `(\S+)` swallowed the delimiter INTO the
  // replaced span, so redacting DELETED it. buddy holds 41k texts to re-redact,
  // so syntactically broken output is not cosmetic.
  it.each([
    ["config(password='hunter2')", "config(password='[REDACTED:announced-secret]')"],
    ["Kodeord: hunter2, og derefter", "Kodeord: [REDACTED:announced-secret], og derefter"],
    ["brug `password: hunter2`", "brug `password: [REDACTED:announced-secret]`"],
    ['{"password": "hunter2"}', '{"password": "[REDACTED:announced-secret]"}'],
  ])("%s", (input, expected) => {
    expect(redactSecrets(input, { announced: true }).redacted).toBe(expected);
  });

  it("the SECRET itself is still gone — the delimiters are all that survive", () => {
    for (const input of [
      "config(password='hunter2')",
      "Kodeord: hunter2, og derefter",
      '{"password": "hunter2"}',
    ]) {
      expect(redactSecrets(input, { announced: true }).redacted).not.toContain("hunter2");
    }
  });

  it("a trailing ! is CONTENT, not a delimiter — Sommer2026! goes whole", () => {
    // The measured Danish password from buddy's corpus. If `!` were stripped as
    // punctuation, one character of a real secret would survive the redaction.
    const r = redactSecrets("Kodeord: Sommer2026!", { announced: true });
    expect(r.redacted).toBe("Kodeord: [REDACTED:announced-secret]");
    expect(r.redacted).not.toContain("!");
  });
});

describe("the digit branch has NO floor, deliberately", () => {
  // buddy measured this branch over 41,095 texts AFTER the card was written.
  // Sommer2026! is 11 characters; prose in the same band cannot be separated by
  // form (two independent rules were tried, both misfiled across the boundary).
  // A floor removes noise by leaking a real password, so the branch stays
  // conservative and these fixtures exist to keep a fix OUT.
  it.each([
    ["Kodeord: Sommer2026!", "an 11-char Danish password buddy measured"],
    ["Adgangskode: hunter2", "7 chars, the documented case"],
    ["Kodeord: Vinter2026!!", "12 chars — the boundary a floor of 12 would sit on"],
  ])("%s stays redacted (%s)", (input) => {
    expect(redactSecrets(input, { announced: true }).redacted).toContain("[REDACTED:");
  });

  it("and the accepted COST is still paid — prose with a digit is still eaten", () => {
    // Stated rather than hidden: `Kodeord: 2` IS redacted and that is noise we
    // keep on purpose. Asserting it means nobody can quietly "fix" it without
    // the measurement that would justify doing so.
    expect(redactSecrets("Kodeord: 2", { announced: true }).redacted).toBe(
      "Kodeord: [REDACTED:announced-secret]",
    );
  });
});

describe("D2 — a QUOTED key was never matched at all", () => {
  // The leak. `"password":` puts a quote between the word and the separator, so
  // the old pattern never fired. JSON is how a MACHINE writes a secret, and it
  // was the one shape we did not see. 22 of buddy's 57 long candidates are JSON.
  it("redacts a JSON-shaped announcement", () => {
    expect(redactSecrets('{"password": "hunter2"}', { announced: true }).redacted).not.toContain(
      "hunter2",
    );
  });

  it("hasAnnouncedSecret agrees — it used to answer false, i.e. clean", () => {
    expect(hasAnnouncedSecret('{"password": "hunter2"}')).toBe(true);
  });

  it("still ignores a label with no value after it", () => {
    // The widened prefix must not make the pattern fire on the word alone.
    expect(redactSecrets("password:", { announced: true }).redacted).toBe("password:");
  });
});

describe("a format-recognised key keeps its OWN label inside delimiters", () => {
  // The old guard was a (?!\[REDACTED:) lookahead, which only fired when the
  // marker was the FIRST character of the value — so a quoted key was flattened
  // to the generic label and the text stopped saying what kind of key it was.
  //
  // Three delimiters, so the fix is the marker test and not a quote special-case.
  it.each([
    [`API key: "${ANTHROPIC}"`],
    [`API key: [${ANTHROPIC}]`],
    [`API key: (${ANTHROPIC})`],
  ])("%s keeps anthropic-api-key", (input) => {
    const r = redactSecrets(input, { announced: true });
    const labels = r.findings.map((f) => f.label);
    expect(labels).toContain("anthropic-api-key");
    expect(labels).not.toContain("announced-secret");
    expect(r.redacted).toContain("[REDACTED:anthropic-api-key]");
  });
});

describe("hasAnnouncedSecret vs redactSecrets — the invariant that IS true", () => {
  // They answer different questions and their FINDINGS legitimately differ: the
  // format pass runs first and holds the better attribution. The earlier comment
  // claimed they simply agree, which was broader than the code.
  it("their findings CAN differ, and that is not a bug", () => {
    const text = `password: ${AWS}`;
    expect(hasAnnouncedSecret(text)).toBe(true);
    expect(redactSecrets(text, { announced: true }).findings.map((f) => f.label)).toEqual([
      "aws-access-key-id",
    ]);
  });

  it.each([
    [`password: ${AWS}`],
    ["Adgangskode: hunter2"],
    ['{"password": "hunter2"}'],
    [`API key: "${ANTHROPIC}"`],
    ["Kodeord: 2"],
    ["ingen hemmeligheder her"],
    ["secret: [REDACTED:announced-secret]"],
  ])("invariant on %s: has => redaction changes the text", (text) => {
    if (hasAnnouncedSecret(text)) {
      expect(redactSecrets(text, { announced: true }).redacted).not.toBe(text);
    }
  });
});

describe("exported regexes are STATELESS", () => {
  // A /g regex carries lastIndex between calls, so the obvious way to inspect
  // one lies — measured on 0.6.0: test() answered true, then false, on the same
  // input. Anyone auditing our patterns got alternating answers.
  it("the same input gives the same answer every time", () => {
    const p = SECRET_PATTERNS.find((x) => x.label === "aws-access-key-id")!;
    expect(p.regex.flags).not.toContain("g");
    expect([p.regex.test(AWS), p.regex.test(AWS), p.regex.test(AWS)]).toEqual([true, true, true]);
  });

  it("every exported pattern is non-global, in both lists", () => {
    for (const p of [...SECRET_PATTERNS, ...VALUE_ONLY_PATTERNS]) {
      expect(p.regex.flags, `${p.label} is global`).not.toContain("g");
    }
  });

  it("redaction still replaces EVERY occurrence — the internal list stays global", () => {
    const r = redactSecrets(`${AWS} and ${AWS}`);
    expect(r.redacted).not.toContain("AKIA");
    expect(r.findings[0]?.count).toBe(2);
  });

  it("VALUE_ONLY_PATTERNS is exported, so the roster is complete", () => {
    expect(VALUE_ONLY_PATTERNS.map((p) => p.label)).toContain("hue-application-key");
  });
});

describe("valueOnly — opt-in, both directions", () => {
  it("a bare key is NOT redacted by default", () => {
    expect(redactSecrets(HUE).redacted).toBe(HUE);
  });

  it("and IS when opted in — beacon's redactDeep path", () => {
    expect(redactSecrets(HUE, { valueOnly: true }).redacted).toBe(
      "[REDACTED:hue-application-key]",
    );
  });

  it("works inside free text too — beacon's bridge-error path", () => {
    // Their two call shapes differ: one passes the bare value, one passes a
    // sentence. An anchored-only rule would serve the first and silently fail
    // the second, which is the half that carries the live error messages.
    const r = redactSecrets(`bridge said ${HUE} failed`, { valueOnly: true });
    expect(r.redacted).toBe("bridge said [REDACTED:hue-application-key] failed");
  });

  it("a git SHA is never touched, opted in or not", () => {
    const sha = "a".repeat(40);
    expect(redactSecrets(`sha ${sha}`, { valueOnly: true }).redacted).toContain(sha);
  });
});
