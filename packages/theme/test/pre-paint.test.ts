// @vitest-environment jsdom
/**
 * F084.24 — the pre-paint snippet and `initTheme()` must never disagree.
 *
 * They run one after the other on every page load: the snippet in `<head>`
 * before the first paint, the module when the bundle arrives. If they resolve
 * different themes the page visibly changes colour after load — and if only the
 * snippet runs (the bug this came from) the module answers with an unwritten
 * module-level constant while the page shows something else.
 *
 * So "one source" is not proven by the snippet living in this package. It is
 * proven by running BOTH over the same state and requiring the same answer.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { initTheme, prePaintScript, getPreference, THEME_KEYS } from "../src/index.js";
import type { ThemePreference } from "../src/index.js";

/** A matchMedia the test can pin, so "what the OS wants" is an input, not luck. */
function stubMatchMedia(light: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("light") ? light : !light,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
    onchange: null,
  })) as unknown as typeof window.matchMedia;
}

/** Run the snippet exactly as a browser would: as source text, not as a closure. */
function runSnippet(script: string): string | null {
  document.documentElement.removeAttribute("data-theme");
  new Function(script)();
  return document.documentElement.getAttribute("data-theme");
}

function runModule(options: { defaultPreference?: ThemePreference; storageKey?: string }): string | null {
  document.documentElement.removeAttribute("data-theme");
  initTheme(options);
  return document.documentElement.getAttribute("data-theme");
}

/** Every state a page can load in. `null` means nothing stored. */
const STORED: (string | null)[] = [
  null,
  "system",
  ...THEME_KEYS,
  "", // stored but empty
  "not-a-theme", // a value from a future or a corrupted write
  "System", // right word, wrong case — must NOT count
];

describe("F084.24 — prePaintScript agrees with initTheme, state by state", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  for (const osIsLight of [true, false]) {
    for (const defaultPreference of ["system", "dark", "light"] as ThemePreference[]) {
      for (const stored of STORED) {
        it(`os=${osIsLight ? "light" : "dark"} default=${defaultPreference} stored=${String(stored)}`, () => {
          stubMatchMedia(osIsLight);

          localStorage.clear();
          if (stored !== null) localStorage.setItem("broberg-theme", stored);
          const fromSnippet = runSnippet(prePaintScript({ defaultPreference }));

          localStorage.clear();
          if (stored !== null) localStorage.setItem("broberg-theme", stored);
          const fromModule = runModule({ defaultPreference });

          // Strict equality, and both printed on failure — "contains" would pass
          // on "dark" vs "dark-cool", which are different palettes.
          expect(fromSnippet, `snippet=${fromSnippet} module=${fromModule}`).toBe(fromModule);
          expect(fromSnippet).not.toBeNull();
        });
      }
    }
  }

  it("a custom storageKey reaches both halves", () => {
    stubMatchMedia(true);
    localStorage.setItem("andet-tema", "dark");

    const fromSnippet = runSnippet(prePaintScript({ storageKey: "andet-tema" }));
    const fromModule = runModule({ storageKey: "andet-tema" });

    expect(fromSnippet).toBe("dark");
    expect(fromModule).toBe("dark");
  });

  it("the snippet reads the SAME key initTheme writes — not a key that merely looks alike", () => {
    stubMatchMedia(true);
    // Nothing under the default key; a lookalike must not be picked up.
    localStorage.setItem("broberg-theme-x", "light");
    expect(runSnippet(prePaintScript({ defaultPreference: "dark" }))).toBe("dark");
  });

  it("survives a localStorage that throws (private window) instead of killing the page", () => {
    stubMatchMedia(true);
    const real = Object.getOwnPropertyDescriptor(window, "localStorage")!;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });
    try {
      document.documentElement.removeAttribute("data-theme");
      expect(() => new Function(prePaintScript())()).not.toThrow();
      // Attribute unset is the honest outcome: the CSS default applies.
      expect(document.documentElement.getAttribute("data-theme")).toBeNull();
    } finally {
      Object.defineProperty(window, "localStorage", real);
    }
  });

  /**
   * ASSERT WHAT MUST BE TRUE, not what must be absent.
   *
   * The first version of this test searched the generated source for
   * `";alert(1)` and FAILED against correct output — the escaped form
   * `\";alert(1)` contains that substring, so the check could not tell an
   * escaped quote from an unescaped one. A text-absence check is the wrong
   * instrument for "did this escape correctly"; running it is the right one.
   */
  it("a poisoned storageKey cannot break out of the string — measured by RUNNING it", () => {
    stubMatchMedia(true);
    const poison = '";(globalThis).__pwned=true;var x="';
    delete (globalThis as Record<string, unknown>).__pwned;

    localStorage.clear();
    localStorage.setItem(poison, "light"); // the key, taken literally
    const theme = runSnippet(prePaintScript({ storageKey: poison, defaultPreference: "dark" }));

    // It ran, it did not execute the payload, and it read the literal key.
    expect((globalThis as Record<string, unknown>).__pwned).toBeUndefined();
    expect(theme).toBe("light");
  });
});

/**
 * NAMED EXPLICITLY, because omitting it does NOT mean "the default" (see the
 * last test in this file). Found the hard way: these two tests failed against
 * correct code because an earlier test in the file had set a custom key and the
 * module kept it.
 */
const KEY = "broberg-theme";

describe("F084.24 — the defect this came from, as a test", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("after the snippet AND initTheme, getPreference() is the user's choice — not the module default", () => {
    stubMatchMedia(true); // OS says light
    // Nothing stored: the page is light, and the user's preference is "system".
    new Function(prePaintScript({ defaultPreference: "system", storageKey: KEY }))();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    initTheme({ defaultPreference: "system", storageKey: KEY });

    // The bug: getPreference() answered "dark" from an unwritten constant, so a
    // menu showed «Mørkt» ticked on this light page.
    expect(getPreference()).toBe("system");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("a stored light choice survives both halves — the case the old menu got wrong", () => {
    stubMatchMedia(false); // OS says dark, but the user chose light
    localStorage.setItem("broberg-theme", "light");

    new Function(prePaintScript({ defaultPreference: "system", storageKey: KEY }))();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    initTheme({ defaultPreference: "system", storageKey: KEY });
    expect(getPreference()).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});

describe("measured while writing the above — initTheme's storageKey is STICKY", () => {
  /**
   * `initTheme` only assigns `storageKey` when the option is PRESENT, so a
   * later call that omits it keeps whatever the previous call set — it does
   * NOT fall back to the default. Recorded rather than changed: this card owns
   * the pre-paint snippet, not initTheme's option handling, and silently
   * resetting the key would change behaviour for every consumer that inits
   * twice.
   *
   * It matters to a reader because the failure is silent: the module reads a
   * different key than the one you believe you are on, and answers confidently.
   */
  it("a later init without storageKey keeps the earlier custom key", () => {
    stubMatchMedia(true);
    localStorage.clear();
    localStorage.setItem("custom-key", "dark");
    localStorage.setItem("broberg-theme", "light");

    initTheme({ storageKey: "custom-key" });
    expect(getPreference()).toBe("dark");

    // No storageKey this time. A reader expects the default key, and "light".
    initTheme({});
    expect(getPreference()).toBe("dark"); // still the custom key

    // And naming it explicitly is what gets you back.
    initTheme({ storageKey: "broberg-theme" });
    expect(getPreference()).toBe("light");
  });
});
