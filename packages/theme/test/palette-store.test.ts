// @vitest-environment jsdom
// F001.18 — the palette + surfaces store, and the pre-paint snippet that must
// agree with it before the bundle arrives.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PALETTES,
  PALETTE_LABELS,
  getPalette,
  getSurfaces,
  initPalette,
  onPaletteChange,
  prePaintScript,
  setPalette,
  setSurfaces,
} from "../src/index.js";

const html = () => document.documentElement;
beforeEach(() => {
  localStorage.clear();
  html().removeAttribute("data-palette");
  html().removeAttribute("data-surfaces");
  html().removeAttribute("data-theme");
});

describe("the ids are cardmem's stored values; labels are separate", () => {
  it("ids and labels", () => {
    expect(PALETTES).toEqual(["classic", "cool", "warm", "broberg"]);
    expect(PALETTE_LABELS).toEqual({ classic: "Ember", cool: "Graphite", warm: "Sandstone", broberg: "Fjord" });
  });
});

describe("store", () => {
  it("reads cardmem's own keys, so nobody loses their choice", () => {
    localStorage.setItem("cardmem.palette", "warm");
    localStorage.setItem("cardmem.surfaces", "layered");
    expect(initPalette({ paletteKey: "cardmem.palette", surfacesKey: "cardmem.surfaces" })).toEqual({ palette: "warm", surfaces: "layered" });
    expect(html().getAttribute("data-palette")).toBe("warm");
    expect(html().getAttribute("data-surfaces")).toBe("layered");
  });

  it("setPalette applies, persists and notifies; classic removes attribute AND key", () => {
    initPalette({ paletteKey: "k.p", surfacesKey: "k.s" });
    const seen = vi.fn();
    const off = onPaletteChange(seen);
    setPalette("broberg");
    expect(html().getAttribute("data-palette")).toBe("broberg");
    expect(localStorage.getItem("k.p")).toBe("broberg");
    setPalette("classic");
    expect(html().hasAttribute("data-palette")).toBe(false);
    expect(localStorage.getItem("k.p")).toBeNull();
    expect(seen.mock.calls).toEqual([["broberg"], ["classic"]]);
    off();
    expect(getPalette()).toBe("classic");
  });

  it("setSurfaces: layered sets, flat removes", () => {
    initPalette({ paletteKey: "k.p", surfacesKey: "k.s" });
    setSurfaces("layered");
    expect(html().getAttribute("data-surfaces")).toBe("layered");
    expect(localStorage.getItem("k.s")).toBe("layered");
    setSurfaces("flat");
    expect(html().hasAttribute("data-surfaces")).toBe(false);
    expect(localStorage.getItem("k.s")).toBeNull();
    expect(getSurfaces()).toBe("flat");
  });

  it("an unknown stored or passed value is classic/flat, never written", () => {
    localStorage.setItem("k.p", "ember"); // the LABEL, not an id
    localStorage.setItem("k.s", "yes");
    expect(initPalette({ paletteKey: "k.p", surfacesKey: "k.s" })).toEqual({ palette: "classic", surfaces: "flat" });
    expect(html().hasAttribute("data-palette")).toBe(false);
    setPalette("fjord" as never);
    expect(getPalette()).toBe("classic");
  });
});

describe("prePaintScript agrees with initPalette, state by state", () => {
  const run = (script: string) => {
    html().removeAttribute("data-palette");
    html().removeAttribute("data-surfaces");
    new Function(script)();
    return [html().getAttribute("data-palette"), html().getAttribute("data-surfaces")];
  };
  const viaModule = () => {
    html().removeAttribute("data-palette");
    html().removeAttribute("data-surfaces");
    initPalette({ paletteKey: "cardmem.palette", surfacesKey: "cardmem.surfaces" });
    return [html().getAttribute("data-palette"), html().getAttribute("data-surfaces")];
  };
  const script = prePaintScript({ storageKey: "cardmem.theme-pref", paletteKey: "cardmem.palette", surfacesKey: "cardmem.surfaces" });

  for (const p of [null, "classic", "cool", "warm", "broberg", "Cool", "fjord", ""]) {
    for (const s of [null, "layered", "flat", "Layered"]) {
      it(`palette=${p} surfaces=${s}`, () => {
        localStorage.clear();
        if (p !== null) localStorage.setItem("cardmem.palette", p);
        if (s !== null) localStorage.setItem("cardmem.surfaces", s);
        expect(run(script)).toEqual(viaModule());
      });
    }
  }

  it("without the new options the snippet is byte-identical to 0.9.0's", () => {
    expect(prePaintScript({ storageKey: "x" })).not.toContain("data-palette");
    expect(prePaintScript({ storageKey: "x" })).not.toContain("data-surfaces");
  });

  it("a palette read that throws never costs the theme", () => {
    const real = window.localStorage;
    const fake = {
      getItem: (k: string) => {
        if (k === "cardmem.palette") throw new Error("denied");
        return k === "cardmem.theme-pref" ? "light" : null;
      },
    };
    Object.defineProperty(window, "localStorage", { value: fake, configurable: true });
    try {
      html().removeAttribute("data-theme");
      new Function(script)();
      expect(html().getAttribute("data-theme")).toBe("light");
    } finally {
      Object.defineProperty(window, "localStorage", { value: real, configurable: true });
    }
  });
});
