// F074.4 — point the Preact build at preact/compat, and refuse if anything still
// imports react. Runs after tsup, before verify-exports (see package.json build).
import { readFileSync, writeFileSync } from "node:fs";

const FILES = ["dist/preact.js", "dist/preact.cjs", "dist/preact.d.ts", "dist/preact.d.cts"];
const MAP = [
  [/(['"])react\/jsx-runtime\1/g, "$1preact/jsx-runtime$1"],
  [/(['"])react-dom\1/g, "$1preact/compat$1"],
  [/(['"])react\1/g, "$1preact/compat$1"],
];
const left = [];
for (const f of FILES) {
  const url = new URL(f, import.meta.url);
  let src = readFileSync(url, "utf8");
  for (const [re, to] of MAP) src = src.replace(re, to);
  writeFileSync(url, src);
  for (const m of src.matchAll(/(?:from\s*|require\(|import\()\s*['"](react(?:-dom)?(?:\/[\w/-]+)?)['"]/g)) left.push(`${f}: ${m[1]}`);
}
if (left.length) {
  console.error(`✗ the Preact build still imports React:\n  ${left.join("\n  ")}`);
  process.exit(1);
}
console.log(`✓ preact build points at preact (${FILES.length} files, no react import)`);
