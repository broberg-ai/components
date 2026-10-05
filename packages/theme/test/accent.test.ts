// @vitest-environment jsdom
/**
 * F001.20 — the brand accent. appkit #1669: cool and warm share classic's
 * --accent, so two customers on two palettes got the same orange buttons.
 * Every assertion reads the value BACK from <html> and compares strictly.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { wcagContrast } from "culori";
import { accentTokens, setAccent, setPalette, prePaintScript } from "../src/index.js";

const root = () => document.documentElement;
const read = (v: string) => root().style.getPropertyValue(v);

beforeEach(() => {
  root().removeAttribute("style");
  root().removeAttribute("data-palette");
});

describe("accentTokens", () => {
  it("the foreground on the accent reaches 4.5:1 for a light, a mid and a dark brand", () => {
    for (const hex of ["#F5D547", "#2E7D32", "#1A237E", "#808080", "#E8A87C"]) {
      const t = accentTokens(hex)!;
      const ratio = wcagContrast(t.accent, t.accentFg);
      if (ratio < 4.5) throw new Error(`${hex}: ${t.accentFg} on ${t.accent} = ${ratio.toFixed(2)}`);
    }
  });
  it("picks dark ink on a light brand and white on a dark one", () => {
    expect(accentTokens("#F5D547")!.accentFg).toBe("#161B22");
    expect(accentTokens("#1A237E")!.accentFg).toBe("#FFFFFF");
  });
  it("normalises #rgb and case, and derives the soft tint from the same colour", () => {
    expect(accentTokens("#abc")).toEqual({ accent: "#AABBCC", accentFg: "#161B22", accentSoft: "rgba(170, 187, 204, 0.14)" });
  });
  it("rejects anything that is not a hex colour", () => {
    for (const bad of ["red", "#12", "#12345g", "", "rgb(0,0,0)", "#1234567", "#fff;}body{", "#1234", "#11223380"]) {
      expect(accentTokens(bad)).toBeNull();
    }
  });
});

describe("setAccent", () => {
  it("writes all three variables on <html>, and null removes them", () => {
    expect(setAccent("#2E7D32")).toBe(true);
    expect([read("--accent"), read("--accent-fg"), read("--accent-soft")]).toEqual(["#2E7D32", "#FFFFFF", "rgba(46, 125, 50, 0.14)"]);
    expect(setAccent(null)).toBe(true);
    expect([read("--accent"), read("--accent-fg"), read("--accent-soft")]).toEqual(["", "", ""]);
  });
  it("an invalid hex writes nothing and does not throw", () => {
    setAccent("#1A237E");
    expect(setAccent("not-a-colour")).toBe(false);
    expect(read("--accent")).toBe("#1A237E");
  });
  it("survives a palette switch", () => {
    setAccent("#1A237E");
    setPalette("warm");
    setPalette("cool");
    expect(root().getAttribute("data-palette")).toBe("cool");
    expect(read("--accent")).toBe("#1A237E");
  });
});

describe("prePaintScript({ accent })", () => {
  it("applies the same three variables before first paint", () => {
    new Function(prePaintScript({ accent: "#F5D547" }))();
    const t = accentTokens("#F5D547")!;
    expect([read("--accent"), read("--accent-fg"), read("--accent-soft")]).toEqual([t.accent, t.accentFg, t.accentSoft]);
  });
  it("emits nothing for an invalid accent, and no caller text reaches the script", () => {
    const evil = '#fff");alert(1);("';
    expect(prePaintScript({ accent: evil })).toBe(prePaintScript({}));
    new Function(prePaintScript({ accent: evil }))();
    expect(read("--accent")).toBe("");
  });
});
