/**
 * @broberg/pwa/raster — F021.9: PNG icons, because iOS does not use an SVG
 * apple-touch-icon. «Add to Home Screen» on an iPhone with only SVG icons shows
 * a screenshot of the page instead of the logo (measured by sales, 10/10).
 *
 * Kept OUT of the core entries so `@broberg/pwa` and `/manifest` stay
 * dependency-free: the renderer, @resvg/resvg-js (prebuilt binaries, no system
 * libraries), is an optional peer loaded only when this runs.
 */
import type { IconSet, ManifestIcon } from "./manifest.js";

export interface RasterIcon {
  /** URL path, e.g. `/icons/icon-180.png`. */
  path: string;
  content: Uint8Array;
  type: "image/png";
  size: number;
  purpose: "any" | "maskable";
}

export interface RasterIconSet {
  files: RasterIcon[];
  /** Manifest `icons[]` pointing at the PNGs. */
  icons: ManifestIcon[];
  /** Href for `<link rel="apple-touch-icon">` — pass it to `pwaMetaTags({ appleTouchIcon })`. Undefined when 180 was not generated. */
  appleTouchIcon?: string;
}

export interface RasterizeOptions {
  /** Extra font files for monogram text (system fonts are loaded too). */
  fontFiles?: string[];
}

export const RESVG_MISSING =
  "rasterizeIconSet needs @resvg/resvg-js — install it as a dev dependency: npm i -D @resvg/resvg-js";

const toPng = (p: string) => p.replace(/\.svg$/, ".png");

/** Rasterise every SVG from `buildIconSet` to a PNG of the same size. */
export async function rasterizeIconSet(set: IconSet, opts: RasterizeOptions = {}): Promise<RasterIconSet> {
  let Resvg: typeof import("@resvg/resvg-js").Resvg;
  try {
    ({ Resvg } = await import("@resvg/resvg-js"));
  } catch {
    throw new Error(RESVG_MISSING);
  }
  const files: RasterIcon[] = set.files.map((f) => {
    const png = new Resvg(f.content, {
      fitTo: { mode: "width", value: f.size },
      font: { loadSystemFonts: true, fontFiles: opts.fontFiles ?? [] },
    })
      .render()
      .asPng();
    return { path: toPng(f.path), content: new Uint8Array(png), type: "image/png", size: f.size, purpose: f.purpose };
  });
  const icons = set.icons.map((i) => ({ ...i, src: toPng(i.src), type: "image/png" }));
  const apple = files.find((f) => f.size === 180 && f.purpose === "any");
  return { files, icons, appleTouchIcon: apple?.path };
}
