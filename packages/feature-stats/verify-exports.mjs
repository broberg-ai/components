// Build-time seal (F061, originally F054.6): fail the build if any file
// referenced by package.json "exports" is missing from dist. This catches the
// tsup multi-config clean race that dropped react.d.ts/react.d.cts from the
// @broberg/pwa 0.2.1 tarball — a missing types file now blocks `build` (and
// thus the publish job) instead of shipping a package a consumer can't
// type-check.
//
// F078.2: this copy WALKS NESTED CONDITIONS. The original only read one level
// (`Object.entries(cond)`, skipping anything that wasn't a string), so the
// moment an exports map uses per-condition types —
//   "./x": { "import": { "types": …, "default": … }, "require": { … } }
// — it silently checked NOTHING and still printed a tick. A seal that reports
// success because it never ran is worse than no seal, so the walk is recursive
// and the count it prints is the proof it actually looked.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url)));
const root = new URL("./", import.meta.url);

const missing = [];
let checked = 0;

function walk(node, path) {
  if (typeof node === "string") {
    if (!node.startsWith(".")) return; // a bare package name, not a file
    checked++;
    if (!existsSync(fileURLToPath(new URL(node, root)))) missing.push(`${path}: ${node}`);
    return;
  }
  if (!node || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) walk(value, `${path} → ${key}`);
}

walk(pkg.exports || {}, "exports");

if (!checked) {
  console.error('✗ "exports" declared no file targets — the seal checked nothing. Refusing to ship.');
  process.exit(1);
}

if (missing.length) {
  console.error(
    `✗ package.json "exports" points to ${missing.length} file(s) missing from dist:\n  ` +
      missing.join("\n  ") +
      "\nDid a tsup entry fail to emit? dist is incomplete — refusing to ship.",
  );
  process.exit(1);
}
console.log(`✓ all ${checked} export targets resolve to built files in dist`);
