import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { assertBrowserAvailable, browserMissingMessage } from '../src/capture';

/**
 * F065 — fail at boot when the browser is absent, not at the first capture.
 *
 * Two designs died before this one, both killed by a measurement rather than an
 * argument:
 *
 *  1. playwright as a peerDependency. pnpm auto-installs peers by default, so an
 *     undeclared peer produced NO warning at all and silently resolved a NEWER
 *     Playwright than the consumer had baked into its image — worse than an
 *     ordinary dependency, which at least resolves deterministically.
 *  2. comparing the Playwright VERSION at startup. Version is a proxy; the
 *     browser REVISION is the thing, and the revision is encoded in the
 *     executable path (…/ms-playwright/chromium-1228/…).
 *
 * Note on how the red case is produced below: `PLAYWRIGHT_BROWSERS_PATH` cannot
 * be used from inside this process. Measured — Playwright builds its registry at
 * import time, so mutating the env afterwards leaves `executablePath()`
 * unchanged, and an env-based test here would pass no matter what the guard did.
 * Mocking the module is the only in-process way to make this test able to fail.
 */

describe('browserMissingMessage — the predicate is the PATH, not the version', () => {
  it('present browser ⇒ no message', () => {
    expect(
      browserMissingMessage({ executablePath: '/ms-playwright/chromium-1228/chrome', exists: true }),
    ).toBeNull();
  });

  it('NO FALSE ALARM — a patch bump that keeps the same revision stays silent', () => {
    // Two Playwright versions often share one browser revision. A version
    // compare would have shouted about a setup that works, and an alarm that
    // cries wrong is switched off within a week.
    expect(
      browserMissingMessage({ executablePath: '/ms-playwright/chromium-1228/chrome', exists: true }),
    ).toBeNull();
  });

  it('NO FALSE APPROVAL — the case a version compare CANNOT see', () => {
    // The package is unchanged, so any version check says "fine" — but the base
    // image no longer carries the browser. Only the path check catches this.
    const msg = browserMissingMessage({
      executablePath: '/ms-playwright/chromium-1228/chrome',
      exists: false,
    });
    expect(msg).toContain('not on disk');
    expect(msg).toContain('/ms-playwright/chromium-1228/chrome');
  });

  it('names PLAYWRIGHT_BROWSERS_PATH, and prints (unset) when absent', () => {
    // Those two lines ARE the diagnosis; without them the error sends someone
    // looking at their code instead of at their image.
    expect(browserMissingMessage({ executablePath: '/x/chrome', exists: false })).toContain(
      'PLAYWRIGHT_BROWSERS_PATH=(unset)',
    );
    expect(
      browserMissingMessage({ executablePath: '/x/chrome', exists: false, browsersPath: '/opt/pw' }),
    ).toContain('PLAYWRIGHT_BROWSERS_PATH=/opt/pw');
  });

  it('a resolve failure (browser type not installed at all) reports clearly, not opaquely', () => {
    const msg = browserMissingMessage({
      executablePath: null,
      exists: false,
      resolveError: "Executable doesn't exist",
    });
    expect(msg).toContain('not installed');
    expect(msg).toContain("Executable doesn't exist");
  });

  it('every failure message says how to fix it', () => {
    for (const msg of [
      browserMissingMessage({ executablePath: '/x/chrome', exists: false }),
      browserMissingMessage({ executablePath: null, exists: false, resolveError: 'nope' }),
    ]) {
      expect(msg).toContain('playwright install chromium');
    }
  });
});

describe('assertBrowserAvailable', () => {
  it('agrees with the actual filesystem, whichever machine this runs on', () => {
    // NOT "passes here" — that assumed a browser, and CI has none, so the first
    // version of this test failed the release job. Asserting agreement instead
    // is both more honest and stronger: on a dev machine it proves the guard
    // does not cry wolf, and on CI it exercises the throw against a genuinely
    // absent browser rather than a mocked one.
    const path = chromium.executablePath();
    if (existsSync(path)) {
      expect(() => assertBrowserAvailable()).not.toThrow();
    } else {
      expect(() => assertBrowserAvailable()).toThrow(/not on disk/);
      expect(() => assertBrowserAvailable()).toThrow(path.split('/').slice(-3, -2)[0]!);
    }
  });
});
