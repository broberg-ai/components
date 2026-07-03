// @broberg/lens-engine — capture engine (Playwright).
//
// Launch a warm headless Chromium, one isolated context per capture, navigate +
// settle, screenshot per mode, hash the DOM. Returns PNG BYTES + metadata —
// storage/serve is the consumer's job (the engine never touches R2/disk).
//
// The settle logic (domcontentloaded + fonts.ready + finite-animation wait) makes
// a capture deterministic across environments. AUTH-AGNOSTIC: capture() takes a
// `storageState` (object OR async resolver) and applies it before navigating; it
// never fetches a mint endpoint (that is the consumer's job — see mint.ts).

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { createHash, randomUUID } from 'node:crypto';
import { applyStorageState } from './mint';
import type { CaptureBody, CaptureMode, StorageState } from './schema';

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_VIEWPORT = { width: 1280, height: 800 };

/** A tiny device-preset map — enough for a v1 mobile/desktop split without a
 *  Playwright `devices` import (which would tie us to viewport-only anyway). */
const DEVICE_PRESETS: Record<string, { width: number; height: number }> = {
  'iphone-14': { width: 390, height: 844 },
  'iphone-se': { width: 375, height: 667 },
  'pixel-7': { width: 412, height: 915 },
  'ipad': { width: 820, height: 1180 },
  'desktop': { width: 1280, height: 800 },
  'desktop-wide': { width: 1920, height: 1080 },
};

// One warm browser, launched lazily + reused; idle-closed so a quiet host
// (e.g. Fly auto_stop) doesn't hold Chromium forever.
let _browser: Promise<Browser> | null = null;
let _idleTimer: ReturnType<typeof setTimeout> | null = null;

export async function getBrowser(): Promise<Browser> {
  if (!_browser) {
    _browser = chromium
      .launch({ headless: true, args: ['--disable-dev-shm-usage', '--no-sandbox'] })
      .catch((err) => {
        _browser = null;
        throw err;
      });
  }
  const browser = await _browser;
  if (!browser.isConnected()) {
    _browser = null;
    return getBrowser();
  }
  return browser;
}

export function armIdleTimer(): void {
  if (_idleTimer) clearTimeout(_idleTimer);
  _idleTimer = setTimeout(() => void closeBrowser(), IDLE_TIMEOUT_MS);
  _idleTimer.unref?.();
}

/** Close the warm browser (idle timeout / shutdown). Safe when nothing is open. */
export async function closeBrowser(): Promise<void> {
  if (_idleTimer) {
    clearTimeout(_idleTimer);
    _idleTimer = null;
  }
  const p = _browser;
  _browser = null;
  if (!p) return;
  try {
    const browser = await p;
    if (browser.isConnected()) await browser.close();
  } catch {
    /* already gone */
  }
}

/** Resolve the effective viewport: explicit viewport wins, then a device preset,
 *  then the default. Exported for unit-testing without a browser. */
export function resolveViewport(body: Pick<CaptureBody, 'viewport' | 'device'>): { width: number; height: number } {
  if (body.viewport) return body.viewport;
  if (body.device && DEVICE_PRESETS[body.device]) return DEVICE_PRESETS[body.device]!;
  return DEFAULT_VIEWPORT;
}

/** Normalise a selector: a bare kebab/word token (no CSS metachars) is treated
 *  as a data-testid VALUE and wrapped; anything with a CSS char is used as-is.
 *  Exported for unit-testing. */
export function resolveSelector(selector: string): string {
  const looksLikeCss = /[.#\[\]:>~+*()="' ]/.test(selector);
  return looksLikeCss ? selector : `[data-testid="${selector}"]`;
}

/** A pre-resolved storageState, OR an async resolver the engine awaits (the
 *  consumer's mint-fetch lives behind this — the engine stays auth-agnostic). */
export type StorageStateInput = StorageState | (() => StorageState | Promise<StorageState>);

/** Resolve a StorageStateInput to a concrete storageState (or null). Awaits a
 *  resolver BEFORE the browser context opens so a failure is a clean error. */
export async function resolveStorageState(input: StorageStateInput | undefined): Promise<StorageState | null> {
  if (input == null) return null;
  return typeof input === 'function' ? await input() : input;
}

export interface CaptureOptions extends Omit<CaptureBody, 'storageState'> {
  /** Pre-resolved storageState OR an async resolver (auth-agnostic — the consumer
   *  supplies the state; the engine only applies it). */
  storageState?: StorageStateInput;
}

export interface CaptureResult {
  run_id: string;
  status: 'ok';
  width: number;
  height: number;
  dom_hash: string;
  /** PNG bytes — the caller uploads to storage + builds a URL. */
  png: Buffer;
  finalUrl: string;
  title: string;
}

/** Wait for navigation to settle: fonts + finite animations, capped so an
 *  infinite spinner can't hang the shot. */
export async function settle(page: Page, waitFor: CaptureBody['waitFor'], timeoutMs: number): Promise<void> {
  if (typeof waitFor === 'number') {
    await page.waitForTimeout(waitFor);
  } else if (typeof waitFor === 'string') {
    const trimmed = waitFor.trim();
    if (/^\d+$/.test(trimmed)) await page.waitForTimeout(Number(trimmed));
    else await page.locator(waitFor).first().waitFor({ state: 'visible', timeout: timeoutMs });
  }
  await page
    .evaluate(async () => {
      await document.fonts.ready;
      const anims = (document.getAnimations?.() ?? []).filter((a) => {
        const iters = a.effect?.getComputedTiming?.().iterations;
        return iters !== Infinity;
      });
      await Promise.race([
        Promise.all(anims.map((a) => a.finished.catch(() => {}))),
        new Promise((r) => setTimeout(r, 600)),
      ]);
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    })
    .catch(() => {});
  await page.waitForTimeout(120);
}

export async function takeShot(
  page: Page,
  mode: CaptureMode,
  selector: string | null,
  timeoutMs: number,
): Promise<{ png: Buffer; width: number; height: number }> {
  if (mode === 'element') {
    if (!selector) throw new Error('element mode requires a selector');
    const locator = page.locator(resolveSelector(selector)).first();
    await locator.waitFor({ state: 'visible', timeout: timeoutMs });
    await locator.scrollIntoViewIfNeeded({ timeout: timeoutMs });
    const box = await locator.boundingBox();
    const png = await locator.screenshot();
    return {
      png,
      width: Math.max(1, Math.round(box?.width ?? 0)),
      height: Math.max(1, Math.round(box?.height ?? 0)),
    };
  }
  const png = await page.screenshot({ fullPage: mode === 'fullPage' });
  const size = await page.viewportSize();
  // For fullPage the PNG height exceeds the viewport; report the scroll height.
  const height =
    mode === 'fullPage'
      ? await page.evaluate(() => document.documentElement.scrollHeight).catch(() => size?.height ?? 0)
      : size?.height ?? 0;
  return { png, width: size?.width ?? 0, height };
}

/** Run one capture: navigate (optionally authed via a supplied storageState),
 *  settle, screenshot, hash the DOM. Returns the PNG + metadata; storage is the
 *  caller's job. */
export async function capture(opts: CaptureOptions): Promise<CaptureResult> {
  const mode: CaptureMode = opts.mode ?? 'viewport';
  if (mode === 'element' && !opts.selector) {
    throw new Error('element mode requires a selector (prefer a data-testid)');
  }
  const timeoutMs = DEFAULT_TIMEOUT_MS;
  const viewport = resolveViewport(opts);

  // Resolve storageState (object or async resolver) BEFORE launching the context
  // so a resolver failure surfaces as a clean error, not a half-open context.
  const storageState = await resolveStorageState(opts.storageState);

  armIdleTimer();
  const browser = await getBrowser();
  let context: BrowserContext | null = null;
  try {
    context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
      ignoreHTTPSErrors: true,
      reducedMotion: 'reduce',
    });
    if (storageState) await applyStorageState(context, storageState);
    const page = await context.newPage();
    await page.goto(opts.url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await settle(page, opts.waitFor, timeoutMs);

    const title = await page.title();
    const finalUrl = page.url();
    const domHtml = await page.evaluate(() => document.documentElement.outerHTML).catch(() => '');
    const dom_hash = createHash('sha256').update(domHtml).digest('hex').slice(0, 16);
    const { png, width, height } = await takeShot(page, mode, opts.selector ?? null, timeoutMs);

    return { run_id: randomUUID(), status: 'ok', width, height, dom_hash, png, finalUrl, title };
  } finally {
    if (context) await context.close().catch(() => {});
  }
}
