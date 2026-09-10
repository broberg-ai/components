import { describe, expect, it, vi } from 'vitest';

/**
 * F046.4 — closeBrowser() must not be able to hang a consumer's teardown.
 *
 * FILED BY cardmem with a number, not a suspicion: a teardown awaiting
 * closeBrowser() hung the full 30 007 ms after they raised bun's timeout from
 * 5 s to 30 s expecting a slow shutdown.
 *
 * IT DOES NOT REPRODUCE ON THIS MACHINE. Measured through the package's own API
 * on the same model of Mac, driving a real page and then closing:
 *
 *     node   closeBrowser RESOLVED after 24 ms   isConnected false
 *     bun    closeBrowser RESOLVED after 33 ms   isConnected false
 *
 * So bun-vs-node is not the difference, and a test that waits for a REAL
 * Chromium to wedge would be green here for the wrong reason — the same shape
 * as their CI, which skips every browser test because there is no Chromium on
 * disk and therefore never sees the hang at all.
 *
 * The close is therefore INJECTED. A `close()` that never settles is the exact
 * condition under test, it is reproducible on any machine, and it does not
 * depend on ever finding out what wedges their page. Whose page wedges is a
 * detail; a shared engine must not be able to take a caller's teardown hostage.
 */

/** A browser whose close() never settles — the condition, made reproducible. */
let closeCalls = 0;
let launchCalls = 0;
let resolveClose: (() => void) | undefined;

vi.mock('playwright', () => ({
  chromium: {
    executablePath: () => '/fake/chromium',
    launch: async () => {
      launchCalls++;
      return {
        isConnected: () => true,
        close: () => {
          closeCalls++;
          return new Promise<void>((resolve) => {
            resolveClose = resolve;
          });
        },
      };
    },
  },
}));

// The presence guard reads the real filesystem; the path above does not exist.
vi.mock('node:fs', async (orig) => {
  const real = await orig<typeof import('node:fs')>();
  return { ...real, existsSync: (p: string) => (p === '/fake/chromium' ? true : real.existsSync(p)) };
});

describe('a close that never settles', () => {
  it('resolves FALSE at the bound instead of hanging the caller', async () => {
    const { getBrowser, closeBrowser } = await import('../src/capture');
    await getBrowser();

    const started = Date.now();
    const closed = await closeBrowser({ timeoutMs: 150 });
    const elapsed = Date.now() - started;

    expect(closed).toBe(false);
    expect(elapsed).toBeLessThan(2000); // it returned; it did not hang
    expect(closeCalls).toBe(1); // and it genuinely tried
  });

  it('says so, rather than returning a bare false nobody can act on', async () => {
    const { getBrowser, closeBrowser } = await import('../src/capture');
    await getBrowser();
    const warnings: string[] = [];
    await closeBrowser({ timeoutMs: 100, onWarn: (m) => warnings.push(m) });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('may still be running');
    expect(warnings[0]).toContain('100 ms');
  });

  it('a SECOND call does not report success while the first is still stuck', async () => {
    // THE DEFECT THIS GUARDS, and the one a bound alone would have made worse:
    // the old version set `_browser` to null BEFORE awaiting, so a second call
    // hit `if (!p) return` and answered instantly, having closed nothing.
    const { getBrowser, closeBrowser } = await import('../src/capture');
    await getBrowser();
    const first = await closeBrowser({ timeoutMs: 100 });
    const second = await closeBrowser({ timeoutMs: 100 });

    expect(first).toBe(false);
    expect(second).toBe(false); // NOT true — nothing has been closed
  });

  it('and getBrowser() does not launch a SECOND Chromium beside the wedged one', async () => {
    // The consequence of the same bug, and the expensive half: a consumer who
    // bounds the close themselves (as cardmem had to) then accumulates browsers,
    // with every later close answering quickly and wrongly.
    const { getBrowser, closeBrowser } = await import('../src/capture');
    await getBrowser();
    const before = launchCalls;
    await closeBrowser({ timeoutMs: 100 });
    await getBrowser();

    expect(launchCalls).toBe(before); // the wedged browser is still THE browser
  });
});

describe('the paths that must stay unchanged', () => {
  it('a close that DOES complete resolves true and clears the handle', async () => {
    const { getBrowser, closeBrowser } = await import('../src/capture');
    await getBrowser();
    const before = launchCalls;

    const p = closeBrowser({ timeoutMs: 5000 });
    // let the mocked close() be called, then let it finish
    await new Promise((r) => setTimeout(r, 10));
    resolveClose?.();
    expect(await p).toBe(true);

    // handle cleared → the next getBrowser() launches a fresh one
    await getBrowser();
    expect(launchCalls).toBe(before + 1);
  });

  it('nothing to close is TRUE, not a failure', async () => {
    const { closeBrowser } = await import('../src/capture');
    // …the previous test cleared it and then launched one; close that cleanly.
    const p = closeBrowser({ timeoutMs: 5000 });
    await new Promise((r) => setTimeout(r, 10));
    resolveClose?.();
    await p;

    expect(await closeBrowser()).toBe(true); // now there is genuinely nothing
  });

  it('await closeBrowser() still compiles and resolves for existing call-sites', async () => {
    const { closeBrowser } = await import('../src/capture');
    const result: boolean = await closeBrowser();
    expect(typeof result).toBe('boolean');
  });
});
