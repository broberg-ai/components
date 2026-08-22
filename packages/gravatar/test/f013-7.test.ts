// F013.7 — a Gravatar outage read as "no avatar", and a bracketed name as "L(".
//
// THE RED IS PINNED, not described. Every value below was measured against the
// SHIPPED 0.1.0 before a line was changed:
//
//   getInitials('Lens (verifikation)')      → 'L('    ← moovyy's production surface
//   getInitials(null, 'x@webhouse.dk')      → 'X@'    ← the doc said "prefix"; the code said otherwise
//   getInitials('  ')                       → '  '    ← two SPACES, not '??'
//   getInitials('((  ))')                   → '()'
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getInitials, gravatarLookup, gravatarExists } from '../src/index';

afterEach(() => vi.unstubAllGlobals());

/** Drive fetch to one outcome. */
function fetchYields(outcome: { status: number } | Error) {
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (outcome instanceof Error) throw outcome;
    return new Response(null, { status: outcome.status });
  }));
}

describe('gravatarLookup — three outcomes, because there are three', () => {
  it('404 → no (genuinely no avatar)', async () => {
    fetchYields({ status: 404 });
    expect(await gravatarLookup('a@b.dk')).toBe('no');
  });

  it('200 → yes', async () => {
    fetchYields({ status: 200 });
    expect(await gravatarLookup('a@b.dk')).toBe('yes');
  });

  // Each of these is asserted SEPARATELY. Collapsing any ONE of them back into
  // 'no' is the entire defect, so a single "not-yes" test would not catch it.
  it('503 → unknown, NOT no — an outage must never be cached as "no avatar"', async () => {
    fetchYields({ status: 503 });
    expect(await gravatarLookup('a@b.dk')).toBe('unknown');
  });

  it('a network throw → unknown, NOT no', async () => {
    fetchYields(new Error('ECONNRESET'));
    expect(await gravatarLookup('a@b.dk')).toBe('unknown');
  });

  it('429 rate-limit → unknown, NOT no', async () => {
    fetchYields({ status: 429 });
    expect(await gravatarLookup('a@b.dk')).toBe('unknown');
  });

  it('an unexpected 302 → unknown, NOT yes', async () => {
    // res.ok is false for a 302, and guessing either way would be a claim we
    // have no evidence for.
    fetchYields({ status: 302 });
    expect(await gravatarLookup('a@b.dk')).toBe('unknown');
  });
});

describe('gravatarExists — unchanged for existing callers, and honest about the cost', () => {
  it.each([
    [200, true],
    [404, false],
    [503, false], // still false — that is the LOSSY behaviour the name promises
  ])('status %i → %s', async (status, expected) => {
    fetchYields({ status });
    expect(await gravatarExists('a@b.dk')).toBe(expected);
  });

  it('503 and 404 are INDISTINGUISHABLE through this function — pinned so the limitation is visible', async () => {
    fetchYields({ status: 404 });
    const onNoAvatar = await gravatarExists('a@b.dk');
    fetchYields({ status: 503 });
    const onOutage = await gravatarExists('a@b.dk');
    expect(onOutage).toBe(onNoAvatar);
    // …which is exactly why gravatarLookup exists.
    fetchYields({ status: 404 });
    const lookupNo = await gravatarLookup('a@b.dk');
    fetchYields({ status: 503 });
    const lookupOutage = await gravatarLookup('a@b.dk');
    expect(lookupOutage).not.toBe(lookupNo);
  });
});

describe('getInitials — letters, not characters', () => {
  it.each([
    ['Lens (verifikation)', 'LV'], // was 'L(' — measured in moovyy's production
    ['((  ))', '??'], // was '()'
    ['  ', '??'], // was '  ' — two spaces in an avatar circle
    ['Jens-Peter Ø. Hansen', 'JH'],
  ])('%o → %o', (name, expected) => {
    expect(getInitials(name)).toBe(expected);
  });

  it.each([
    ['Christian Broberg', 'CB'],
    ['Anne-Marie Sørensen', 'AS'],
    ['José', 'JO'],
    ['李 明', '李明'],
  ])('STILL WORKS: %o → %o', (name, expected) => {
    // The negative control on the regex. A \p{L} class that quietly excluded
    // CJK or accented Latin would pass every ASCII test above and break real
    // users — so these are first-class cases, not afterthoughts.
    expect(getInitials(name)).toBe(expected);
  });

  it('digits count as name material — "R2 D2" is a name to somebody', () => {
    expect(getInitials('R2 D2')).toBe('RD');
    expect(getInitials('4chan')).toBe('4C');
  });
});

describe('getInitials — the email branch finally does what its doc always claimed', () => {
  it.each([
    ['x@webhouse.dk', 'X'], // was 'X@'
    ['.hidden@x.dk', 'HI'], // was '.H'
    ['cb@webhouse.dk', 'CB'], // MUST still hold — it was right by luck, and it stays right
    ['jens.hansen@firma.dk', 'JH'],
    ['1234@firma.dk', '12'],
  ])('getInitials(null, %o) → %o', (email, expected) => {
    expect(getInitials(null, email)).toBe(expected);
  });

  it("'??' IS REACHABLE — an address with no usable letters falls through", () => {
    expect(getInitials(null, '...@x.dk')).toBe('??');
    expect(getInitials(null, '')).toBe('??');
    expect(getInitials(null, null)).toBe('??');
  });

  it('a whitespace-only NAME falls through to the email rather than blanking', () => {
    // The old code returned '  ' here and never consulted the email at all.
    expect(getInitials('   ', 'cb@webhouse.dk')).toBe('CB');
  });
});
