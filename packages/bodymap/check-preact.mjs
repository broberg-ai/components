// F052.4 — build-time seal: the Preact build must not import React. Fails the build otherwise.
import { readFileSync } from "node:fs";
const bad = [];
for (const f of ["dist/preact.js", "dist/preact.cjs", "dist/preact.d.ts", "dist/preact.d.cts"]) {
  const src = readFileSync(new URL(f, import.meta.url), "utf8");
  const hits = [...src.matchAll(/(?:from\s*|require\(\s*|import\(\s*)["'](react(?:-dom)?(?:\/[^"']*)?)["']/g)].map((m) => m[1]);
  if (hits.length) bad.push(`${f}: ${[...new Set(hits)].join(", ")}`);
}
if (bad.length) { console.error(`✗ the Preact build imports React:\n  ${bad.join("\n  ")}`); process.exit(1); }
console.log("✓ dist/preact.* imports no react / react-dom");
