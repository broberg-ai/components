import { describe, it, expect } from "vitest";
import {
  defineManifest,
  serializeManifest,
  buildIconSet,
  pwaMetaTags,
} from "../src/manifest.js";

describe("defineManifest", () => {
  it("defaults required members from a single name", () => {
    const m = defineManifest({ name: "Aalborg Klinik" });
    expect(m.name).toBe("Aalborg Klinik");
    expect(m.short_name).toBe("Aalborg Klinik");
    expect(m.start_url).toBe("/");
    expect(m.scope).toBe("/");
    expect(m.display).toBe("standalone");
    expect(m.theme_color).toBe("#ffffff");
    expect(m.background_color).toBe("#ffffff");
    expect(m.icons).toEqual([]);
  });

  it("honours overrides + short_name", () => {
    const m = defineManifest({
      name: "Long Product Name",
      shortName: "LPN",
      themeColor: "#141969",
      backgroundColor: "#0e1424",
      display: "fullscreen",
      startUrl: "/app",
    });
    expect(m.short_name).toBe("LPN");
    expect(m.theme_color).toBe("#141969");
    expect(m.display).toBe("fullscreen");
    expect(m.start_url).toBe("/app");
  });

  it("merges `extra` last (shortcuts/screenshots escape hatch)", () => {
    const m = defineManifest({ name: "X", extra: { shortcuts: [{ name: "New" }], display: "minimal-ui" } });
    expect((m.shortcuts as unknown[]).length).toBe(1);
    // extra wins over the modelled default
    expect(m.display).toBe("minimal-ui");
  });

  it("throws without a name", () => {
    // @ts-expect-error intentional
    expect(() => defineManifest({})).toThrow(/name/);
  });

  it("serializeManifest is valid JSON, pretty by default", () => {
    const m = defineManifest({ name: "X" });
    const s = serializeManifest(m);
    expect(s).toContain("\n");
    expect(JSON.parse(s).name).toBe("X");
    const compact = serializeManifest(m, { pretty: false });
    expect(compact).not.toContain("\n");
  });
});

describe("buildIconSet", () => {
  it("emits apple-touch(180)/192/512 + a maskable-512 by default", () => {
    const set = buildIconSet({ monogram: "AK" });
    const sizes = set.files.map((f) => `${f.size}-${f.purpose}`);
    expect(sizes).toContain("180-any");
    expect(sizes).toContain("192-any");
    expect(sizes).toContain("512-any");
    expect(sizes).toContain("512-maskable");
    // 180 is apple-touch (link, not manifest) → NOT in icons[]
    expect(set.icons.find((i) => i.sizes === "180x180")).toBeUndefined();
    expect(set.icons.find((i) => i.sizes === "192x192")).toBeTruthy();
    const maskable = set.icons.find((i) => i.purpose === "maskable");
    expect(maskable?.sizes).toBe("512x512");
  });

  it("renders valid, size-correct SVG for a monogram", () => {
    const set = buildIconSet({ monogram: "ab", color: "#fff", background: "#111827" });
    const icon192 = set.files.find((f) => f.size === 192 && f.purpose === "any")!;
    expect(icon192.content).toContain('width="192" height="192"');
    expect(icon192.content).toContain('fill="#111827"');
    // monogram upper-cased + present
    expect(icon192.content).toContain(">AB<");
    expect(icon192.type).toBe("image/svg+xml");
  });

  it("maskable icon insets the artwork (safe-zone padding)", () => {
    const set = buildIconSet({ monogram: "A" });
    const mask = set.files.find((f) => f.purpose === "maskable")!;
    const any = set.files.find((f) => f.size === 512 && f.purpose === "any")!;
    // the maskable text font-size is smaller than the full-bleed one
    const fontOf = (svg: string) => Number(/font-size="(\d+)"/.exec(svg)?.[1] ?? 0);
    expect(fontOf(mask.content)).toBeLessThan(fontOf(any.content));
  });

  it("embeds a source SVG as a data-URI image", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';
    const set = buildIconSet({ svg });
    const icon = set.files.find((f) => f.size === 512 && f.purpose === "any")!;
    expect(icon.content).toContain("data:image/svg+xml;base64,");
    expect(icon.content).toContain("<image");
  });

  it("respects custom sizes + basePath + maskable:false", () => {
    const set = buildIconSet({ monogram: "Z", sizes: [64, 256], maskable: false, basePath: "/pwa/i/" });
    expect(set.files.map((f) => f.size).sort((a, b) => a - b)).toEqual([64, 256]);
    expect(set.files.every((f) => f.path.startsWith("/pwa/i/"))).toBe(true);
    expect(set.files.find((f) => f.purpose === "maskable")).toBeUndefined();
  });

  it("throws without svg or monogram", () => {
    expect(() => buildIconSet({})).toThrow(/svg.*monogram/);
  });

  it("icons[] from buildIconSet drop straight into defineManifest", () => {
    const { icons } = buildIconSet({ monogram: "AK" });
    const m = defineManifest({ name: "AK", icons });
    expect(m.icons.length).toBe(icons.length);
    expect(m.icons.some((i) => i.purpose === "maskable")).toBe(true);
  });
});

describe("pwaMetaTags", () => {
  it("returns manifest link + theme-color + apple-touch + capable tags by default", () => {
    const tags = pwaMetaTags();
    const manifest = tags.find((t) => t.tag === "link" && t.attrs.rel === "manifest");
    expect(manifest?.attrs.href).toBe("/manifest.webmanifest");
    expect(tags.find((t) => t.attrs.name === "theme-color")?.attrs.content).toBe("#ffffff");
    expect(tags.find((t) => t.attrs.rel === "apple-touch-icon")?.attrs.href).toBe("/icons/icon-180.svg");
    expect(tags.find((t) => t.attrs.name === "apple-mobile-web-app-capable")?.attrs.content).toBe("yes");
    expect(tags.find((t) => t.attrs.name === "mobile-web-app-capable")).toBeTruthy();
  });

  it("suppresses capable tags + adds title when asked", () => {
    const tags = pwaMetaTags({ capable: false, title: "AK", themeColor: "#141969" });
    expect(tags.find((t) => t.attrs.name === "apple-mobile-web-app-capable")).toBeUndefined();
    expect(tags.find((t) => t.attrs.name === "apple-mobile-web-app-title")?.attrs.content).toBe("AK");
    expect(tags.find((t) => t.attrs.name === "theme-color")?.attrs.content).toBe("#141969");
  });
});
