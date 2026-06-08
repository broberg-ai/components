import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  initTheme,
  getTheme,
  setTheme,
  toggleTheme,
  onThemeChange,
  THEME_KEYS,
} from "../src/index";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  // reset internal state to the default
  setTheme("dark");
});

describe("@broberg/theme core", () => {
  it("initTheme applies the default and sets data-theme on <html>", () => {
    localStorage.clear();
    const t = initTheme({ defaultTheme: "dark" });
    expect(t).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("setTheme persists to localStorage and applies the attribute", () => {
    setTheme("light-cool");
    expect(localStorage.getItem("broberg-theme")).toBe("light-cool");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light-cool");
    expect(getTheme()).toBe("light-cool");
  });

  it("initTheme prefers a stored value over the default", () => {
    localStorage.setItem("broberg-theme", "dark-warm");
    const t = initTheme({ defaultTheme: "light" });
    expect(t).toBe("dark-warm");
  });

  it("onThemeChange fires on change and unsubscribe stops it", () => {
    const seen: string[] = [];
    const off = onThemeChange((t) => seen.push(t));
    setTheme("light");
    setTheme("dark");
    off();
    setTheme("light-warm");
    expect(seen).toEqual(["light", "dark"]);
  });

  it("toggleTheme cycles light<->dark and collapses variants to a base mode", () => {
    setTheme("light");
    expect(toggleTheme()).toBe("dark");
    expect(toggleTheme()).toBe("light");
    setTheme("dark-cool");
    expect(toggleTheme()).toBe("light");
  });

  it("setTheme ignores invalid keys", () => {
    setTheme("light");
    // @ts-expect-error invalid theme key
    setTheme("purple");
    expect(getTheme()).toBe("light");
  });

  it("followSystem uses prefers-color-scheme when nothing is stored", () => {
    localStorage.clear();
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({
      matches: q.includes("light"),
      media: q,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    const t = initTheme({ followSystem: true });
    expect(t).toBe("light");
  });

  it("exposes all six theme keys", () => {
    expect(THEME_KEYS).toHaveLength(6);
    expect([...THEME_KEYS]).toContain("dark-warm");
  });
});
