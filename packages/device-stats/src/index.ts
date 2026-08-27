/**
 * @broberg/device-stats — headless core (F078.1).
 *
 * Answers "what are our users actually on?" from what the browser ALREADY SENT
 * plus what the app declares about its OWN launch. Nothing is read from the
 * user's device here, which is what keeps this side of the module outside
 * ePrivacy art. 5(3) consent (see README). Reading the device — real viewport,
 * display-mode, high-entropy hints — is Tier 1 and lives behind a consent gate
 * in a separate entry.
 *
 * Pure: no I/O, no clock, no framework, no storage, no identifier.
 */

/** Coarse screen/viewport buckets. Deliberately NOT configurable — see README. */
export type ScreenBucket = "<=360" | "361-768" | "769-1024" | "1025-1440" | ">1440";

export type FormFactor = "desktop" | "mobile" | "tablet" | "unknown";

/** How the app was opened. `installed` = launched from the home screen / app shell. */
export type Launch = "browser" | "installed" | "unknown";

/**
 * Which evidence produced the answer. A consumer reading a statistic should be
 * able to see how much to trust it: Client-Hints facts are more reliable than
 * User-Agent facts, and `none` means we were told nothing at all.
 */
export type Evidence = "ua" | "client-hints" | "mixed" | "none";

/** A major version, or the honest answer. Never a guess. */
export type MajorVersion = number | "unknown";

export interface DeviceFacts {
  formFactor: FormFactor;
  os: { family: string; majorVersion: MajorVersion };
  browser: { family: string; majorVersion: MajorVersion };
  launch: Launch;
  /** Present only when a width was supplied by the caller. */
  screenBucket?: ScreenBucket;
  source: Evidence;
}

/** Anything header-ish: a `Headers`, a Node/Bun header bag, or a plain object. */
export type HeaderInput =
  | Headers
  | Record<string, string | string[] | undefined>
  | undefined
  | null;

export interface DeriveInput {
  headers?: HeaderInput;
  /**
   * The app's OWN declared launch context — e.g. the `src` query parameter that
   * the web manifest's `start_url` carries (`start_url: "/?src=pwa"`). When the
   * user opens from the home screen the browser navigates there, so the app is
   * declaring how it was launched. Nothing is read from the device.
   */
  launchCtx?: string | null;
  /** Viewport or screen width in CSS pixels, if the caller already has one. */
  screenWidth?: number | null;
}

// ---------------------------------------------------------------------------
// header access
// ---------------------------------------------------------------------------

function readHeader(headers: HeaderInput, name: string): string {
  if (!headers) return "";
  const lower = name.toLowerCase();
  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(lower) ?? "";
  }
  const bag = headers as Record<string, string | string[] | undefined>;
  for (const key of Object.keys(bag)) {
    if (key.toLowerCase() !== lower) continue;
    const value = bag[key];
    return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
  }
  return "";
}

// ---------------------------------------------------------------------------
// version parsing — major only, and never a guess
// ---------------------------------------------------------------------------

function majorFrom(raw: string | undefined): MajorVersion {
  if (!raw) return "unknown";
  const match = /^(\d+)/.exec(raw.trim());
  if (!match) return "unknown";
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : "unknown";
}

/**
 * Chrome's UA Reduction replaces the real Android version and model with a
 * fixed sentinel — `Android 10; K` — on EVERY device, whatever it actually
 * runs. So the string parses cleanly to `10` and that 10 is a fiction.
 *
 * This is the trap the whole module is built around: a wrong version gets
 * USED, an unknown one gets INVESTIGATED. We report `unknown`.
 */
const ANDROID_REDUCED = /Android\s+10;\s*K[;)]/;

// ---------------------------------------------------------------------------
// browser — ORDER IS THE CONTRACT
// ---------------------------------------------------------------------------

/**
 * Most-specific first, because the tokens nest: Edge's UA contains `Chrome`,
 * Samsung Internet's contains both `SamsungBrowser` and `Chrome`, and every
 * Chromium UA ends in `Safari`. Reorder these and a whole browser family is
 * silently re-labelled as another — the statistic still looks plausible.
 */
const BROWSERS: ReadonlyArray<{ family: string; re: RegExp }> = [
  { family: "Edge", re: /Edg(?:e|A|iOS)?\/([\d.]+)/ },
  { family: "Opera", re: /(?:OPR|Opera)\/([\d.]+)/ },
  { family: "Samsung Internet", re: /SamsungBrowser\/([\d.]+)/ },
  { family: "Firefox", re: /(?:Firefox|FxiOS)\/([\d.]+)/ },
  { family: "Chrome", re: /(?:Chrome|CriOS)\/([\d.]+)/ },
  { family: "Safari", re: /Version\/([\d.]+).*Safari/ },
];

function detectBrowser(ua: string): { family: string; majorVersion: MajorVersion } {
  for (const { family, re } of BROWSERS) {
    const m = re.exec(ua);
    if (m) return { family, majorVersion: majorFrom(m[1]) };
  }
  return { family: "unknown", majorVersion: "unknown" };
}

// ---------------------------------------------------------------------------
// os
// ---------------------------------------------------------------------------

function detectOs(ua: string): { family: string; majorVersion: MajorVersion } {
  if (/\b(iPhone|iPad|iPod)\b/.test(ua)) {
    // "CPU iPhone OS 17_5 like Mac OS X" / "CPU OS 12_2 like Mac OS X"
    const m = /(?:iPhone )?OS (\d+)[._]/.exec(ua);
    return { family: "iOS", majorVersion: m ? majorFrom(m[1]) : "unknown" };
  }
  if (/\bAndroid\b/.test(ua)) {
    if (ANDROID_REDUCED.test(ua)) return { family: "Android", majorVersion: "unknown" };
    const m = /Android (\d+)/.exec(ua);
    return { family: "Android", majorVersion: m ? majorFrom(m[1]) : "unknown" };
  }
  if (/Windows NT (\d+)/.test(ua)) {
    const m = /Windows NT ([\d.]+)/.exec(ua);
    // Windows 11 is indistinguishable from 10 in the UA — both send NT 10.0.
    // Reporting "10" would be a guess dressed as a fact.
    return { family: "Windows", majorVersion: m && m[1] === "10.0" ? "unknown" : majorFrom(m?.[1]) };
  }
  if (/\bMac OS X\b|\bMacintosh\b/.test(ua)) {
    // Safari freezes macOS at 10_15_7 for every version since Catalina, so the
    // number is real syntax and a false fact. Same rule as Windows NT 10.0.
    if (/Mac OS X 10[._]15[._]7/.test(ua)) return { family: "macOS", majorVersion: "unknown" };
    const m = /Mac OS X (\d+)[._]/.exec(ua);
    return { family: "macOS", majorVersion: m ? majorFrom(m[1]) : "unknown" };
  }
  if (/\bCrOS\b/.test(ua)) return { family: "ChromeOS", majorVersion: "unknown" };
  if (/\bLinux\b/.test(ua)) return { family: "Linux", majorVersion: "unknown" };
  return { family: "unknown", majorVersion: "unknown" };
}

// ---------------------------------------------------------------------------
// form factor
// ---------------------------------------------------------------------------

function detectFormFactor(ua: string, chMobile: string): FormFactor {
  if (!ua && !chMobile) return "unknown";
  // An iPad sends BOTH "iPad" and "Mobile/15E148", so the tablet check must run
  // before the mobile one or every iPad counts as a phone.
  if (/\biPad\b/.test(ua)) return "tablet";
  if (/\bTablet\b/.test(ua)) return "tablet";
  // An Android TABLET is exactly an Android UA WITHOUT the "Mobile" token —
  // the absence is the signal, which is why this cannot be a positive match.
  if (/\bAndroid\b/.test(ua)) return /\bMobile\b/.test(ua) ? "mobile" : "tablet";
  if (/\b(iPhone|iPod)\b/.test(ua)) return "mobile";
  if (/\bMobile\b/.test(ua)) return "mobile";
  if (chMobile === "?1") return "mobile";
  if (ua) return "desktop";
  return "unknown";
}

// ---------------------------------------------------------------------------
// buckets — baked in, not configurable
// ---------------------------------------------------------------------------

export function bucketWidth(width: number): ScreenBucket | undefined {
  if (!Number.isFinite(width) || width <= 0) return undefined;
  if (width <= 360) return "<=360";
  if (width <= 768) return "361-768";
  if (width <= 1024) return "769-1024";
  if (width <= 1440) return "1025-1440";
  return ">1440";
}

// ---------------------------------------------------------------------------
// launch context
// ---------------------------------------------------------------------------

const INSTALLED_MARKERS = new Set(["pwa", "installed", "standalone", "homescreen", "app"]);

function detectLaunch(launchCtx: string | null | undefined): Launch {
  if (launchCtx == null) return "browser";
  const value = launchCtx.trim().toLowerCase();
  if (value === "") return "browser";
  if (INSTALLED_MARKERS.has(value)) return "installed";
  if (value === "browser" || value === "web") return "browser";
  return "unknown";
}

// ---------------------------------------------------------------------------
// the one entry point
// ---------------------------------------------------------------------------

/**
 * Derive bucketed device facts. Pure — the same input always yields the same
 * output, so it is trivially testable and can run on any runtime.
 *
 * There is deliberately NO option to widen the result: no full version string,
 * no raw pixel width, no identifier, no hash. Buckets as a setting would mean
 * the anti-fingerprint guarantee lasts until the first consumer who wants more.
 */
export function deriveDevice(input: DeriveInput = {}): DeviceFacts {
  const { headers, launchCtx, screenWidth } = input;

  const ua = readHeader(headers, "user-agent");
  const chUa = readHeader(headers, "sec-ch-ua");
  const chMobile = readHeader(headers, "sec-ch-ua-mobile");
  const chPlatform = readHeader(headers, "sec-ch-ua-platform").replace(/"/g, "").trim();

  const os = detectOs(ua);
  const browser = detectBrowser(ua);

  // Client Hints only refine what the UA could not say — they never overwrite a
  // fact the UA stated, so a consumer can reason about `source` meaningfully.
  if (os.family === "unknown" && chPlatform) {
    os.family = chPlatform;
  }

  const hasCh = Boolean(chUa || chMobile || chPlatform);
  const source: Evidence = ua && hasCh ? "mixed" : ua ? "ua" : hasCh ? "client-hints" : "none";

  const facts: DeviceFacts = {
    formFactor: detectFormFactor(ua, chMobile),
    os,
    browser,
    launch: detectLaunch(launchCtx),
    source,
  };

  const bucket = typeof screenWidth === "number" ? bucketWidth(screenWidth) : undefined;
  if (bucket) facts.screenBucket = bucket;

  return facts;
}

// ---------------------------------------------------------------------------
// structural request reader
// ---------------------------------------------------------------------------

/**
 * The only shape this package needs from a request.
 *
 * Deliberately STRUCTURAL rather than a vendor type. `@broberg/auth` F008.8
 * paid for the alternative: Better Auth's `Auth<O>` is invariant, so a narrowed
 * instance did not satisfy a parameter typed as the vendor's own type and every
 * consumer had to cast. Typed like this, one function serves Next middleware,
 * Next route handlers, Hono's `c.req.raw`, `Bun.serve` and a plain `Request` —
 * and cannot break when a vendor renames or re-parameterises its request type.
 */
export interface RequestLike {
  headers: HeaderInput;
  url?: string | null;
}

export interface FromRequestOptions {
  /** Query parameter carrying the app's declared launch context. Default `src`. */
  launchParam?: string;
  screenWidth?: number | null;
}

function launchFromUrl(url: string | null | undefined, param: string): string | null {
  if (!url) return null;
  const q = url.indexOf("?");
  if (q === -1) return null;
  // Parsed off the query string alone, so a relative URL (which `new URL(url)`
  // would reject) works exactly like an absolute one.
  return new URLSearchParams(url.slice(q + 1)).get(param);
}

/**
 * Derive device facts straight from a request, reading the launch marker out of
 * the request's own query string.
 *
 * When the request carries no URL at all, `launch` is `unknown` rather than
 * `browser` — see `deriveDevice`'s contract. Claiming `browser` would make
 * installed-PWA traffic invisible, which is the one answer worth getting right.
 */
export function deviceFromRequest(req: RequestLike, opts: FromRequestOptions = {}): DeviceFacts {
  const param = opts.launchParam ?? "src";
  const hasUrl = typeof req.url === "string" && req.url.length > 0;

  const facts = deriveDevice({
    headers: req.headers,
    launchCtx: hasUrl ? (launchFromUrl(req.url, param) ?? "browser") : undefined,
    screenWidth: opts.screenWidth,
  });

  // "We looked and found no marker" (browser) and "we could not look at all"
  // are DIFFERENT facts, and only the first is evidence of an un-installed
  // visit. Collapsing them would report every URL-less request as `browser`
  // and make installed-PWA traffic invisible — the one answer this module
  // exists to get right.
  if (!hasUrl) facts.launch = "unknown";

  return facts;
}
