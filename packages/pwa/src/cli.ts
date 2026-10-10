/// <reference types="node" />
// F021.9 — `pwa-icons`: SVG + PNG icon set in one command, so no app keeps its
// own sharp script. Prints the manifest icons[] and the apple-touch href.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { buildIconSet } from "./manifest.js";
import { rasterizeIconSet } from "./raster.js";

const USAGE =
  "usage: pwa-icons (--svg <file> | --monogram <text>) [--background <hex>] [--color <hex>] [--out public/icons] [--base-path /icons]";

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
  console.log(JSON.stringify({ icons: raster.icons, appleTouchIcon: raster.appleTouchIcon }, null, 2));
  return 0;
}

