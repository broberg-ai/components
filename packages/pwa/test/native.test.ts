// F021.12 — native icon sets. Read back the BYTES each platform cares about:
// a PNG of the right size that still has an alpha channel is rejected by the
// App Store, and a foreground that fills the 108dp canvas is cropped by every
// Android launcher mask — both look fine until a store or a phone says no.
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { nativeIconSet, NATIVE_BACKGROUND_REQUIRED, ANDROID_DENSITIES, ICO_SIZES, ICNS_CHUNKS } from "../src/raster";
import { main } from "../src/cli";

// A WHITE symbol, exactly the shape that rendered as an empty icon for buzzalert.
const SYMBOL = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect x="0" y="0" width="10" height="10" fill="#ffffff"/></svg>`;
const BG = "#1a73e8";

const u32be = (b: Uint8Array, o: number) => new DataView(b.buffer, b.byteOffset).getUint32(o);
const pngSize = (png: Uint8Array) => [u32be(png, 16), u32be(png, 20)];
const pngColourType = (png: Uint8Array) => png[25];

function decode(png: Uint8Array, size: number) {
  const b64 = Buffer.from(png).toString("base64");
  const r = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><image width="${size}" height="${size}" href="data:image/png;base64,${b64}"/></svg>`, { font: { loadSystemFonts: false } }).render();
  return (x: number, y: number) => {
    const i = (y * r.width + x) * 4;
    return [...r.pixels.subarray(i, i + 4)];
  };
}

const byPath = async (opts = { background: BG }) => new Map((await nativeIconSet(SYMBOL, opts)).map((f) => [f.path, f.content]));

describe("iOS — App Store rejects an icon with alpha", () => {
  it("AppIcon-1024.png is 1024×1024 RGB (colour type 2), the background in the corner, the symbol in the middle", async () => {
    const files = await byPath();
    const png = files.get("ios/AppIcon.appiconset/AppIcon-1024.png")!;
    expect(pngSize(png)).toEqual([1024, 1024]);
    expect(pngColourType(png)).toBe(2);
    const at = decode(png, 1024);
    expect(at(2, 2)).toEqual([0x1a, 0x73, 0xe8, 255]);
    expect(at(512, 512)).toEqual([255, 255, 255, 255]);
  });

  it("Contents.json names that file as the single universal 1024 icon", async () => {
    const json = JSON.parse(new TextDecoder().decode((await byPath()).get("ios/AppIcon.appiconset/Contents.json")!));
    expect(json.images).toEqual([{ filename: "AppIcon-1024.png", idiom: "universal", platform: "ios", size: "1024x1024" }]);
  });
});

describe("Android adaptive", () => {
  it("both adaptive XMLs point at the background colour and the foreground mipmap", async () => {
    const files = await byPath();
    for (const p of ["android/mipmap-anydpi-v26/ic_launcher.xml", "android/mipmap-anydpi-v26/ic_launcher_round.xml"]) {
      const xml = new TextDecoder().decode(files.get(p)!);
      expect(xml).toContain('<background android:drawable="@color/ic_launcher_background"/>');
      expect(xml).toContain('<foreground android:drawable="@mipmap/ic_launcher_foreground"/>');
    }
    expect(new TextDecoder().decode(files.get("android/values/ic_launcher_background.xml")!)).toContain(
      `<color name="ic_launcher_background">${BG}</color>`,
    );
  });

  it("foreground in all five densities; the edge OUTSIDE the safe zone is transparent, the centre is the symbol", async () => {
    const files = await byPath();
    for (const d of ANDROID_DENSITIES) {
      const png = files.get(`android/mipmap-${d.dpi}/ic_launcher_foreground.png`)!;
      expect(pngSize(png)).toEqual([d.foreground, d.foreground]);
      const at = decode(png, d.foreground);
      // 108dp canvas, 66dp safe zone → 21dp margin. 10dp in from the edge is outside it.
      const m = Math.floor((d.foreground * 10) / 108);
      expect(at(m, m)[3]).toBe(0);
      expect(at(d.foreground / 2, d.foreground / 2)).toEqual([255, 255, 255, 255]);
    }
  });

  it("legacy ic_launcher + ic_launcher_round in 48/72/96/144/192", async () => {
    const files = await byPath();
    for (const d of ANDROID_DENSITIES) {
      for (const name of ["ic_launcher", "ic_launcher_round"]) {
        expect(pngSize(files.get(`android/mipmap-${d.dpi}/${name}.png`)!)).toEqual([d.legacy, d.legacy]);
      }
    }
    // The round one is a circle: its corner is transparent; the square one's is the background.
    expect(decode(files.get("android/mipmap-xxxhdpi/ic_launcher_round.png")!, 192)(1, 1)[3]).toBe(0);
    expect(decode(files.get("android/mipmap-xxxhdpi/ic_launcher.png")!, 192)(1, 1)).toEqual([0x1a, 0x73, 0xe8, 255]);
  });
});

describe("desktop containers, read back", () => {
  it(".ico: reserved 0, type 1, four PNG entries 16/32/48/256 at the offsets the directory claims", async () => {
    const ico = (await byPath()).get("desktop/icon.ico")!;
    const v = new DataView(ico.buffer, ico.byteOffset);
    expect([v.getUint16(0, true), v.getUint16(2, true), v.getUint16(4, true)]).toEqual([0, 1, ICO_SIZES.length]);
    const sizes = ICO_SIZES.map((_, i) => {
      const e = 6 + i * 16;
      const len = v.getUint32(e + 8, true);
      const off = v.getUint32(e + 12, true);
      const png = ico.subarray(off, off + len);
      expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
      return [ico[e] === 0 ? 256 : ico[e], pngSize(png)[0]];
    });
    expect(sizes).toEqual(ICO_SIZES.map((s) => [s, s]));
  });

  it(".icns: 'icns' magic, total length equals the file length, every chunk a PNG of its declared size", async () => {
    const icns = (await byPath()).get("desktop/icon.icns")!;
    expect(new TextDecoder().decode(icns.subarray(0, 4))).toBe("icns");
    expect(u32be(icns, 4)).toBe(icns.length);
    const seen: Array<[string, number]> = [];
    for (let off = 8; off < icns.length; ) {
      const type = new TextDecoder().decode(icns.subarray(off, off + 4));
      const len = u32be(icns, off + 4);
      seen.push([type, pngSize(icns.subarray(off + 8, off + len))[0]!]);
      off += len;
    }
    expect(seen).toEqual(ICNS_CHUNKS.map(([t, s]) => [t, s]));
  });
});

describe("background is required", () => {
  it("nativeIconSet without (or with a malformed) background refuses, naming why", async () => {
    await expect(nativeIconSet(SYMBOL, {} as never)).rejects.toThrow(NATIVE_BACKGROUND_REQUIRED);
    await expect(nativeIconSet(SYMBOL, { background: "blue" })).rejects.toThrow(NATIVE_BACKGROUND_REQUIRED);
  });

  it("pwa-icons --native without --background exits 1 and writes nothing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pwa-native-"));
    const svg = join(dir, "icon.svg");
    writeFileSync(svg, SYMBOL);
    expect(await main(["--svg", svg, "--native", join(dir, "out")])).toBe(1);
    expect(existsSync(join(dir, "out"))).toBe(false);
  });

  it("pwa-icons --native writes the whole set under ios/, android/ and desktop/", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pwa-native-"));
    const svg = join(dir, "icon.svg");
    writeFileSync(svg, SYMBOL);
    const out = join(dir, "out");
    expect(await main(["--svg", svg, "--native", out, "--background", BG])).toBe(0);
    for (const p of [
      "ios/AppIcon.appiconset/AppIcon-1024.png",
      "android/mipmap-anydpi-v26/ic_launcher.xml",
      "android/mipmap-xxxhdpi/ic_launcher_foreground.png",
      "desktop/icon.ico",
      "desktop/icon.icns",
    ]) {
      expect(existsSync(join(out, p))).toBe(true);
    }
    expect(pngColourType(new Uint8Array(readFileSync(join(out, "ios/AppIcon.appiconset/AppIcon-1024.png"))))).toBe(2);
  });
});
