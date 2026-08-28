/**
 * Tier 1 — the consent-gated collector (F078.3).
 *
 * Everything here READS THE USER'S DEVICE, which is exactly what ePrivacy
 * art. 5(3) (DK: cookiebekendtgørelsen) requires consent for. EDPB Guidelines
 * 2/2023 read "gain access to information stored in terminal equipment" broadly:
 * reading device characteristics from JavaScript counts, cookie or not.
 *
 * THE PROPERTY THIS FILE IS BUILT AROUND — and the reason the gate is the first
 * statement in the function rather than a filter on the result:
 *
 *   "we read the device and then discarded it because there was no consent"
 *   "we never read the device"
 *
 * produce IDENTICAL OUTPUT. Only the first is unlawful, and no assertion on the
 * return value can tell them apart. The prohibition is on the ACCESS, not on the
 * retention. So the gate must make the read IMPOSSIBLE, not merely unused — and
 * that is provable only by spying on the accessors and asserting zero touches.
 */
import { bucketWidth, type MajorVersion, type ScreenBucket } from "./index";

/**
 * The only thing this package needs from a consent system.
 *
 * STRUCTURAL on purpose (the F008.8 lesson, already applied to the adapters):
 * `@broberg/consent-cookie`'s `ConsentManager` satisfies this as-is, and so does
 * a consumer's own consent store, a feature flag, or `{ has: () => true }` in a
 * test. Importing the concrete type would force every consumer to install our
 * consent package to use our statistics package.
 */
export interface ConsentLike {
  has(category: string): boolean;
}

/** How the app is being displayed right now — the browser's own answer. */
export type DisplayMode =
  | "standalone"
  | "minimal-ui"
  | "fullscreen"
  | "window-controls-overlay"
  | "browser"
  | "unknown";

/** Pixel density, bucketed. Raw `devicePixelRatio` is high-entropy; this is not. */
export type DprBucket = "1x" | "2x" | "3x" | ">3x" | "unknown";

export interface DeviceDetail {
  /** Confirms the Tier-0 launch signal from the browser's own side. */
  displayMode: DisplayMode;
  /** The window the app actually gets. Bucketed. */
  viewportBucket?: ScreenBucket;
  /** The physical screen. Bucketed. */
  screenBucket?: ScreenBucket;
  dprBucket: DprBucket;
  /**
   * The REAL OS version — the thing Tier 0 cannot know, and the whole reason
   * this tier is worth a consent prompt.
   */
  os: { family: string; majorVersion: MajorVersion };
  /** Present only when `permissions: true` was asked for. */
  permissions?: PermissionFacts;
}

import {
  readPermissionFacts,
  type PermissionFacts,
  type PermissionsGlobalLike,
} from "./permissions.js";

export interface CollectOptions {
  /** Anything with `has(category)`. A `ConsentManager` fits without adaptation. */
  consent: ConsentLike;
  /** Which consent category gates this. Default `"analytics"`. */
  category?: string;
  /**
   * Also read WHAT IS ALREADY SWITCHED ON — push, location, camera, microphone,
   * and whether the device offers Face ID / Touch ID.
   *
   * OPT-IN, and off by default. Nothing here prompts, but a permission you do
   * not use is entropy you collected for nothing.
   */
  permissions?: boolean;
}

/** Default gate. Device statistics are analytics, not "strictly necessary". */
const DEFAULT_CATEGORY = "analytics";

// ---------------------------------------------------------------------------
// environment — read lazily, never at import time
// ---------------------------------------------------------------------------

interface WindowLike {
  matchMedia?: (q: string) => { matches: boolean };
  innerWidth?: number;
  screen?: { width?: number };
  devicePixelRatio?: number;
  navigator?: NavigatorLike;
}

interface NavigatorLike {
  userAgentData?: {
    platform?: string;
    getHighEntropyValues?: (hints: string[]) => Promise<Record<string, unknown>>;
  };
}

/**
 * Resolving `globalThis.window` is not itself a device read — it asks the
 * runtime whether there is a document, not the terminal what it is. Doing it
 * here (rather than at module scope) is what keeps `import` SSR-safe: a Next.js
 * server component may import this file and nothing happens.
 */
function getWindow(): WindowLike | undefined {
  const w = (globalThis as { window?: unknown }).window;
  return w && typeof w === "object" ? (w as WindowLike) : undefined;
}

/**
 * Every single read goes through here. A missing API (older Safari has no
 * `userAgentData`) or a throwing getter degrades that ONE fact to `undefined`
 * and never takes the rest of the collection down with it.
 */
function attempt<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// buckets — the same "not a setting" rule as the core
// ---------------------------------------------------------------------------

function bucketDpr(dpr: unknown): DprBucket {
  if (typeof dpr !== "number" || !Number.isFinite(dpr) || dpr <= 0) return "unknown";
  if (dpr <= 1) return "1x";
  if (dpr <= 2) return "2x";
  if (dpr <= 3) return "3x";
  return ">3x";
}

const DISPLAY_MODES = [
  "standalone",
  "minimal-ui",
  "fullscreen",
  "window-controls-overlay",
] as const;

function readDisplayMode(win: WindowLike): DisplayMode {
  const mm = attempt(() => win.matchMedia);
  if (typeof mm !== "function") return "unknown";
  for (const mode of DISPLAY_MODES) {
    const matches = attempt(() => mm.call(win, `(display-mode: ${mode})`)?.matches);
    if (matches === true) return mode;
  }
  // Every query answered, none matched: it is a browser tab. Distinct from
  // "unknown", which means we could not ask at all.
  return "browser";
}

// ---------------------------------------------------------------------------
// the real OS version — the one fact Tier 0 must refuse to guess
// ---------------------------------------------------------------------------

/**
 * Windows is the exception that proves the module's rule. Chromium reports a
 * `platformVersion` that is NOT the Windows version: 13.0.0 and up means
 * Windows 11, 1.0.0–12.x means Windows 10, and 0.x means Windows 7/8/8.1 —
 * which cannot be told apart at all.
 *
 * Passing that number through would report "Windows 13", a version that does
 * not exist, and it would be believed because it looks like a number. Same
 * rule as `Android 10; K` in the core: a wrong version gets used, an unknown
 * one gets investigated.
 */
function windowsMajor(platformVersion: string): MajorVersion {
  const major = Number(platformVersion.split(".")[0]);
  if (!Number.isFinite(major)) return "unknown";
  if (major >= 13) return 11;
  if (major >= 1) return 10;
  return "unknown"; // 0.x — Windows 7 / 8 / 8.1, indistinguishable
}

function majorOf(platform: string, platformVersion: unknown): MajorVersion {
  if (typeof platformVersion !== "string" || platformVersion.trim() === "") return "unknown";
  if (platform === "Windows") return windowsMajor(platformVersion);
  const major = Number(platformVersion.split(".")[0]);
  return Number.isFinite(major) ? major : "unknown";
}

async function readOs(win: WindowLike): Promise<{ family: string; majorVersion: MajorVersion }> {
  const uad = attempt(() => win.navigator?.userAgentData);
  if (!uad) return { family: "unknown", majorVersion: "unknown" };

  const family = attempt(() => uad.platform) || "unknown";
  const getHigh = attempt(() => uad.getHighEntropyValues);
  if (typeof getHigh !== "function") return { family, majorVersion: "unknown" };

  // Only `platformVersion` is requested. The other high-entropy hints
  // (`model`, `fullVersionList`, `architecture`, `bitness`) are exactly the
  // fingerprinting surface this package refuses to build, so they are not
  // asked for — not asked-for-and-dropped.
  let values: Record<string, unknown> | undefined;
  try {
    values = await getHigh.call(uad, ["platformVersion"]);
  } catch {
    return { family, majorVersion: "unknown" };
  }

  return { family, majorVersion: majorOf(family, values?.platformVersion) };
}

// ---------------------------------------------------------------------------
// the one entry point
// ---------------------------------------------------------------------------

/**
 * Collect the Tier-1 facts — but ONLY with consent.
 *
 * Returns `null` when consent is absent, when consent is granted for another
 * category, or when there is no browser (SSR). In every one of those cases NOT
 * A SINGLE device accessor is touched: the gate returns before any read exists
 * to be made. That is the guarantee, and it is enforced by a test that spies on
 * `matchMedia`, `screen`, `devicePixelRatio` and `navigator.userAgentData` and
 * requires zero touches — and non-zero touches once consent IS granted, so the
 * test cannot pass on a collector that simply never works.
 *
 * ```ts
 * const detail = await collectDeviceDetail({ consent: manager });
 * if (detail) sink.record(detail);   // null = no consent, and nothing was read
 * ```
 */
export async function collectDeviceDetail(opts: CollectOptions): Promise<DeviceDetail | null> {
  const category = opts.category ?? DEFAULT_CATEGORY;

  // THE GATE. First statement in the function, before anything device-shaped
  // is even in scope. Moving a single read above this line would be the whole
  // legal problem, invisible in the return value.
  if (!opts.consent?.has(category)) return null;

  const win = getWindow();
  if (!win) return null;

  const viewportBucket = attempt(() => bucketWidth(win.innerWidth as number));
  const screenBucket = attempt(() => bucketWidth(win.screen?.width as number));

  const detail: DeviceDetail = {
    displayMode: readDisplayMode(win),
    dprBucket: bucketDpr(attempt(() => win.devicePixelRatio)),
    os: await readOs(win),
  };

  // Only present when actually readable — an absent bucket is honest, a
  // defaulted one is a fact we made up.
  if (viewportBucket) detail.viewportBucket = viewportBucket;
  if (screenBucket) detail.screenBucket = screenBucket;

  // AFTER the gate, like every other read here. Asked for explicitly, never by
  // default — and every one of these is a passive status read.
  if (opts.permissions) {
    // Read from the SAME window the rest of this function uses, not from
    // globalThis — one environment, one source, and it keeps the gate test
    // honest (a second source could be read while the first was blocked).
    detail.permissions = await readPermissionFacts(win as PermissionsGlobalLike);
  }

  return detail;
}
