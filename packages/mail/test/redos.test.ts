// F115.2 — CodeQL js/polynomial-redos: caller-supplied strings must not take quadratic time.
import { describe, it, expect } from 'vitest';
import { senderDomain } from '../src/verify';

const fast = (fn: () => unknown) => { const t = Date.now(); try { fn(); } catch { /* a refusal is fine; slowness is not */ } return Date.now() - t; };

describe('F115.2 — senderDomain on hostile input', () => {
  it('a 200k run of "<" is handled in linear time', () => {
    expect(fast(() => senderDomain('<'.repeat(200_000)))).toBeLessThan(500);
  });
  it('still reads "Name <a@b.dk>" and a bare domain', () => {
    expect(senderDomain('Navn <hej@Eksempel.dk>')).toBe('eksempel.dk');
    expect(senderDomain('eksempel.dk')).toBe('eksempel.dk');
  });
});
