// @broberg/lens-engine — shared page-session helper for the READ primitives
// (read / extract / network). Same context lifecycle as capture(): one warm
// Chromium, an isolated context per call, navigate + settle, then close.
//
// AUTH MODEL (contract-faithful): a URL target opens an anonymous context; to read
// behind a login, pass a live (already-authed) Page — the CALLER owns its lifecycle
// (we never navigate or close a Page we were handed). This keeps the locked reader
// signatures minimal (no storageState field) while still supporting authed reads.

import type { BrowserContext, Page } from 'playwright';
import { getBrowser, armIdleTimer, resolveViewport, settle } from './capture';

const DEFAULT_TIMEOUT_MS = 30_000;

export interface PageSessionOptions {
  /** Explicit viewport (wins over device). */
  viewport?: { width: number; height: number };
  /** A device preset name (see capture's DEVICE_PRESETS). */
  device?: string;
  /** Navigation + settle timeout in ms (default 30s). */
  timeoutMs?: number;
}

/**
 * Drive `work` against a Page for `target`.
 *  - `target` is a URL string → open an isolated anonymous context, run `beforeNav`
 *    (e.g. attach a `response` listener) BEFORE navigating, navigate + settle, run
 *    `work`, then always close the context.
 *  - `target` is a live Page → the caller owns the lifecycle + auth; we only run
 *    `beforeNav` + `work` (never navigate, never close).
 */
export async function withPageSession<T>(
  target: string | Page,
  opts: PageSessionOptions,
  beforeNav: ((page: Page) => void | Promise<void>) | undefined,
  work: (page: Page) => Promise<T>,
): Promise<T> {
  if (typeof target !== 'string') {
    if (beforeNav) await beforeNav(target);
    return work(target);
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  armIdleTimer();
  const browser = await getBrowser();
  let context: BrowserContext | null = null;
  try {
    context = await browser.newContext({
      viewport: resolveViewport(opts),
      deviceScaleFactor: 1,
      ignoreHTTPSErrors: true,
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    if (beforeNav) await beforeNav(page);
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await settle(page, undefined, timeoutMs);
    return await work(page);
  } finally {
    if (context) await context.close().catch(() => {});
  }
}
