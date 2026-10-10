// F021.9 — PNG icons. iOS does not use an SVG apple-touch-icon, so «Add to Home
// Screen» showed a screenshot instead of the logo. Each test reads the actual
// pixels: a PNG that is the right size but blank would otherwise pass.
import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { buildIconSet } from "../src/manifest";
import { rasterizeIconSet } from "../src/raster";
import { main } from "../src/cli";

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#E8A87C"/></svg>`;

/** Decode a PNG back to pixels by rendering it through resvg as an <image>. */
function pixels(png: Uint8Array, size: number) {
  const b64 = Buffer.from(png).toString("base64");
  const r = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><image width="${size}" height="${size}" href="data:image/png;base64,${b64}"/></svg>`, { font: { loadSystemFonts: false } }).render();
  const at = (x: number, y: number) => { const i = (y * r.width + x) * 4; return [...r.pixels.subarray(i, i + 4)]; };
  return { width: r.width, height: r.height, at, raw: r.pixels };
}

describe("rasterizeIconSet", () => {
  it("svg source: PNG 180/192/512 + maskable-512, right size, the logo's colour in the middle", async () => {
    const out = await rasterizeIconSet(buildIconSet({ svg: LOGO, background: "#141969" }));
    expect(out.files.map((f) => [f.path, f.size, f.purpose, f.type])).toEqual([
      ["/icons/icon-180.png", 180, "any", "image/png"],
      ["/icons/icon-192.png", 192, "any", "image/png"],
      ["/icons/icon-512.png", 512, "any", "image/png"],
      ["/icons/icon-maskable-512.png", 512, "maskable", "image/png"],
    ]);
    for (const f of out.files) {
      expect([...f.content.subarray(0, 8)]).toEqual(PNG_SIG);
      const p = pixels(f.content, f.size);
      expect([p.width, p.height]).toEqual([f.size, f.size]);
      const c = Math.floor(f.size / 2);
      expect(p.at(c, c)).toEqual([0xe8, 0xa8, 0x7c, 255]); // the logo, not the background
      expect(p.at(1, 1)).toEqual([0x14, 0x19, 0x69, 255]); // the background in the corner
    }
    expect(out.appleTouchIcon).toBe("/icons/icon-180.png");
    expect(out.icons).toEqual([
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ]);
  });

  it("monogram: the letters are drawn (pixels in the text colour exist), not just the background", async () => {
    const out = await rasterizeIconSet(buildIconSet({ monogram: "AK", background: "#141969", color: "#ffffff" }));
    const p = pixels(out.files[0]!.content, 180);
    let white = 0;
    for (let i = 0; i < p.raw.length; i += 4) if (p.raw[i]! > 200 && p.raw[i + 1]! > 200 && p.raw[i + 2]! > 200) white++;
    expect(white).toBeGreaterThan(500);
  });
});

describe("pwa-icons CLI", () => {
  it("writes SVG + PNG and prints the PNG icons[] and the apple-touch href", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pwa-icons-"));
    const svgFile = join(dir, "logo.svg");
    writeFileSync(svgFile, LOGO);
    const out = join(dir, "out");
    const logs: string[] = [];
    const orig = console.log;
    console.log = (s: string) => logs.push(s);
    try {
      expect(await main(["--svg", svgFile, "--background", "#141969", "--out", out])).toBe(0);
    } finally {
      console.log = orig;
    }
    expect(readdirSync(out).sort()).toEqual([
      "icon-180.png", "icon-180.svg", "icon-192.png", "icon-192.svg", "icon-512.png", "icon-512.svg",
      "icon-maskable-512.png", "icon-maskable-512.svg",
    ]);
    expect([...readFileSync(join(out, "icon-180.png")).subarray(0, 8)]).toEqual(PNG_SIG);
    const printed = JSON.parse(logs.join("\n"));
    expect(printed.appleTouchIcon).toBe("/icons/icon-180.png");
    expect(printed.icons.every((i: { type: string }) => i.type === "image/png")).toBe(true);
  });

  it("no source → exit 1 with a named error", async () => {
    const errs: string[] = [];
    const orig = console.error;
    console.error = (s: string) => errs.push(s);
    try {
      expect(await main(["--out", "x"])).toBe(1);
    } finally {
      console.error = orig;
    }
    expect(errs.join("\n")).toMatch(/give --svg <file> or --monogram <text>/);
  });
});

describe("without @resvg/resvg-js", () => {
  it("rasterizeIconSet rejects with the install instruction, and the CLI exits 1 saying so", async () => {
    vi.resetModules();
    vi.doMock("@resvg/resvg-js", () => { throw new Error("Cannot find module '@resvg/resvg-js'"); });
    const { rasterizeIconSet: r, RESVG_MISSING } = await import("../src/raster");
    const { main: m } = await import("../src/cli");
    await expect(r(buildIconSet({ monogram: "A" }))).rejects.toThrow(RESVG_MISSING);
    const errs: string[] = [];
    const orig = console.error;
    console.error = (s: string) => errs.push(s);
    try {
      expect(await m(["--monogram", "A", "--out", mkdtempSync(join(tmpdir(), "pwa-icons-"))])).toBe(1);
    } finally {
      console.error = orig;
      vi.doUnmock("@resvg/resvg-js");
    }
    expect(errs.join("\n")).toContain("npm i -D @resvg/resvg-js");
  });
});

describe("the core stays dependency-free", () => {
  it("package.json: no runtime dependencies; resvg is an OPTIONAL peer", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(pkg.dependencies ?? {}).toEqual({});
    expect(pkg.peerDependenciesMeta["@resvg/resvg-js"]).toEqual({ optional: true });
  });
});
