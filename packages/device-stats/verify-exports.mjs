// Build-time seal (F054.6): fail the build if any file referenced by
// package.json "exports" is missing from dist. This catches the tsup
// multi-config clean race that dropped react.d.ts/react.d.cts from the 0.2.1
// tarball — a missing types file now blocks `pnpm build` (and thus the publish
// job's Build step) instead of shipping a package a consumer can't type-check.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url)));
const root = new URL("./", import.meta.url);

const missing = [];
let checked = 0;
for (const [sub, cond] of Object.entries(pkg.exports || {})) {
  if (!cond || typeof cond !== "object") continue;
  for (const [key, rel] of Object.entries(cond)) {
    if (typeof rel !== "string") continue;
    checked++;
    if (!existsSync(fileURLToPath(new URL(rel, root)))) missing.push(`${sub} → ${key}: ${rel}`);
  }
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
