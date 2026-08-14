import { describe, expect, it } from "vitest";
import { ANNOUNCED_LABEL, hasAnnouncedSecret, hasSecret, redactSecrets } from "../src/index";

/**
 * F035.8 — announced secrets. Filed by buddy after cardmem found a plaintext
 * password as the FIRST LINE of an ingested mail and redactSecrets() passed it
 * through unchanged: the package matches key FORMATS, and here the label
 * carries the signal while the value is arbitrary human text.
 *
 * These seven forms were verified against the published 0.1.8 BEFORE any code
 * was written — all seven passed through untouched. So they are a real red, not
 * a suite written to fit an implementation.
 */
const SEVEN_FORMS: Array<[name: string, text: string, secret: string]> = [
  ["English label, colon", "Password: hunter2", "hunter2"],
  ["Danish label, colon", "Adgangskode: Fejl-ugl!23", "Fejl-ugl!23"],
  ["equals separator with spaces", "kodeord = abc123", "abc123"],
  ["two-word label", "API key: xyz789abc", "xyz789abc"],
  ["no-space equals", "password=Sommer2026!", "Sommer2026!"],
  // Was "Her er min kode: …" until 0.4.0, when bare `kode` was removed — see the
  // Danish-corpus block below. The PROPERTY under test is mid-sentence
  // detection, not that one word, so it keeps its slot with a credential word.
  ["mid-sentence", "Her er min adgangskode: TopHemmelig1", "TopHemmelig1"],
  [
    "mail-shaped body",
    "Hej Christian\n\nAdgangskode: hunter2\n\nVenlig hilsen\nEn kunde",
    "hunter2",
  ],
];

describe("off by default — the whole reason this is a second axis", () => {
  it("redactSecrets('Adgangskode: hunter2') is byte-identical with no options", () => {
    // RED if the default ever flips. It must not: measured on this repo
    // 2026-08-14, the shipped pattern matched 97 times across 544 text files
    // with no real secrets in them — 61 `secret`, 33 `api key`, 4 `password`.
    const input = "Adgangskode: hunter2";
    const r = redactSecrets(input);
    expect(r.redacted).toBe(input);
    expect(r.findings).toEqual([]);
  });

  it("all seven forms pass through untouched by default", () => {
    for (const [name, text] of SEVEN_FORMS) {
      expect(redactSecrets(text).redacted, name).toBe(text);
    }
  });

  it("hasSecret is unchanged by default — a code file full of `secret:` stays clean", () => {
    const code = "const opts = { secret: config.secret, apiKey: process.env.RESEND_API_KEY };";
    expect(hasSecret(code)).toBe(false);
  });
});

describe("with { announced: true } — all seven verified forms", () => {
  for (const [name, text, secret] of SEVEN_FORMS) {
    it(`redacts: ${name}`, () => {
      const r = redactSecrets(text, { announced: true });
      expect(r.redacted).not.toContain(secret);
      expect(r.redacted).toContain(`[REDACTED:${ANNOUNCED_LABEL}]`);
      expect(r.findings).toContainEqual({
        label: ANNOUNCED_LABEL,
        count: 1,
        confidence: "announced",
      });
    });
  }

  it("keeps the announcing LABEL, so the redacted text still says what was removed", () => {
    const r = redactSecrets("Adgangskode: hunter2", { announced: true });
    expect(r.redacted).toBe(`Adgangskode: [REDACTED:${ANNOUNCED_LABEL}]`);
  });

  it("counts every occurrence in one body, not just the first", () => {
    const r = redactSecrets("Password: aaa\nKodeord: bbb\npwd=ccc", { announced: true });
    expect(r.findings).toContainEqual({ label: ANNOUNCED_LABEL, count: 3, confidence: "announced" });
    for (const leaked of ["aaa", "bbb", "ccc"]) expect(r.redacted).not.toContain(leaked);
  });

  it("hasSecret honours the option — a caller told `false` must be able to believe it", () => {
    // The trap this closes: RedactOptions now carries `announced`, so passing it
    // to hasSecret and getting `false` would otherwise be a confident wrong
    // answer rather than a missing feature.
    expect(hasSecret("Adgangskode: hunter2")).toBe(false);
    expect(hasSecret("Adgangskode: hunter2", { announced: true })).toBe(true);
  });
});

describe("the format axis is untouched when announced is on", () => {
  const FORMAT_SAMPLES: Array<[label: string, sample: string]> = [
    ["anthropic-api-key", "sk-ant-api03-" + "A".repeat(80)],
    ["github-token", "ghp_" + "f".repeat(36)],
    ["aws-access-key-id", "AKIA" + "EXAMPLE0123456789".slice(0, 16)],
  ];

  for (const [label, sample] of FORMAT_SAMPLES) {
    it(`${label} still redacts, with confidence 'format'`, () => {
      const r = redactSecrets(`her: ${sample}`, { announced: true });
      expect(r.redacted).toContain(`[REDACTED:${label}]`);
      expect(r.findings.find((f) => f.label === label)?.confidence).toBe("format");
    });
  }

  it("a format match inside an announcing line keeps its SPECIFIC attribution", () => {
    // Order is load-bearing: announced runs last and refuses a value that is
    // already a marker. Reverse the order and this flattens to a generic
    // `announced-secret`, losing the fact that it was an Anthropic key.
    const r = redactSecrets("API key: sk-ant-api03-" + "A".repeat(80), { announced: true });
    expect(r.redacted).toBe("API key: [REDACTED:anthropic-api-key]");
    expect(r.findings.map((f) => f.label)).not.toContain(ANNOUNCED_LABEL);
  });
});

describe("hasAnnouncedSecret — buddy's refuse-path, proven both ways", () => {
  it("detects a mail whose first line announces a password", () => {
    expect(hasAnnouncedSecret("Adgangskode: hunter2\n\nHej, her er mit login.")).toBe(true);
  });

  it("does NOT fire on prose that merely mentions the word", () => {
    // The half that makes it usable. A boolean that is always true would pass
    // the line above and is worthless — this is the case that separates them.
    expect(hasAnnouncedSecret("Jeg har glemt mit password og kan ikke logge ind.")).toBe(false);
    expect(hasAnnouncedSecret("Send venligst en ny adgangskode til mig.")).toBe(false);
    expect(hasAnnouncedSecret("We never store your password in plaintext.")).toBe(false);
  });

  it("is repeatable — a global regex must not carry lastIndex between calls", () => {
    const text = "Password: hunter2";
    expect(hasAnnouncedSecret(text)).toBe(true);
    expect(hasAnnouncedSecret(text)).toBe(true);
    expect(hasAnnouncedSecret(text)).toBe(true);
  });

  it("empty and whitespace input are false, not a throw", () => {
    expect(hasAnnouncedSecret("")).toBe(false);
    expect(hasAnnouncedSecret("   \n  ")).toBe(false);
  });
});

describe("scanned[] — which question did this call ask? (v0.3.0)", () => {
  it("THE PAIR THAT USED TO BE INDISTINGUISHABLE", () => {
    // Both return findings: []. Before 0.3.0 nothing in the return value said
    // that the first one never examined the announced axis, so a caller could
    // read "clean" off a password it had simply not looked for.
    const missedIt = redactSecrets("Adgangskode: hunter2");
    const genuinelyClean = redactSecrets("Hej, intet at se her", { announced: true });

    expect(missedIt.findings).toEqual([]);
    expect(genuinelyClean.findings).toEqual([]); // identical so far…

    expect(missedIt.scanned).not.toContain("announced"); // …and now separable
    expect(genuinelyClean.scanned).toContain("announced");
  });

  it("reports ['format'] with no options and both axes with the flag", () => {
    expect(redactSecrets("x").scanned).toEqual(["format"]);
    expect(redactSecrets("x", { announced: true }).scanned).toEqual(["format", "announced"]);
  });

  it("is computed from the OPTIONS, so a dirty body and a clean one agree", () => {
    // It answers "what did we look for", never "what did we find" — otherwise a
    // caller could not tell a clean scan from an unscanned one, which is the
    // whole point.
    const dirty = redactSecrets("Adgangskode: hunter2", { announced: true });
    const clean = redactSecrets("nothing here", { announced: true });
    expect(dirty.scanned).toEqual(clean.scanned);
    expect(dirty.findings.length).toBeGreaterThan(0);
    expect(clean.findings).toEqual([]);
  });

  it("empty input returns the same shape — a blank body must not change the contract", () => {
    expect(redactSecrets("").scanned).toEqual(["format"]);
    expect(redactSecrets("", { announced: true }).scanned).toEqual(["format", "announced"]);
  });
});

describe("bare `kode` is Danish for SOURCE CODE, not a credential (v0.4.0)", () => {
  // Filed by buddy from 82,662 lines of real Danish transcription. Two reasons
  // it went, and the second is the one that settled it:
  //  (a) the credential words are `kodeord` / `adgangskode`;
  //  (b) the old behaviour was decided by a HYPHEN — `\b` meant `Landekode:`
  //      never matched while `QR-kode:` did.
  it("does not fire on ordinary Danish technical prose", () => {
    for (const t of [
      "Det er min kode: se linje 40",
      "Kode: const x = 1",
      "Merge-kode: konflikten er løst",
      "- Det er edge-kode: den kører på cb-ubuntu",
      "QR-kode: scan den",
    ]) {
      expect(hasAnnouncedSecret(t), t).toBe(false);
    }
  });

  it("the compounds that already passed still pass — no regression on the accidental half", () => {
    for (const t of ["Landekode: DK", "Postkode: 9492", "Fejlkode: 500", "Rabatkode: SOMMER"]) {
      expect(hasAnnouncedSecret(t), t).toBe(false);
    }
  });

  it("the real Danish credential words still fire", () => {
    expect(hasAnnouncedSecret("kodeord = abc123")).toBe(true);
    expect(hasAnnouncedSecret("Adgangskode: hunter2")).toBe(true);
    expect(hasAnnouncedSecret("Her er min adgangskode: TopHemmelig1")).toBe(true);
  });

  it("THE COST, pinned so it stays a decision: `min kode: hunter2` is now MISSED", () => {
    // Not an oversight. If this ever flips back, it should flip deliberately and
    // this test is what makes that visible rather than silent.
    expect(hasAnnouncedSecret("Her er min kode: hunter2")).toBe(false);
  });
});

describe("boundaries — a label alone is not a secret, but a wrapped line still is", () => {
  it("a label with a separator but NO value does not fire", () => {
    // buddy surfaced this after adopting 0.2.0: their own patch keyed on
    // label+separator and flagged an ordinary mail, while this one requires
    // something to actually FOLLOW. That is the difference between a guard and
    // a noise source, and it deserves to be a named property rather than a
    // side-effect of `\S+`.
    expect(hasAnnouncedSecret("Password:")).toBe(false);
    expect(hasAnnouncedSecret("Password: ")).toBe(false);
    expect(hasAnnouncedSecret("Adgangskode:\n")).toBe(false);
  });

  it("a value on the NEXT line still counts — mail wraps, secrets do not stop being secrets", () => {
    // The deliberate cost of that: `\s*` crosses a newline, so a line ending in
    // `password:` followed by a paragraph redacts that paragraph's first word.
    // Kept on purpose — the split-line form is a real mail shape, and the damage
    // is one visibly-marked word, not a silent miss.
    expect(hasAnnouncedSecret("Adgangskode:\nhunter2")).toBe(true);
    const r = redactSecrets("Adgangskode:\nhunter2", { announced: true });
    expect(r.redacted).toBe(`Adgangskode:\n[REDACTED:${ANNOUNCED_LABEL}]`);
    // the newline survives — it is inside the kept prefix, not eaten by the match
    expect(r.redacted).toContain("\n");
  });
});
