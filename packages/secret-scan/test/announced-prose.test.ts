// F035.11 — the `announced` axis was eating the word after the label.
//
// Found by super, verified by buddy against 40,369 rows of real fleet prose
// (23,801 intercom messages + 16,568 conversation turns), and reproduced here
// against the PUBLISHED 0.5.1 before a line was changed.
//
// BOTH DIRECTIONS, and the negative one CHARACTER FOR CHARACTER. buddy's framing
// and it is the reason this file exists in this shape: an over-broad redaction
// destroys a corpus as effectively as a narrow one leaks it. "No finding" is a
// weaker claim than "unchanged", and only the second one is what a corpus needs.
import { describe, expect, it } from 'vitest';
import { hasAnnouncedSecret, hasSecret, redactSecrets } from '../src/index.js';

/** buddy's real strings, from their corpus. Not invented for this test. */
const PROSE = [
  'Set som secret: gh secret set MYPAT',
  'indeholder ÉN secret: en openrouter-nøgle',
  'client secret: abc',
  'jeg siger det aldrig — secret: ALDRIG',
];

describe('prose that merely mentions the label is untouched', () => {
  it.each(PROSE)('leaves %j byte-identical', (s) => {
    const r = redactSecrets(s, { announced: true });
    // Strict equality on the WHOLE string, both printed on failure.
    expect(r.redacted).toBe(s);
    expect(r.findings).toEqual([]);
  });

  it('hasAnnouncedSecret agrees with redactSecrets on the same input', () => {
    // Two functions answering the same question differently is worse than
    // either answer, because a caller can only ask one of them.
    for (const s of PROSE) {
      expect(hasAnnouncedSecret(s)).toBe(false);
      expect(hasSecret(s, { announced: true })).toBe(false);
    }
  });
});

describe('the hole the axis exists for is still closed', () => {
  // NEGATIVE CONTROL. Without this the tests above pass on an axis that has been
  // weakened into uselessness — which is the trade buddy explicitly refused.
  it('still redacts the documented case', () => {
    const r = redactSecrets('Adgangskode: hunter2', { announced: true });
    expect(r.redacted).toBe('Adgangskode: [REDACTED:announced-secret]');
    expect(r.findings).toEqual([{ label: 'announced-secret', count: 1, confidence: 'announced' }]);
    expect(hasAnnouncedSecret('Adgangskode: hunter2')).toBe(true);
  });

  it('still redacts a long digit-free value — length alone is enough', () => {
    const r = redactSecrets('password: correcthorsebatterystaple', { announced: true });
    expect(r.redacted).toBe('password: [REDACTED:announced-secret]');
  });

  // THE 16 IS A MEASUREMENT, SO IT MUST BE PINNED LIKE ONE. Measured on this
  // suite before these two existed: changing `>= 16` to `>= 17` left all 178
  // tests green. The only length fixture was 25 characters and the longest
  // rejected one was 6, so the threshold could sit anywhere in a nine-character
  // window and nothing would notice — a magic number wearing a measurement's
  // clothes. buddy separated digit-free prose from digit-free secrets at exactly
  // 16 (35 of 49 candidates), and these are the two strings that hold it there.
  //
  // Both are digit-free on purpose: with a digit the value takes the other
  // branch and the length rule is never reached, which is how every existing
  // announced fixture missed this.
  it.each([
    ['abcdefghijklmno', 15, false],
    ['abcdefghijklmnop', 16, true],
  ])('a digit-free %s is %i chars → redacted: %s', (value, length, redacted) => {
    expect(value).toHaveLength(length); // the fixture, not the code
    const r = redactSecrets(`password: ${value}`, { announced: true });
    expect(r.redacted).toBe(
      redacted ? 'password: [REDACTED:announced-secret]' : `password: ${value}`,
    );
    expect(hasAnnouncedSecret(`password: ${value}`)).toBe(redacted);
  });

  it('redacts one candidate and leaves the other, in the same string', () => {
    // The discriminating case: a single call where the rule must say yes and no.
    // A test with only one candidate per string passes on an implementation that
    // decides per CALL rather than per candidate.
    const s = 'secret: ALDRIG og Adgangskode: hunter2';
    expect(redactSecrets(s, { announced: true }).redacted).toBe(
      'secret: ALDRIG og Adgangskode: [REDACTED:announced-secret]',
    );
  });
});

describe('the format axis is not affected by the plausibility test', () => {
  it('a format-recognised value is redacted with its OWN label', () => {
    // The announced pass runs after the format pass and refuses a value that is
    // already a marker, so a real key keeps its specific attribution. Asserted
    // rather than assumed, because the plausibility test now sits on that path.
    const r = redactSecrets('API key: sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', {
      announced: true,
    });
    expect(r.redacted).toContain('[REDACTED:anthropic-api-key]');
    expect(r.redacted).not.toContain('announced-secret');
  });
});

describe('"we looked and found nothing" stays distinct from "we never looked"', () => {
  it('scanned still reports announced when every candidate was rejected', () => {
    // 0.3.0's whole contract. A fix that quietly dropped the axis from `scanned`
    // would break it while looking correct.
    const r = redactSecrets('client secret: abc', { announced: true });
    expect(r.scanned).toContain('announced');
    expect(r.findings).toEqual([]);
  });

  it('and does NOT report it when the flag was not set', () => {
    expect(redactSecrets('client secret: abc').scanned).not.toContain('announced');
  });
});
