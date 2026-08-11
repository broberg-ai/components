import { describe, expect, it, vi } from 'vitest';

/**
 * F065 — THE NEGATIVE CONTROL, in its own file because it mocks `playwright`
 * for the whole module graph.
 *
 * This is the test that has to be able to FAIL. Its siblings in
 * browser-presence.test.ts exercise the pure message builder, which cannot tell
 * you whether `assertBrowserAvailable()` is actually wired to it — remove the
 * call from `getBrowser()` and every one of them stays green.
 *
 * Env cannot produce the red case: Playwright builds its browser registry at
 * import time, so setting PLAYWRIGHT_BROWSERS_PATH after the fact leaves
 * `executablePath()` unchanged (measured). Mocking is the only in-process way.
 */

vi.mock('playwright', () => ({
  chromium: {
    // A path that certainly does not exist, shaped like a real one so the
    // revision segment is visible in the assertion below.
    executablePath: () => '/nonexistent-ms-playwright/chromium-9999/chrome',
    launch: () => {
      throw new Error('launch must never be reached — the guard runs first');
    },
  },
}));

describe('the guard can actually fire', () => {
  it('assertBrowserAvailable THROWS when the executable is absent', async () => {
    const { assertBrowserAvailable } = await import('../src/capture');
    expect(() => assertBrowserAvailable()).toThrow(/not on disk/);
    expect(() => assertBrowserAvailable()).toThrow(/chromium-9999/);
  });

  it('getBrowser() fails on the GUARD, not inside Playwright — proving it is wired', async () => {
    // If the assertBrowserAvailable() call is ever removed from getBrowser(),
    // this reaches the mocked launch() and the message changes. That is the
    // whole point of this file: the pure tests cannot see that regression.
    const { getBrowser } = await import('../src/capture');
    await expect(getBrowser()).rejects.toThrow(/lens-engine: the Chromium build/);
  });
});
