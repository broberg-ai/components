// @vitest-environment jsdom
/**
 * F001.16 — `system` is not a palette, it is a WAY OF CHOOSING one.
 *
 * Before this, `followSystem` was in force only until the first click: a stored
 * value won forever, there was no way to SAY "system", and nothing listened, so
 * an OS that flipped while the app was open changed nothing.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  initTheme,
  setTheme,
  getTheme,
  setPreference,
  getPreference,
  onThemeChange,
} from "../src/index.js";

/** A matchMedia we can actually flip, with listeners that really fire. */
function stubMatchMedia(startsLight: boolean) {
  let light = startsLight;
  const listeners = new Set<() => void>();
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    get matches() {
      return query.includes("light") ? light : !light;
    },
    media: query,
    addEventListener: (_: string, fn: () => void) => void listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => void listeners.delete(fn),
    addListener: (fn: () => void) => void listeners.add(fn),
    removeListener: (fn: () => void) => void listeners.delete(fn),
    dispatchEvent: () => true,
    onchange: null,
  })) as unknown as typeof window.matchMedia;
  return {
    flip(toLight: boolean) {
      light = toLight;
      for (const fn of [...listeners]) fn();
    },
    listenerCount: () => listeners.size,
  };
}

const KEY = "broberg-theme";
const html = () => document.documentElement.getAttribute("data-theme");

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("setPreference('system') follows the OS, and KEEPS following it", () => {
  it("applies the OS palette and reports 'system' — not the value it resolved to", () => {
    const os = stubMatchMedia(true);
    initTheme();
    setPreference("system");

    expect(getPreference()).toBe("system"); // the CHOICE
    expect(getTheme()).toBe("light");       // the RESOLVED key
    expect(html()).toBe("light");

    // Asserted separately, because returning the resolved value is exactly what
    // makes a setting look like it did not stick.
    os.flip(false);
    expect(getPreference()).toBe("system");
    expect(getTheme()).toBe("dark");
    expect(html()).toBe("dark");
  });

  it("notifies subscribers when the OS flips", () => {
    const os = stubMatchMedia(true);
    initTheme();
    setPreference("system");
    const seen: string[] = [];
    onThemeChange((t) => seen.push(t));
    os.flip(false);
    expect(seen).toEqual(["dark"]);
  });

  /**
   * THE DEAFNESS TEST. A listener attached only while the preference IS 'system'
   * passes every other test in this file and fails this one: it was torn down on
   * the way out to 'light' and never rebuilt.
   */
  it("still follows after system -> light -> system", () => {
    const os = stubMatchMedia(true);
    initTheme();
    setPreference("system");
    setPreference("light");
    setPreference("system");

    os.flip(false);
    expect(getTheme()).toBe("dark");
    expect(html()).toBe("dark");
  });

  it("an OS flip does NOTHING while the preference is an explicit theme", () => {
    const os = stubMatchMedia(true);
    initTheme();
    setPreference("dark");
    os.flip(true); // OS says light; the user said dark
    expect(getTheme()).toBe("dark");
    expect(getPreference()).toBe("dark");
  });

  it("attaches ONE listener however many times the preference changes", () => {
    const os = stubMatchMedia(true);
    initTheme();
    for (let i = 0; i < 5; i++) {
      setPreference("system");
      setPreference("dark");
    }
    expect(os.listenerCount()).toBe(1);
  });
});

describe("every palette survives — not just light and dark", () => {
  it("light-warm round-trips through setPreference and lands on <html>", () => {
    stubMatchMedia(true);
    initTheme();
    setPreference("light-warm");
    expect(getPreference()).toBe("light-warm");
    expect(getTheme()).toBe("light-warm");
    expect(html()).toBe("light-warm");
    expect(localStorage.getItem(KEY)).toBe("light-warm");
  });

  it("rejects a non-preference rather than applying it", () => {
    stubMatchMedia(true);
    initTheme();
    setPreference("dark");
    setPreference("neon" as never);
    expect(getPreference()).toBe("dark");
  });
});

describe("backward compatibility, both directions", () => {
  it("an OLD stored ThemeKey is a valid preference — nothing to migrate", () => {
    stubMatchMedia(true);
    localStorage.setItem(KEY, "dark-cool"); // written by 0.6.0
    initTheme();
    expect(getPreference()).toBe("dark-cool");
    expect(getTheme()).toBe("dark-cool");
  });

  /**
   * The direction nobody checks. Two versions WILL coexist during a rollout, so
   * assert that a NEW stored value read by the OLD parser degrades rather than
   * throwing. This is 0.6.0's isThemeKey, verbatim.
   */
  it("a stored 'system' SURVIVES a reload — the round-trip, not just the write", () => {
    // The mutation harness found this hole: swapping isPreference for the old
    // isThemeKey in readStored() killed NOTHING, because every test asserted the
    // write and none asserted the read. A preference that persists but cannot be
    // read back is indistinguishable from one that was never stored.
    const os = stubMatchMedia(true);
    initTheme();
    setPreference("system");
    expect(localStorage.getItem(KEY)).toBe("system");

    initTheme(); // a reload
    expect(getPreference()).toBe("system");
    expect(getTheme()).toBe("light");
    os.flip(false);
    expect(getTheme()).toBe("dark"); // and it is still following
  });

  it("a stored 'system' read by the OLD parser yields null, so an old copy falls back", () => {
    const OLD_KEYS = ["light", "dark", "light-cool", "light-warm", "dark-cool", "dark-warm"];
    const oldIsThemeKey = (v: unknown) => typeof v === "string" && OLD_KEYS.includes(v);

    stubMatchMedia(true);
    initTheme();
    setPreference("system");
    const raw = localStorage.getItem(KEY);

    expect(raw).toBe("system");
    expect(oldIsThemeKey(raw)).toBe(false); // -> old readStored() returns null
  });

  // SPLIT IN TWO on purpose. As one test its two claims produced the same red set
  // as the deafness mutation, so the harness could not tell "setTheme forgot to
  // sync the preference" from "the listener is conditional". Two failures that
  // cannot be told apart are one failure.
  it("setTheme still applies the theme, and now RECORDS it as the preference", () => {
    stubMatchMedia(true);
    initTheme();
    setPreference("system");
    setTheme("dark-warm");
    expect(getTheme()).toBe("dark-warm");
    expect(getPreference()).toBe("dark-warm");
  });

  it("after setTheme the OS no longer speaks for a user who chose by hand", () => {
    const os = stubMatchMedia(true);
    initTheme();
    setPreference("system");
    setTheme("dark-warm");
    os.flip(true);
    expect(getTheme()).toBe("dark-warm");
  });
});

describe("no matchMedia at all", () => {
  it("setPreference('system') does not throw and still applies a usable theme", () => {
    // @ts-expect-error deliberately removing it
    delete window.matchMedia;
    expect(() => initTheme()).not.toThrow();
    expect(() => setPreference("system")).not.toThrow();
    expect(getTheme()).toBe("dark");
    expect(html()).toBe("dark");
  });
});
