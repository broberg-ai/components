/**
 * @broberg/pwa/raster — F021.12: the NATIVE icon sets, from the same SVG the web
 * icons come from, so no Capacitor or Tauri app keeps its own icon script.
 *
 *   ios/AppIcon.appiconset/        AppIcon-1024.png + Contents.json (Xcode 14+ single size)
 *   android/mipmap-anydpi-v26/     ic_launcher.xml, ic_launcher_round.xml (adaptive)
 *   android/mipmap-<dpi>/          ic_launcher_foreground.png, ic_launcher.png, ic_launcher_round.png
 *   android/values/                ic_launcher_background.xml
 *   desktop/                       icon.ico, icon.icns
 *
 * Two platform rules decide the code, and both fail silently if ignored:
 *  - App Store rejects an app icon with an alpha channel. resvg always renders
 *    RGBA, so the iOS PNG is RE-ENCODED as RGB (colour type 2) — flattening onto
 *    the background is not enough on its own, the channel must be gone.
 *  - Android crops an adaptive icon's 108dp layer to whatever mask the launcher
 *    uses; only the inner 66dp is guaranteed visible. The motif is drawn inside it.
 *
 * `background` is REQUIRED: a white symbol on a transparent canvas renders as an
 * empty icon (measured by buzzalert with `tauri icon`, 25/10).
 *
 * ICO and ICNS are written as plain byte containers holding PNGs — no dependency.
 */
import { deflateSync } from "node:zlib";

export interface NativeIconFile {
  /** Path relative to the output directory, e.g. `ios/AppIcon.appiconset/AppIcon-1024.png`. */
  path: string;
  content: Uint8Array;
}

export interface NativeIconOptions {
  /** Hex colour behind the motif (`#RRGGBB`). Required — see the module comment. */
  background: string;
  /** Default: all three. */
  platforms?: Array<"ios" | "android" | "desktop">;
}

export const NATIVE_BACKGROUND_REQUIRED =
  "nativeIconSet needs `background` (#RRGGBB): a white symbol on a transparent canvas renders as an empty icon";

const HEX = /^#[0-9a-f]{6}$/i;

/** Android density → adaptive foreground px (108dp) and legacy launcher px (48dp). */
export const ANDROID_DENSITIES = [
  { dpi: "mdpi", foreground: 108, legacy: 48 },
  { dpi: "hdpi", foreground: 162, legacy: 72 },
  { dpi: "xhdpi", foreground: 216, legacy: 96 },
  { dpi: "xxhdpi", foreground: 324, legacy: 144 },
  { dpi: "xxxhdpi", foreground: 432, legacy: 192 },
] as const;

/** Share of the 108dp adaptive canvas that every launcher mask keeps visible. */
export const ANDROID_SAFE_ZONE = 66 / 108;

export const ICO_SIZES = [16, 32, 48, 256] as const;
/** ICNS chunk type → pixel size (PNG payloads). */
export const ICNS_CHUNKS = [
  ["ic11", 32],
  ["ic12", 64],
  ["ic07", 128],
  ["ic08", 256],
  ["ic13", 256],
  ["ic09", 512],
  ["ic14", 512],
  ["ic10", 1024],
] as const;

type Shape = "square" | "circle" | "none";

function composeSvg(svg: string, size: number, opts: { background?: string; shape: Shape; scale: number }): string {
  const d = size * opts.scale;
  const o = (size - d) / 2;
  const bg =
    opts.shape === "square" && opts.background
      ? `<rect width="${size}" height="${size}" fill="${opts.background}"/>`
      : opts.shape === "circle" && opts.background
        ? `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="${opts.background}"/>`
        : "";
  const href = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `${bg}<image href="${href}" x="${o}" y="${o}" width="${d}" height="${d}"/></svg>`
  );
}

// ---- PNG encoding (RGB, no alpha) -------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Encode RGBA pixels as an RGB PNG (colour type 2) — the alpha channel is dropped, not just made opaque. */
export function encodeRgbPng(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const raw = new Uint8Array(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      const t = row + 1 + x * 3;
      raw[t] = rgba[s]!;
      raw[t + 1] = rgba[s + 1]!;
      raw[t + 2] = rgba[s + 2]!;
    }
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour, NO alpha
  const sig = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, chunk("IHDR", ihdr), chunk("IDAT", new Uint8Array(deflateSync(raw))), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// ---- containers --------------------------------------------------------------

/** An ICO holding PNG images (Vista+ format). */
export function encodeIco(pngs: Array<{ size: number; png: Uint8Array }>): Uint8Array {
  const header = 6 + 16 * pngs.length;
  const total = header + pngs.reduce((n, p) => n + p.png.length, 0);
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint16(0, 0, true); // reserved
  v.setUint16(2, 1, true); // type: icon
  v.setUint16(4, pngs.length, true);
  let off = header;
  pngs.forEach((p, i) => {
    const e = 6 + i * 16;
    out[e] = p.size >= 256 ? 0 : p.size; // 0 means 256
    out[e + 1] = p.size >= 256 ? 0 : p.size;
    v.setUint16(e + 4, 1, true); // colour planes
    v.setUint16(e + 6, 32, true); // bits per pixel
    v.setUint32(e + 8, p.png.length, true);
    v.setUint32(e + 12, off, true);
    out.set(p.png, off);
    off += p.png.length;
  });
  return out;
}

/** An ICNS holding PNG chunks. */
export function encodeIcns(chunks: Array<{ type: string; png: Uint8Array }>): Uint8Array {
  const total = 8 + chunks.reduce((n, c) => n + 8 + c.png.length, 0);
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  const tag = (at: number, s: string) => {
    for (let i = 0; i < 4; i++) out[at + i] = s.charCodeAt(i);
  };
  tag(0, "icns");
  v.setUint32(4, total);
  let off = 8;
  for (const c of chunks) {
    tag(off, c.type);
    v.setUint32(off + 4, 8 + c.png.length);
    out.set(c.png, off + 8);
    off += 8 + c.png.length;
  }
  return out;
}

// ---- the set -------------------------------------------------------------------

const enc = (s: string) => new TextEncoder().encode(s);

const ADAPTIVE_XML =
  `<?xml version="1.0" encoding="utf-8"?>\n` +
  `<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n` +
  `    <background android:drawable="@color/ic_launcher_background"/>\n` +
  `    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n` +
  `</adaptive-icon>\n`;

const IOS_CONTENTS = JSON.stringify(
  {
    images: [{ filename: "AppIcon-1024.png", idiom: "universal", platform: "ios", size: "1024x1024" }],
    info: { author: "@broberg/pwa", version: 1 },
  },
  null,
  2,
);

/**
 * Every native icon file for `svg`. Requires the optional peer @resvg/resvg-js,
 * like `rasterizeIconSet`.
 */
export async function nativeIconSet(svg: string, opts: NativeIconOptions): Promise<NativeIconFile[]> {
  if (!opts?.background || !HEX.test(opts.background)) throw new Error(NATIVE_BACKGROUND_REQUIRED);
  let Resvg: typeof import("@resvg/resvg-js").Resvg;
  try {
    ({ Resvg } = await import("@resvg/resvg-js"));
  } catch {
    throw new Error("nativeIconSet needs @resvg/resvg-js — install it as a dev dependency: npm i -D @resvg/resvg-js");
  }
  const bg = opts.background;
  const want = new Set(opts.platforms ?? ["ios", "android", "desktop"]);
  const render = (size: number, shape: Shape, scale: number) =>
    new Resvg(composeSvg(svg, size, { background: bg, shape, scale }), { font: { loadSystemFonts: false } }).render();
  const png = (size: number, shape: Shape, scale: number) => new Uint8Array(render(size, shape, scale).asPng());

  const files: NativeIconFile[] = [];

  if (want.has("ios")) {
    const r = render(1024, "square", 0.8);
    files.push(
      { path: "ios/AppIcon.appiconset/AppIcon-1024.png", content: encodeRgbPng(new Uint8Array(r.pixels), r.width, r.height) },
      { path: "ios/AppIcon.appiconset/Contents.json", content: enc(IOS_CONTENTS + "\n") },
    );
  }

  if (want.has("android")) {
    files.push(
      { path: "android/mipmap-anydpi-v26/ic_launcher.xml", content: enc(ADAPTIVE_XML) },
      { path: "android/mipmap-anydpi-v26/ic_launcher_round.xml", content: enc(ADAPTIVE_XML) },
      {
        path: "android/values/ic_launcher_background.xml",
        content: enc(
          `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${bg}</color>\n</resources>\n`,
        ),
      },
    );
    for (const d of ANDROID_DENSITIES) {
      files.push(
        { path: `android/mipmap-${d.dpi}/ic_launcher_foreground.png`, content: png(d.foreground, "none", ANDROID_SAFE_ZONE) },
        { path: `android/mipmap-${d.dpi}/ic_launcher.png`, content: png(d.legacy, "square", 0.7) },
        { path: `android/mipmap-${d.dpi}/ic_launcher_round.png`, content: png(d.legacy, "circle", 0.62) },
      );
    }
  }

  if (want.has("desktop")) {
    files.push(
      { path: "desktop/icon.ico", content: encodeIco(ICO_SIZES.map((size) => ({ size, png: png(size, "square", 0.8) }))) },
      { path: "desktop/icon.icns", content: encodeIcns(ICNS_CHUNKS.map(([type, size]) => ({ type, png: png(size, "square", 0.8) }))) },
    );
  }

  return files;
}
