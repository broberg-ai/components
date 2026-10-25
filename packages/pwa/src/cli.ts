/// <reference types="node" />
// F021.9 — `pwa-icons`: SVG + PNG icon set in one command, so no app keeps its
// own sharp script. Prints the manifest icons[] and the apple-touch href.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { buildIconSet } from "./manifest.js";
import { rasterizeIconSet, nativeIconSet, NATIVE_BACKGROUND_REQUIRED } from "./raster.js";

const USAGE =
  "usage: pwa-icons (--svg <file> | --monogram <text>) [--background <hex>] [--color <hex>] [--out public/icons] [--base-path /icons] [--root <web root, default: the parent of --out>]\n       pwa-icons --svg <file> --native <out dir> --background <#RRGGBB>   (iOS AppIcon, Android adaptive, .ico, .icns)";

export async function main(argv: string[]): Promise<number> {
  const arg = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const svgFile = arg("svg");
  const monogram = arg("monogram");
  if (!svgFile && !monogram) {
    console.error(`pwa-icons: give --svg <file> or --monogram <text>\n${USAGE}`);
    return 1;
  }
  // F021.12 — native sets. Background is required: a white symbol on a transparent
  // canvas renders as an empty icon (buzzalert, 25/10).
  const native = arg("native");
  if (native !== undefined) {
    if (!svgFile) {
      console.error(`pwa-icons: --native needs --svg <file>\n${USAGE}`);
      return 1;
    }
    const background = arg("background");
    if (!background) {
      console.error(`pwa-icons: --native needs --background <#RRGGBB> — ${NATIVE_BACKGROUND_REQUIRED}`);
      return 1;
    }
    let files;
    try {
      files = await nativeIconSet(readFileSync(svgFile, "utf8"), { background });
    } catch (e) {
      console.error(`pwa-icons: ${(e as Error).message}`);
      return 1;
    }
    for (const f of files) {
      mkdirSync(dirname(join(native, f.path)), { recursive: true });
      writeFileSync(join(native, f.path), f.content);
    }
    console.log(JSON.stringify({ native: files.map((f) => f.path) }, null, 2));
    return 0;
  }
  const out = arg("out") ?? "public/icons";
  const set = buildIconSet({
    svg: svgFile ? readFileSync(svgFile, "utf8") : undefined,
    monogram,
    background: arg("background"),
    color: arg("color"),
    basePath: arg("base-path") ?? "/icons",
  });
  let raster;
  try {
    raster = await rasterizeIconSet(set);
  } catch (e) {
    console.error(`pwa-icons: ${(e as Error).message}`);
    return 1;
  }
  mkdirSync(out, { recursive: true });
  for (const f of set.files) writeFileSync(join(out, basename(f.path)), f.content);
  for (const f of raster.files) writeFileSync(join(out, basename(f.path)), f.content);
  // F021.11 — iOS asks the web ROOT for these on its own.
  const root = arg("root") ?? dirname(out);
  for (const f of raster.rootFiles) writeFileSync(join(root, basename(f.path)), f.content);
  console.log(JSON.stringify({ icons: raster.icons, appleTouchIcon: raster.appleTouchIcon }, null, 2));
  return 0;
}

