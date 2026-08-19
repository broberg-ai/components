// F073.3 — the two verbs no `target` can express. 232 of the fleet's 248 GAP runs.
//
// waitForUrl SUBSTRING-MATCHES THE FULL URL. That is a measurement, not a taste:
// cardmem's 162 recorded arguments split into two families —
//
//   path-like, with a slash    /app 51 · /dashboard 7 · / 6 · /tak 4 · /platform 4
//   bare host or fragment      moovyy…11 · broberg.ai 6 · wp-admin 5 · google.com/maps 4
//
// — and the second family cannot work under Playwright's default glob at all.
// `wp-admin` is a fragment in the middle of the URL. `/` is 6 runs and matches
// ANY url as a substring while matching only the root under glob. Adopting the
// default would have changed the meaning of at least 29 runs and turned the rest
// into full-timeout hangs on migration day.
//
// expectAbsent must WAIT for absence, and must NOT go through the patient resolve
// (F071.4): that exists to wait for something to APPEAR, so running an absence
// check through it would spend the whole budget hunting for the thing we are
// asserting is gone. Every passing expectAbsent would cost the full timeout —
// green, just slow, which is the kind of cost nobody traces back.
import { describe, it, expect } from 'vitest';
import { execStep } from '../src/flow.js';
import type { FlowStep } from '../src/schema.js';
import type { Page } from 'playwright';

// ── waitForUrl ───────────────────────────────────────────────────────────────

/** Captures the predicate handed to waitForURL so it can be exercised directly —
 *  the matcher IS the contract, and a test that only checks "we called waitForURL"
 *  would pass for glob, regex or equality alike. */
function urlPage(current = 'https://app.example.com/dashboard?tab=1') {
  let predicate: ((u: URL) => boolean) | null = null;
  const page = {
    waitForURL: async (p: (u: URL) => boolean) => {
      predicate = p;
      if (!p(new URL(current))) throw new Error('Timeout exceeded');
    },
    url: () => current,
  } as unknown as Page;
  return { page, matched: (u: string) => predicate!(new URL(u)) };
}

const urlStep = (url: string) => ({ action: 'waitForUrl', url }) as unknown as FlowStep;

describe('F073.3 — waitForUrl matches a SUBSTRING of the full URL', () => {
  it('matches a path-like argument, the commonest family', async () => {
    const { page, matched } = urlPage('https://app.example.com/app/admin/afdelinger');
    await execStep(page, urlStep('/app'), 'https://example.com', 5_000);
    expect(matched('https://app.example.com/app')).toBe(true);
  });

  it('matches a BARE FRAGMENT mid-URL — the family glob cannot express', async () => {
    // 5 real runs pass "wp-admin", which is neither a path nor a host.
    const { page } = urlPage('https://kunde.dk/wp-admin/options.php');
    await expect(execStep(page, urlStep('wp-admin'), 'https://example.com', 5_000)).resolves.toBeTruthy();
  });

  it('matches a bare HOST, with no leading slash', async () => {
    const { page } = urlPage('https://broberg.ai/admin/chat');
    await expect(execStep(page, urlStep('broberg.ai'), 'https://example.com', 5_000)).resolves.toBeTruthy();
  });

  it('"/" matches ANY url — 6 real runs depend on it, and glob would not', async () => {
    const { page, matched } = urlPage('https://x.dk/deeply/nested/page');
    await execStep(page, urlStep('/'), 'https://example.com', 5_000);
    expect(matched('https://anything.example/whatever')).toBe(true);
  });

  it('the QUERY STRING is inside the haystack — it is the full URL, not the path', async () => {
    const { page, matched } = urlPage('https://app.example.com/x?token=abc');
    await execStep(page, urlStep('token=abc'), 'https://example.com', 5_000);
    expect(matched('https://app.example.com/x?token=abc')).toBe(true);
  });

  it('NEGATIVE CONTROL: a substring that is not there does NOT match', async () => {
    // Without this, a matcher that returned true unconditionally would pass every
    // case above.
    const { page } = urlPage('https://app.example.com/dashboard');
    await expect(execStep(page, urlStep('/login'), 'https://example.com', 5_000)).rejects.toThrow();
  });

  it('the failure names the wanted string AND where the page actually is', async () => {
    // A failed login is the commonest use. "Timeout" alone is unreadable; where it
    // ACTUALLY went is the whole question.
    const { page } = urlPage('https://app.example.com/login?error=bad_password');
    await expect(execStep(page, urlStep('/dashboard'), 'https://example.com', 5_000)).rejects.toThrow(
      /never reached a URL containing "\/dashboard".*still at https:\/\/app\.example\.com\/login\?error=bad_password/s,
    );
  });
});

// ── expectAbsent ─────────────────────────────────────────────────────────────

/** Layers whose VISIBLE match-count changes over time. `visible` is a function of
 *  elapsed ms, so "still there", "never there" and "goes away at t" are all
 *  expressible — and distinguishable, which is the point. */
function absentPage(layers: Record<string, (ms: number) => number>) {
  const t0 = Date.now();
  const leaf = (key: string) => {
    const n = () => (layers[key] ?? (() => 0))(Date.now() - t0);
    return {
      filter: () => ({ count: async () => n() }),
      nth: () => leaf(key),
      first: () => leaf(key),
      count: async () => n(),
      isVisible: async () => n() > 0,
      waitFor: async () => {
        throw new Error('expectAbsent must not go through the patient resolve');
      },
    };
  };
  return {
    locator: () => leaf('css'),
    getByTestId: () => leaf('testid'),
    getByRole: () => leaf('role'),
    getByLabel: () => leaf('label'),
    getByPlaceholder: () => leaf('placeholder'),
    getByText: () => leaf('text'),
    waitForTimeout: async (ms: number) => new Promise((r) => setTimeout(r, ms)),
  } as unknown as Page;
}

const absentStep = (target: unknown) => ({ action: 'expectAbsent', target }) as unknown as FlowStep;

const timed = async (fn: () => Promise<unknown>) => {
  const t = Date.now();
  let threw: Error | null = null;
  try {
    await fn();
  } catch (e) {
    threw = e as Error;
  }
  return { ms: Date.now() - t, threw };
};

describe('F073.3 — expectAbsent', () => {
  it('an element that NEVER existed is a PASS, not an error', async () => {
    const page = absentPage({});
    await expect(execStep(page, absentStep('#gone'), 'https://example.com', 5_000)).resolves.toBeTruthy();
  });

  it('an element that is attached but HIDDEN counts as absent', async () => {
    // The layer reports 0 VISIBLE matches while still being in the DOM — the
    // daemon's semantic (poll count + isVisible), which this mirrors.
    const page = absentPage({ css: () => 0 });
    await expect(execStep(page, absentStep({ css: '#hidden' }), 'https://example.com', 5_000)).resolves.toBeTruthy();
  });

  it('AND IT IS FAST: an already-absent element does not spend the budget', async () => {
    // The whole reason expectAbsent must not use the patient resolve. 5000ms
    // budget; if it went through resolveTarget's pass 2, this would take ~5000ms
    // and still pass — green, just slow.
    const page = absentPage({});
    const { ms } = await timed(() => execStep(page, absentStep({ testid: 'gone', css: '#gone' }), 'https://example.com', 5_000));
    expect(ms).toBeLessThan(300);
  });

  it('an element that is STILL THERE fails, and the message names the layer', async () => {
    const page = absentPage({ css: () => 1 });
    const { threw } = await timed(() => execStep(page, absentStep({ css: '#toast' }), 'https://example.com', 300));
    expect(threw?.message).toMatch(/still visible via css/);
  });

  it('ALL layers must be gone — one layer still matching is a FAILURE', async () => {
    // The mirror of F071.4's presence rule: presence is "one layer hits", so
    // absence must be "no layer hits". Testid is gone; css is not.
    const page = absentPage({ testid: () => 0, css: () => 1 });
    const { threw } = await timed(() =>
      execStep(page, absentStep({ testid: 'toast', css: '.toast' }), 'https://example.com', 300),
    );
    expect(threw?.message).toMatch(/still visible via css/);
    expect(threw?.message).not.toMatch(/testid/);
  });

  it('it WAITS: an element that disappears mid-flight passes', async () => {
    const page = absentPage({ css: (ms) => (ms < 250 ? 1 : 0) });
    const { ms, threw } = await timed(() => execStep(page, absentStep({ css: '#toast' }), 'https://example.com', 3_000));
    expect(threw).toBeNull();
    expect(ms).toBeGreaterThan(200);
  });

  it('the budget is the caller’s: a never-absent element fails at ~timeout, once', async () => {
    const page = absentPage({ css: () => 1 });
    const { ms, threw } = await timed(() => execStep(page, absentStep({ css: '#toast' }), 'https://example.com', 600));
    expect(threw).toBeTruthy();
    expect(ms).toBeGreaterThanOrEqual(550);
    expect(ms).toBeLessThan(1_200);
  });

  it('nth is honoured: "the third row is gone" is "fewer than three visible"', async () => {
    const page = absentPage({ css: () => 2 });
    await expect(
      execStep(page, absentStep({ css: '.row', nth: 2 }), 'https://example.com', 300),
    ).resolves.toBeTruthy();
    // …and with three, the third IS there.
    const three = absentPage({ css: () => 3 });
    await expect(execStep(three, absentStep({ css: '.row', nth: 2 }), 'https://example.com', 300)).rejects.toThrow();
  });
});
