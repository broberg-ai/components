// @vitest-environment node
import { describe, it, expect } from "vitest";
import { initTheme, getTheme, setTheme, toggleTheme, onThemeChange } from "../src/index";

describe("SSR safety (node env — no document/localStorage)", () => {
  it("does not throw when DOM/localStorage are absent", () => {
    expect(typeof document).toBe("undefined");
    expect(() => initTheme({ defaultTheme: "dark" })).not.toThrow();
    expect(() => setTheme("light")).not.toThrow();
    expect(() => toggleTheme()).not.toThrow();
    const off = onThemeChange(() => {});
    expect(() => off()).not.toThrow();
    expect(typeof getTheme()).toBe("string");
  });
});
