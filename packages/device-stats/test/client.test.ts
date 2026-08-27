/**
 * F078.3 — the consent gate, proven adversarially.
 *
 * The central test in this file is NOT "does it return null without consent".
 * Returning null is trivially satisfied by a collector that reads the whole
 * device and then throws the result away — which is precisely the unlawful
 * version, and is INDISTINGUISHABLE from the lawful one by return value alone.
 *
 * So every accessor the collector could touch is a counting getter, and the
 * assertion is on the COUNTS: zero without consent, non-zero with it. The second
 * half is what stops the test passing on a collector that never works at all.
 */
import { describe, expect, it, afterEach, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { collectDeviceDetail } from "../src/client";
import { deriveDevice } from "../src/index";
// The REAL consent implementation, from source rather than from dist — dist is
// gitignored, so importing the build would make this suite depend on build
// order and fail on a fresh clone.
import {
  createConsentManager,
  createMemoryConsentStorage,
} from "../../consent-cookie/src/index";

// ---------------------------------------------------------------------------
// a window whose every device fact is a counting getter
// ---------------------------------------------------------------------------

interface SpyOptions {
  innerWidth?: number;
  screenWidth?: number;
  dpr?: number;
  displayMode?: string | null;
  userAgentData?: unknown;
}

function makeSpyWindow(opts: SpyOptions = {}) {
  const counts = { matchMedia: 0, innerWidth: 0, screen: 0, dpr: 0, userAgentData: 0 };

  const navigator = {
    get userAgentData() {
      counts.userAgentData++;
      return opts.userAgentData;
    },
  };

  const matchMedia = (query: string) => ({
    matches: opts.displayMode != null && query === `(display-mode: ${opts.displayMode})`,
  });

  const win = {
    get matchMedia() {
      counts.matchMedia++;
      return matchMedia;
    },
    get innerWidth() {
      counts.innerWidth++;
      return opts.innerWidth;
    },
    get screen() {
      counts.screen++;
      return { width: opts.screenWidth };
    },
    get devicePixelRatio() {
      counts.dpr++;
      return opts.dpr;
    },
    navigator,
  };

  const total = () => Object.values(counts).reduce((a, b) => a + b, 0);
  return { win, counts, total };
}

function install(win: unknown) {
  (globalThis as { window?: unknown }).window = win;
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  vi.resetModules();
});

const GRANTED = { has: () => true };
const DENIED = { has: () => false };

const UAD = (platform: string, platformVersion: string) => ({
  platform,
  getHighEntropyValues: async () => ({ platformVersion }),
});

const FULL: SpyOptions = {
  innerWidth: 390,
  screenWidth: 390,
  dpr: 3,
  displayMode: "standalone",
  userAgentData: UAD("Android", "14.0.0"),
};

// ---------------------------------------------------------------------------
// AC 0 — the gate makes the read impossible, not merely unused
// ---------------------------------------------------------------------------

describe("the consent gate is adversarially proven", () => {
  it("touches ZERO device accessors when consent is absent", async () => {
    const spy = makeSpyWindow(FULL);
    install(spy.win);

    const result = await collectDeviceDetail({ consent: DENIED });

    expect(result).toBeNull();
    // The whole point of the story. A collector that read everything and then
    // returned null would pass the line above and fail this one.
    expect(spy.counts).toEqual({
      matchMedia: 0,
      innerWidth: 0,
      screen: 0,
      dpr: 0,
      userAgentData: 0,
    });
    expect(spy.total()).toBe(0);
  });

  it("touches the accessors when consent IS granted (so the zero above means something)", async () => {
    const spy = makeSpyWindow(FULL);
    install(spy.win);

    const result = await collectDeviceDetail({ consent: GRANTED });

    expect(result).not.toBeNull();
    expect(spy.counts.matchMedia).toBeGreaterThan(0);
    expect(spy.counts.innerWidth).toBeGreaterThan(0);
    expect(spy.counts.screen).toBeGreaterThan(0);
    expect(spy.counts.dpr).toBeGreaterThan(0);
    expect(spy.counts.userAgentData).toBeGreaterThan(0);
  });

  it("touches zero accessors when consent is granted for a DIFFERENT category", async () => {
    const spy = makeSpyWindow(FULL);
    install(spy.win);

    const onlyMarketing = { has: (c: string) => c === "marketing" };
    expect(await collectDeviceDetail({ consent: onlyMarketing })).toBeNull();
    expect(spy.total()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC 1 — what Tier 1 actually buys
// ---------------------------------------------------------------------------

describe("with consent it returns bucketed detail", () => {
  it("returns display mode, buckets and the REAL OS major version", async () => {
    install(makeSpyWindow(FULL).win);

    const detail = await collectDeviceDetail({ consent: GRANTED });

    expect(detail).toEqual({
      displayMode: "standalone",
      viewportBucket: "361-768",
      screenBucket: "361-768",
      dprBucket: "3x",
      os: { family: "Android", majorVersion: 14 },
    });
  });

  it("resolves a version on exactly the UA where Tier 0 must answer 'unknown'", async () => {
    // Chrome's UA Reduction pins this string on EVERY Android device.
    const reduced =
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

    const tier0 = deriveDevice({ headers: { "user-agent": reduced } });
    expect(tier0.os).toEqual({ family: "Android", majorVersion: "unknown" });

    install(makeSpyWindow({ ...FULL, userAgentData: UAD("Android", "14.0.0") }).win);
    const tier1 = await collectDeviceDetail({ consent: GRANTED });

    // Side by side: this is the honest trade the README promises — the real
    // version costs a consent prompt.
    expect(tier1?.os.majorVersion).toBe(14);
  });

  it("reports 'browser' when every display-mode query answers no", async () => {
    install(makeSpyWindow({ ...FULL, displayMode: null }).win);
    const detail = await collectDeviceDetail({ consent: GRANTED });
    expect(detail?.displayMode).toBe("browser");
  });

  it("reports 'unknown' display mode when matchMedia does not exist at all", async () => {
    // "We asked and it said no" and "we could not ask" are different facts.
    const win = { ...makeSpyWindow(FULL).win, matchMedia: undefined };
    install(win);
    const detail = await collectDeviceDetail({ consent: GRANTED });
    expect(detail?.displayMode).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// AC 2 + 3 — the consent object is structural, and the category is configurable
// ---------------------------------------------------------------------------

describe("consent is consumed structurally", () => {
  function realManager() {
    return createConsentManager({
      policyVersion: "2026-08-27",
      storage: createMemoryConsentStorage(),
    });
  }

  it("a hand-made { has } and a REAL createConsentManager give identical results", async () => {
    install(makeSpyWindow(FULL).win);
    const handMade = await collectDeviceDetail({ consent: { has: () => true } });

    const manager = realManager();
    manager.acceptAll();
    install(makeSpyWindow(FULL).win);
    const real = await collectDeviceDetail({ consent: manager });

    expect(real).toEqual(handMade);
    expect(real).not.toBeNull();
  });

  it("defaults to the 'analytics' category: essential-only yields null", async () => {
    const manager = realManager();
    manager.rejectAll(); // essential stays on, analytics does not
    expect(manager.has("essential")).toBe(true);
    expect(manager.has("analytics")).toBe(false);

    const spy = makeSpyWindow(FULL);
    install(spy.win);
    expect(await collectDeviceDetail({ consent: manager })).toBeNull();
    expect(spy.total()).toBe(0);
  });

  it("granting 'analytics' on a real manager yields detail", async () => {
    const manager = realManager();
    manager.setConsent({ analytics: true });
    install(makeSpyWindow(FULL).win);
    expect(await collectDeviceDetail({ consent: manager })).not.toBeNull();
  });

  it("honours a custom category", async () => {
    const manager = realManager();
    manager.setConsent({ analytics: false, marketing: true });
    install(makeSpyWindow(FULL).win);

    expect(await collectDeviceDetail({ consent: manager })).toBeNull();
    expect(
      await collectDeviceDetail({ consent: manager, category: "marketing" }),
    ).not.toBeNull();
  });

  it("imports no concrete type from @broberg/consent-cookie", () => {
    const files = readdirSync(new URL("../src/", import.meta.url));
    const hits = files
      .filter((f) => f.endsWith(".ts"))
      .filter((f) =>
        /from\s+['"]@broberg\/consent-cookie/.test(
          readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8"),
        ),
      );
    // A consumer with their own consent system must not be forced to install ours.
    expect(hits).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC 4 — SSR
// ---------------------------------------------------------------------------

describe("SSR-safe", () => {
  it("imports and runs with no window/screen/navigator, returning null", async () => {
    delete (globalThis as { window?: unknown }).window;
    vi.resetModules();

    // A fresh import with no browser globals present must not throw — proof
    // that nothing device-shaped is touched at module scope.
    const fresh = await import("../src/client");
    await expect(fresh.collectDeviceDetail({ consent: GRANTED })).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC 5 — degrade, never throw
// ---------------------------------------------------------------------------

describe("every read degrades independently", () => {
  it("with no userAgentData (older Safari) it still returns what it could read", async () => {
    install(makeSpyWindow({ ...FULL, userAgentData: undefined }).win);

    const detail = await collectDeviceDetail({ consent: GRANTED });

    expect(detail).not.toBeNull();
    expect(detail?.os).toEqual({ family: "unknown", majorVersion: "unknown" });
    // The facts it COULD read survive — a missing API costs one fact, not all.
    expect(detail?.displayMode).toBe("standalone");
    expect(detail?.viewportBucket).toBe("361-768");
    expect(detail?.dprBucket).toBe("3x");
  });

  it("keeps the platform family when getHighEntropyValues rejects", async () => {
    install(
      makeSpyWindow({
        ...FULL,
        userAgentData: {
          platform: "iOS",
          getHighEntropyValues: async () => {
            throw new Error("NotAllowedError");
          },
        },
      }).win,
    );

    const detail = await collectDeviceDetail({ consent: GRANTED });
    expect(detail?.os).toEqual({ family: "iOS", majorVersion: "unknown" });
  });

  it("survives a throwing getter", async () => {
    install({
      get matchMedia(): unknown {
        throw new Error("blocked by privacy extension");
      },
      get innerWidth(): number {
        throw new Error("blocked");
      },
      get screen(): unknown {
        throw new Error("blocked");
      },
      get devicePixelRatio(): number {
        throw new Error("blocked");
      },
      navigator: {},
    });

    const detail = await collectDeviceDetail({ consent: GRANTED });
    expect(detail).toEqual({
      displayMode: "unknown",
      dprBucket: "unknown",
      os: { family: "unknown", majorVersion: "unknown" },
    });
  });

  it("maps Windows platformVersion to the OS version, not to the raw number", async () => {
    // Chromium's Windows platformVersion is NOT the Windows version.
    const cases: Array<[string, number | "unknown"]> = [
      ["15.0.0", 11], // 13+ means Windows 11
      ["13.0.0", 11],
      ["10.0.0", 10], // 1..12 means Windows 10
      ["1.0.0", 10],
      ["0.3.0", "unknown"], // Windows 7/8/8.1 — indistinguishable
    ];

    for (const [platformVersion, expected] of cases) {
      install(makeSpyWindow({ ...FULL, userAgentData: UAD("Windows", platformVersion) }).win);
      const detail = await collectDeviceDetail({ consent: GRANTED });
      expect(detail?.os).toEqual({ family: "Windows", majorVersion: expected });
    }
  });
});

// ---------------------------------------------------------------------------
// AC 6 — anti-fingerprint holds in Tier 1 too
// ---------------------------------------------------------------------------

describe("anti-fingerprinting is enforced, not documented", () => {
  it("never lets a raw pixel value reach the result", async () => {
    install(
      makeSpyWindow({ ...FULL, innerWidth: 1237, screenWidth: 1493, dpr: 2.625 }).win,
    );

    const detail = await collectDeviceDetail({ consent: GRANTED });
    const json = JSON.stringify(detail);

    expect(json).not.toContain("1237");
    expect(json).not.toContain("1493");
    expect(json).not.toContain("2.625");
    expect(detail?.viewportBucket).toBe("1025-1440");
    expect(detail?.screenBucket).toBe(">1440");
    expect(detail?.dprBucket).toBe("3x");
  });

  it("carries no identifier or hash key", async () => {
    install(makeSpyWindow(FULL).win);
    const detail = await collectDeviceDetail({ consent: GRANTED });

    expect(Object.keys(detail ?? {}).sort()).toEqual([
      "displayMode",
      "dprBucket",
      "os",
      "screenBucket",
      "viewportBucket",
    ]);
  });

  it("exports exactly one runtime symbol — there is no widening escape hatch", async () => {
    const mod = await import("../src/client");
    // No `collectRaw`, no options object that returns full versions, no helper
    // that hands back an id. Buckets as a SETTING would mean the guarantee
    // lasts until the first consumer who wants a bit more detail.
    expect(Object.keys(mod).sort()).toEqual(["collectDeviceDetail"]);
  });
});
