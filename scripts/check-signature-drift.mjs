#!/usr/bin/env node
/**
 * F038.4 — guard the one machine-checkable claim inside the curated prose.
 *
 * A Discovery description is the ONLY thing a consumer reads before writing its
 * first call-site (the fleet rule is "check Discovery before you build"), which
 * makes a wrong signature there worse than no signature at all: it is
 * confidently wrong, and it gets copied. beacon lost a test to exactly that —
 * we documented `contentDisposition({ filename, type? })` for a function whose
 * real signature is positional, so the object landed where the string belonged.
 *
 * This does NOT try to verify the whole signature; it checks the mismatch that
 * actually produces a crash on the first call — documented object-call vs
 * actual positional first parameter, and the reverse. Parameter names and inner
 * types stay prose.
 *
 * Usage:  node scripts/check-signature-drift.mjs [--json]
 * Exits 1 when any mismatch is found.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DATA } from "./inventory-data.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Words that look like calls in prose but are not exported functions. */
const PROSE_NOISE = new Set([
  "e.g", "i.e", "etc", "vs", "cf", "ca", "fx", "npm", "npx", "GET", "POST",
  "PUT", "DELETE", "PATCH", "if", "for", "while", "return", "typeof",
]);

/** Local package dir for an `@broberg/x` name, or null when not in this repo. */
function packageDir(pkg) {
  if (!pkg?.startsWith("@broberg/")) return null;
  const dir = join(ROOT, "packages", pkg.slice("@broberg/".length));
  return existsSync(dir) ? dir : null;
}

/** Every built .d.ts in a package's dist (all entry points, not just index). */
function declarationFiles(dir) {
  const dist = join(dir, "dist");
  if (!existsSync(dist)) return [];
  return readdirSync(dist)
    .filter((f) => f.endsWith(".d.ts"))
    .map((f) => join(dist, f));
}

const PRIMITIVE = /^(string|number|boolean|bigint)(\s*\[\])?$/;

/**
 * Slice off just the FIRST parameter, respecting nesting — a naive split on ","
 * turns `filename: string, opts?: Options` into a type of
 * `string, opts?: Options`, which resolves to nothing and silently disables the
 * check for every multi-parameter function.
 */
function firstParameter(params) {
  let depth = 0;
  for (let i = 0; i < params.length; i++) {
    const c = params[i];
    if ("{[(<".includes(c)) depth++;
    else if ("}])>".includes(c)) depth--;
    else if (c === "," && depth === 0) return params.slice(0, i).trim();
  }
  return params.trim();
}

/**
 * Classify a function's FIRST parameter as "object" | "primitive" | "unknown".
 *
 * A named type must be RESOLVED, not assumed: `createNotifier(config:
 * NotifierConfig)` is called `createNotifier({ … })` at every call-site, so
 * treating a named type as positional produces false alarms — and a check that
 * cries wolf gets deleted just as fast as one that never fires.
 */
function firstParamKind(first, dtsText) {
  if (!first) return "unknown";
  if (/^\{/.test(first)) return "object"; // destructured
  const typed = first.match(/^\w+\??\s*:\s*(.+)$/s);
  if (!typed) return "unknown";
  const type = typed[1].trim();
  if (/^\{/.test(type)) return "object"; // inline object literal
  if (PRIMITIVE.test(type)) return "primitive";
  const named = type.match(/^([A-Za-z_$][\w$]*)/);
  if (named) {
    const n = named[1];
    // Resolve the alias/interface within the same declaration file.
    if (new RegExp(`(?:interface|declare interface)\\s+${n}\\b`).test(dtsText)) return "object";
    const alias = dtsText.match(new RegExp(`type\\s+${n}\\s*=\\s*([^;]+)`));
    if (alias) {
      const rhs = alias[1].trim();
      if (/^\{/.test(rhs)) return "object";
      if (PRIMITIVE.test(rhs)) return "primitive";
    }
  }
  return "unknown";
}

/** Map<name, { kind, raw }> for every declared function in a .d.ts. */
function exportedFunctions(dtsText) {
  const out = new Map();
  // tsup emits `declare function x()` + a trailing `export { x }`, so the
  // `export` keyword is NOT on the declaration. Matching only
  // `export declare function` finds nothing at all — a check that cannot fire.
  const re = /(?:export\s+)?declare function (\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)/g;
  let m;
  while ((m = re.exec(dtsText))) {
    const [, name, params] = m;
    const first = firstParameter(params);
    if (!out.has(name)) {
      out.set(name, { kind: firstParamKind(first, dtsText), raw: first.split("\n")[0] ?? "" });
    }
  }
  return out;
}

/**
 * Pull documented call-shapes out of a description.
 * "object" = `fn({ … })` · "positional" = `fn(something-not-a-brace)` ·
 * "empty" = `fn()`, which is compatible with any optional-first-arg signature.
 */
function documentedCalls(desc) {
  const out = new Map();
  const re = /\b([a-zA-Z_$][\w$]*)\(\s*([{)])?/g;
  let m;
  while ((m = re.exec(desc))) {
    const [, name, next] = m;
    if (PROSE_NOISE.has(name)) continue;
    const shape = next === "{" ? "object" : next === ")" ? "empty" : "positional";
    // First mention wins; a later prose mention shouldn't override it.
    if (!out.has(name)) out.set(name, shape);
  }
  return out;
}

const mismatches = [];
let checkedPkgs = 0;
let skippedNoDist = 0;
const skippedNames = [];

for (const group of DATA) {
  for (const item of group.items) {
    const dir = packageDir(item.pkg);
    if (!dir) {
      if (item.pkg) skippedNames.push(item.pkg);
      continue;
    }
    const dts = declarationFiles(dir);
    if (!dts.length) {
      skippedNoDist++;
      skippedNames.push(`${item.pkg} (not built)`);
      continue;
    }
    checkedPkgs++;

    const exported = new Map();
    for (const f of dts) for (const [k, v] of exportedFunctions(readFileSync(f, "utf8"))) {
      if (!exported.has(k)) exported.set(k, v);
    }

    for (const [name, documented] of documentedCalls(item.desc ?? "")) {
      const actual = exported.get(name);
      if (!actual) continue; // not an exported function — prose, a type, a CLI
      if (actual.kind === "unknown" || documented === "empty") continue;

      // ONLY this direction. A documented `fn({ … })` against a primitive first
      // parameter is unambiguous — you cannot legitimately write a brace there,
      // and it crashes on the first call (beacon's bug).
      //
      // The reverse is deliberately NOT checked: prose routinely names the
      // argument variable rather than showing a literal — `createI18n(config)`,
      // `capture(opts)`, `runFlow(body)` are all correct descriptions of
      // object-taking functions. Flagging those made the check cry wolf on four
      // healthy packages, and a noisy check gets deleted.
      if (!(documented === "object" && actual.kind === "primitive")) continue;

      mismatches.push({
        pkg: item.pkg,
        fn: name,
        documented: `${name}({ … })`,
        actual: `${name}(${actual.raw.trim()}${actual.raw ? ", …" : ""})`,
        hint: "docs show an object call, but the first parameter is a primitive",
      });
    }
  }
}

const report = { checkedPkgs, skipped: skippedNames.length, skippedNoDist, mismatches };

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`signature-drift: checked ${checkedPkgs} local package(s)`);
  // Never silently pass over what we could not check.
  if (skippedNames.length) {
    console.log(`  skipped ${skippedNames.length} (no local source or not built): ${skippedNames.join(", ")}`);
  }
  for (const m of mismatches) {
    console.error(`\n  MISMATCH  ${m.pkg} → ${m.fn}()`);
    console.error(`    documented: ${m.documented}`);
    console.error(`    actual:     ${m.actual}`);
    console.error(`    ${m.hint}`);
  }
  console.log(mismatches.length ? `\n${mismatches.length} mismatch(es).` : "  no mismatches.");
}

process.exit(mismatches.length ? 1 : 0);
