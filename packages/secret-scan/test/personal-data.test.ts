import { describe, expect, it } from 'vitest';
import { findPersonalData, hasPersonalData, redactPersonalData } from '../src/index';

const kinds = (t: string) => findPersonalData(t).map((m) => [m.kind, t.slice(m.start, m.end)]);

describe('F035.21 — CPR', () => {
  it('finds both forms, with exact offsets', () => {
    const t = 'cpr 010190-1234 og 0101901234.';
    expect(findPersonalData(t)).toEqual([
      { kind: 'cpr', start: 4, end: 15 },
      { kind: 'cpr', start: 19, end: 29 },
    ]);
  });

  it('takes the century from the 7th digit, so 29 Feb needs a leap year', () => {
    expect(kinds('290200-4123')).toEqual([['cpr', '290200-4123']]); // 2000: leap
    expect(kinds('290200-1123')).toEqual([]); // 1900: not a leap year
    expect(kinds('290296-1123')).toEqual([['cpr', '290296-1123']]); // 1996: leap
  });

  it('refuses impossible dates', () => {
    expect(kinds('311190-1234')).toEqual([]); // 31 November
    expect(kinds('320190-1234')).toEqual([]);
    expect(kinds('011390-1234')).toEqual([]);
    expect(kinds('000190-1234')).toEqual([]);
  });

  it('does not take a 10-digit order number with an impossible date', () => {
    expect(kinds('ordre 2024123456')).toEqual([]);
  });

  it('does not find a CPR inside a longer run of digits', () => {
    expect(kinds('konto 12010190123')).toEqual([]); // 2010190123 would be a valid CPR on its own
  });
});

describe('F035.21 — phone', () => {
  it.each([
    ['ring 20304050', '20304050'],
    ['ring 20 30 40 50', '20 30 40 50'],
    ['ring 2030 4050', '2030 4050'],
    ['ring 20-30-40-50', '20-30-40-50'],
    ['ring +45 20304050', '+45 20304050'],
    ['ring +4520304050', '+4520304050'],
    ['ring 0045 20 30 40 50', '0045 20 30 40 50'],
    ['call +14155552671', '+14155552671'],
  ])('%s', (t, hit) => {
    expect(kinds(t)).toEqual([['phone', hit]]);
  });

  it.each([
    ['seven digits', 'nr 2030405'],
    ['nine digits', 'nr 203040506'],
    ['starts with 1', 'nr 12345678'],
    ['an ISO date', 'den 2026-10-07'],
    ['a version string', 'version 0.12.1'],
  ])('not: %s', (_, t) => {
    expect(kinds(t)).toEqual([]);
  });
});

describe('F035.21 — phone fails CLOSED', () => {
  // A gate that must keep phone numbers out of Trail would rather refuse an
  // order number than miss a number written with an extra group.
  it('flags a longer grouped run rather than letting it through', () => {
    expect(hasPersonalData('ref 20 30 40 50 60')).toBe(true);
  });
});

describe('F035.21 — email', () => {
  it('finds an address', () => {
    expect(kinds('skriv til anne.hansen+trail@example.dk nu')).toEqual([['email', 'anne.hansen+trail@example.dk']]);
  });

  it('subdomains, a trailing full stop, and a one-letter TLD', () => {
    expect(kinds('mail a.b@mail.example.co.uk.')).toEqual([['email', 'a.b@mail.example.co.uk']]);
    expect(kinds('a@b.c')).toEqual([]);
  });

  it('not a bare @handle or a domain', () => {
    expect(kinds('@anne og example.dk')).toEqual([]);
  });
});

describe('F035.21 — redact / has', () => {
  it('redacts every kind and counts them, and says what it scanned', () => {
    const r = redactPersonalData('Anne 010190-1234, tlf 20304050, anne@example.dk, ellers +4520304051');
    expect(r.redacted).toBe(
      'Anne [REDACTED:cpr], tlf [REDACTED:phone], [REDACTED:email], ellers [REDACTED:phone]',
    );
    expect(r.findings).toEqual([
      { kind: 'cpr', count: 1 },
      { kind: 'phone', count: 2 },
      { kind: 'email', count: 1 },
    ]);
    expect(r.scanned).toEqual(['cpr', 'phone', 'email']);
  });

  it('leaves clean text untouched', () => {
    const r = redactPersonalData('Mødet flyttes til torsdag kl. 10.');
    expect(r).toEqual({ redacted: 'Mødet flyttes til torsdag kl. 10.', findings: [], scanned: ['cpr', 'phone', 'email'] });
    expect(hasPersonalData('Mødet flyttes til torsdag kl. 10.')).toBe(false);
    expect(hasPersonalData('tlf 20304050')).toBe(true);
  });
});

describe('F035.21 — stays linear on hostile input', () => {
  // The first email pattern backtracked: 50,000 characters took 30 s. This runs
  // before every write, on text we do not control. The bound is generous on
  // purpose (linear is ~5 ms here), so only a return of the blow-up turns it red.
  it.each([
    ['a dashed domain', 'a@' + 'a-'.repeat(25_000) + '!'],
    ['a dotted domain', 'a@' + 'a.'.repeat(25_000) + '1'],
    ['a run of local-part characters', 'a'.repeat(50_000) + '@'],
    ['a run of digits', '2'.repeat(50_000)],
  ])('%s', (_, t) => {
    const start = performance.now();
    findPersonalData(t);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
