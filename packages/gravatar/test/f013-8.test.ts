// F013.8 — an email in the NAME slot, and the invariant that should have
// existed from the start.
//
// THE REGRESSION, measured against the PUBLISHED 0.2.0 before fixing:
//   getInitials('cb@webhouse.dk')       → 'CD'   (0.1.0 gave 'CB')
//   getInitials('jens.hansen@firma.dk') → 'JD'
//   getInitials('x@webhouse.dk')        → 'XD'
// Every address ended in the TLD's first letter, because the unicode split
// made ['cb','webhouse','dk'] and the name branch took first + last.
//
// F013.7's AC#6 claimed "cb@webhouse.dk → 'CB' still holds" and PROVED it only
// for getInitials(null, 'cb@webhouse.dk'). The claim was about the common case;
// the test was about one argument position. Both green. The regression lived in
// the gap between them.
import { describe, it, expect } from 'vitest';
import { getInitials } from '../src/index';

const EMAILS = [
  'cb@webhouse.dk',
  'x@webhouse.dk',
  'jens.hansen@firma.dk',
  'christian@broberg.dk',
  '.hidden@x.dk',
  '1234@firma.dk',
];

describe('THE INVARIANT — the same string, either argument, the same answer', () => {
  // Not a case list. A table of individual cases can be complete and still miss
  // the RELATIONSHIP between the two arguments — which is exactly what broke.
  it.each(EMAILS)('getInitials(%o) === getInitials(null, %o)', (addr) => {
    expect(getInitials(addr)).toBe(getInitials(null, addr));
  });
});

describe('the regressed case is restored', () => {
  it.each([
    ['cb@webhouse.dk', 'CB'], // 0.1.0's answer, back
    ['x@webhouse.dk', 'X'],
    ['jens.hansen@firma.dk', 'JH'], // was 'JD' — the TLD
    ['christian@broberg.dk', 'CH'], // was 'CD'
  ])('getInitials(%o) → %o', (addr, expected) => {
    expect(getInitials(addr)).toBe(expected);
  });

  it("does NOT degrade to '??' — 0.1.0 was right and users saw it", () => {
    // Refusing would be a more honest-looking regression, but still a regression.
    expect(getInitials('cb@webhouse.dk')).not.toBe('??');
  });
});

describe('detection is conservative — a name containing @ is not an address', () => {
  it.each([
    ['Anne @ Hansen', 'AH'], // whitespace → not an address, stays on the name path
    ['a@b@c', 'AC'], // two @ → not an address
    ['@leading', 'LE'], // empty left side → not an address
    ['trailing@', 'TR'], // empty right side → not an address
  ])('%o stays on the NAME path → %o', (name, expected) => {
    expect(getInitials(name)).toBe(expected);
  });
});

describe('when both arguments are given, the name slot wins', () => {
  it('an address in the name slot beats the email argument', () => {
    // It is the value the caller chose to display.
    expect(getInitials('cb@webhouse.dk', 'x@andet.dk')).toBe('CB');
  });

  it('a real name still beats both', () => {
    expect(getInitials('Christian Broberg', 'x@andet.dk')).toBe('CB');
  });

  it('an unusable name falls through to the email argument', () => {
    expect(getInitials('((  ))', 'cb@webhouse.dk')).toBe('CB');
  });
});

describe('NOTHING FROM F013.7 REGRESSES', () => {
  // A fix for a regression that introduces another is this card's own subject,
  // twice over — so the previous release's cases are re-asserted here.
  it.each([
    [['Lens (verifikation)', null], 'LV'],
    [['  ', null], '??'],
    [['((  ))', null], '??'],
    [['李 明', null], '李明'],
    [['José', null], 'JO'],
    [['Christian Broberg', null], 'CB'],
    [[null, 'cb@webhouse.dk'], 'CB'],
    [[null, '.hidden@x.dk'], 'HI'],
    [[null, null], '??'],
  ] as const)('getInitials(...%o) → %o', (args, expected) => {
    expect(getInitials(args[0], args[1])).toBe(expected);
  });
});
