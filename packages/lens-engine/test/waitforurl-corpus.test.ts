// F073.3 — every waitForUrl argument the fleet has ever sent, run through the
// implemented matcher. The whole corpus, not a sample: the same method found
// `body` as the 115th of 115 selectors in F071.2, and a sample would have missed it.
//
// SUPPLIED BY cardmem from the daemon's agent.db (162 step results, 51 distinct).
// THIRTEEN OF THE 51 ARE NOT ARGUMENTS — the store persists the step RESULT, and
// `label` is overwritten by the manuscript author's own prose when one is set
// ("redirect tilbage til kvittering", "navigated to case"). Running those through
// a matcher would be testing sentences. They are listed below so the exclusion is
// visible rather than a quiet trim.
//
// 38 distinct real arguments across 149 runs. Status over the corpus' whole
// lifetime: pass 136 · fail 8 · skip 18.
import { describe, it, expect } from 'vitest';

/** THE MATCHER THE VERB ACTUALLY USES — imported, not restated. An earlier draft
 *  of this file carried its own one-line copy, which would have kept passing
 *  while the verb drifted away from it. A rule restated in two places is how F064
 *  and F066 got in. */
import { urlMatches } from '../src/flow.js';

const substring = (want: string) => (url: string) => urlMatches(want, url);

/** argument → a real URL it is meant to match. Four families, and cardmem found
 *  the fourth (query fragments) only on the second extraction. */
const CORPUS: Array<[string, string, string]> = [
  // ── family 1: path-like, with a slash ─────────────────────────────────────
  ['/app', 'https://fd-sundhed.dk/app', 'path'],
  ['/dashboard', 'https://cardmem.com/dashboard', 'path'],
  ['/', 'https://anything.example/whatever/at/all', 'path'],
  ['/tak', 'https://sanneandersen.dk/tak', 'path'],
  ['/platform', 'https://broberg.ai/platform', 'path'],
  ['/app/admin/afdelinger', 'https://fd-sundhed.dk/app/admin/afdelinger', 'path'],
  ['/fleet/feed', 'https://cardmem.com/fleet/feed', 'path'],
  ['/qigong', 'https://sanneandersen.dk/qigong', 'path'],
  ['/app/leder/indberetninger', 'https://fd-sundhed.dk/app/leder/indberetninger', 'path'],
  ['/app/booking', 'https://fd-sundhed.dk/app/booking', 'path'],
  ['/en/flagships/cms', 'https://broberg.ai/en/flagships/cms', 'path'],
  ['/fleet/intercom', 'https://cardmem.com/fleet/intercom', 'path'],
  ['/app/indberet', 'https://fd-sundhed.dk/app/indberet', 'path'],
  ['/app/indberetninger', 'https://fd-sundhed.dk/app/indberetninger', 'path'],
  ['/login', 'https://xrt81.com/login', 'path'],
  ['/notifications', 'https://cardmem.com/notifications', 'path'],
  ['/fleet/tasks', 'https://cardmem.com/fleet/tasks', 'path'],
  ['/fleet/settings', 'https://cardmem.com/fleet/settings', 'path'],
  ['/jobs/', 'https://autodoc.example/jobs/', 'path'],
  ['/account', 'https://how.example/account', 'path'],
  ['/da/behandlinger', 'https://sanneandersen.dk/da/behandlinger', 'path'],
  ['/mediearkiv', 'https://fd-sundhed.dk/mediearkiv', 'path'],
  ['/guides', 'https://broberg.ai/guides', 'path'],
  ['/app/leder/indberetninger/f80f8760', 'https://fd-sundhed.dk/app/leder/indberetninger/f80f8760', 'path'],
  ['/indberetninger/757d541c', 'https://fd-sundhed.dk/indberetninger/757d541c', 'path'],
  // ── family 2: bare host or fragment, NO leading slash ─────────────────────
  ['broberg.ai', 'https://broberg.ai/admin', 'host-or-fragment'],
  ['wp-admin', 'https://kunde.dk/wp-admin/options.php', 'host-or-fragment'],
  ['google.com/maps', 'https://www.google.com/maps/place/x', 'host-or-fragment'],
  ['broberg.ai/admin/chat', 'https://broberg.ai/admin/chat', 'host-or-fragment'],
  ['maps', 'https://www.google.com/maps', 'host-or-fragment'],
  ['kvittering', 'https://sanneandersen.dk/kvittering/4711', 'host-or-fragment'],
  ['xrt81.com', 'https://xrt81.com/dashboard', 'host-or-fragment'],
  ['accept-invite', 'https://cardmem.com/accept-invite?t=abc', 'host-or-fragment'],
  // ── family 3: QUERY FRAGMENT — mid-URL, neither a path nor a host ─────────
  ['folder=', 'https://pitch.broberg.dk/list?folder=5DnP', 'query-fragment'],
  ['project=fd-sundhed', 'https://cardmem.com/board?project=fd-sundhed', 'query-fragment'],
  ['status=godkendt', 'https://fd-sundhed.dk/app/indberetninger?status=godkendt', 'query-fragment'],
  ['status=afvist', 'https://fd-sundhed.dk/app/indberetninger?status=afvist', 'query-fragment'],
  // ── family 4: a full URL ──────────────────────────────────────────────────
  ['https://xrt81.com/', 'https://xrt81.com/', 'full-url'],
];

/** Persisted prose, not arguments. Recorded so the exclusion is auditable. */
const PROSE_LABELS = [
  'redirect tilbage til kvittering',
  'redirect til kvittering',
  'F027: URL skiftede til /en',
  'navigated to case',
  'navigated to /cases index',
  'navigated to Fejl',
  'redirected to broberg.ai (authed)',
  'landed on broberg.ai connect confirmation',
  'landed on the case page (edit mode activating)',
  'landed, edit mode active',
  'we landed on the portal route',
  'landed on the portal',
];

describe('F073.3 — the whole waitForUrl corpus', () => {
  it('all 38 distinct arguments match the URL they were written for', () => {
    const misses = CORPUS.filter(([want, url]) => !substring(want)(url));
    expect(misses).toEqual([]);
    expect(CORPUS).toHaveLength(38);
  });

  it('all four families are represented — the fourth was found on the SECOND pass', () => {
    // cardmem's first extraction reported two families. `folder=`,
    // `project=fd-sundhed`, `status=godkendt` and `status=afvist` are query
    // fragments: not paths, not hosts, and the worst case for a glob port.
    const families = new Set(CORPUS.map(([, , f]) => f));
    expect([...families].sort()).toEqual(['full-url', 'host-or-fragment', 'path', 'query-fragment']);
    expect(CORPUS.filter(([, , f]) => f === 'query-fragment')).toHaveLength(4);
  });

  it('NEGATIVE CONTROL: each argument FAILS against a URL it should not match', () => {
    // Without this the suite would pass for a matcher that returned true always —
    // and "/" would hide it, since "/" legitimately matches everything.
    const decoy = 'https://elsewhere.invalid';
    const wrongly = CORPUS.filter(([want]) => want !== '/' && substring(want)(decoy));
    expect(wrongly).toEqual([]);
  });

  it('"/" really does match ANY url — 6 runs depend on it', () => {
    for (const u of ['https://a.dk/', 'https://b.dk/deep/path', 'https://c.dk/x?y=z']) {
      expect(substring('/')(u)).toBe(true);
    }
  });

  it('the excluded prose labels are recorded, not silently trimmed', () => {
    // A corpus that quietly shrinks is how the original defect shipped (F073.1's
    // 15th verb). 51 distinct = 38 arguments + 13 prose labels; one of the 13 is
    // a duplicate spelling, so the list holds 12 unique sentences.
    expect(PROSE_LABELS.length + CORPUS.length).toBeGreaterThanOrEqual(50);
    expect(PROSE_LABELS.every((l) => l.includes(' '))).toBe(true);
  });
});

describe('F073.3 — what a glob port would have done, argument by argument', () => {
  // Playwright: "if the parameter is a string without wildcard characters, the
  // method will wait for navigation to URL that is exactly equal to the string."
  // DOCUMENTED, not executed here — reaching a real browser is cardmem's arm, and
  // this file states the rule it is reasoning from so the claim can be checked.
  const globWouldMatch = (want: string, url: string) => (want.includes('*') ? null : want === url);

  it('37 of the 38 would never have matched — only the one full URL survives', () => {
    const survives = CORPUS.filter(([want, url]) => globWouldMatch(want, url) === true);
    expect(survives.map(([w]) => w)).toEqual(['https://xrt81.com/']);
    expect(CORPUS.length - survives.length).toBe(37);
  });

  it('not one argument carries a wildcard, which is why the rule applies to all of them', () => {
    expect(CORPUS.filter(([want]) => want.includes('*'))).toEqual([]);
  });
});
