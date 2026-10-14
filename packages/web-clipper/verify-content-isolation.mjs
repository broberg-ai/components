// Build-time seal (F099.21, jam #3274): 0.10.0 shipped a dist where /extract and the popup's
// entries imported the SAME chunk (core). A consumer's Vite then split that module out, and the
// injected content script had an `import` — contentScriptStandsAlone() stopped THEIR build, after
// we had published. This fails OUR build instead: the modules a content script loads (/content,
// /extract) must share no chunk with the modules a popup loads.
import { readFileSync } from "node:fs";

const dist = new URL("./dist/", import.meta.url);
const closure = (entry) => {
  const seen = new Set();
  const visit = (file) => {
    for (const m of readFileSync(new URL(file, dist), "utf8").matchAll(/\bfrom\s*["']\.\/(chunk-[\w-]+\.js)["']|\bimport\s*\(?\s*["']\.\/(chunk-[\w-]+\.js)["']/g)) {
      const dep = m[1] ?? m[2];
      if (!seen.has(dep)) { seen.add(dep); visit(dep); }
    }
  };
  visit(entry);
  return seen;
};
const contentSide = new Set(["content.js", "extract.js"].flatMap((e) => [...closure(e)]));
const shared = [];
for (const e of ["ui.js", "engine.js", "transport.js", "auth.js", "extension.js", "core.js"]) {
  for (const c of closure(e)) if (contentSide.has(c)) shared.push(`${e} ↔ ${c}`);
}
if (shared.length) {
  console.error(`✗ the content script's modules share chunk(s) with the popup's:\n  ${shared.join("\n  ")}\n` +
    "A consumer's extension build will refuse this (an injected content script cannot import). Keep /extract and /content free of imports the popup also makes.");
  process.exit(1);
}
console.log(`✓ content-script modules share no chunk with the popup (${contentSide.size} chunk(s) on the content side)`);
