// F074.4 AC#11 — the headless core imports NO framework, asserted on the BUILT
// output, so a dependency that creeps into src/shell.ts fails `pnpm build`.
// Two thin wrappers over one core only stay two thin wrappers while the core
// cannot reach for React or Preact itself.
import { readFileSync, existsSync } from "node:fs";

const FILES = ["dist/shell.js", "dist/shell.cjs"];
const FRAMEWORK = /(?:from\s*|require\()\s*["'](react|react-dom|preact|preact\/[\w/-]+|react\/[\w/-]+)["']/g;

const missing = FILES.filter((f) => !existsSync(new URL(f, import.meta.url)));
if (missing.length) {
  console.error(`✗ cannot check the headless core: ${missing.join(", ")} not built`);
  process.exit(1);
}
const hits = [];
for (const f of FILES) {
  const src = readFileSync(new URL(f, import.meta.url), "utf8");
  for (const m of src.matchAll(FRAMEWORK)) hits.push(`${f}: imports "${m[1]}"`);
}
if (hits.length) {
  console.error(`✗ the headless shell core imports a framework:\n  ${hits.join("\n  ")}\n  Move it into the wrapper.`);
  process.exit(1);
}
console.log(`✓ shell core is headless (${FILES.length} built files, no react/preact import)`);
