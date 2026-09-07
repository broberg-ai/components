#!/usr/bin/env node
// F038.16 — tests for the roster bump, on synthetic roster text so no case
// depends on what the real file happens to contain today.
//
//   node scripts/test-bump-roster-version.mjs
import { bumpVersions } from "./bump-roster-version.mjs";

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    failed++;
    console.log(`  ✗ ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
  } else {
    console.log(`  ✓ ${name}`);
  }
};

const row = (pkg, ver, extra = "") => `{f:"F1",nm:"x",pkg:"${pkg}"${ver ? `,ver:"${ver}"` : ""}${extra},desc:"d"}`;

// 1 — the ordinary case
{
  const src = `[${row("@broberg/theme", "0.6.0")}]`;
  const r = bumpVersions(src, "@broberg/theme", "0.7.0");
  check("bumps the row", [r.rows, r.source.includes('ver:"0.7.0"')], [1, true]);
}

// 2 — TWO rows for one package. mail-core and theme both have this today, and a
// bump that fixed only the first would leave the roster disagreeing with itself.
{
  const src = `[${row("@broberg/theme", "0.6.0")},${row("@broberg/theme", "0.6.0")}]`;
  const r = bumpVersions(src, "@broberg/theme", "0.7.0");
  check("bumps BOTH rows for the same package", [r.rows, (r.source.match(/ver:"0\.7\.0"/g) || []).length], [2, 2]);
}

// 3 — THE ONE THAT MATTERS, and the reason the search is bounded by the row's
// closing brace: a package with NO ver must not steal the NEXT package's.
{
  const src = `[${row("@broberg/planned", null)},${row("@broberg/other", "1.0.0")}]`;
  const r = bumpVersions(src, "@broberg/planned", "9.9.9");
  check("a row with no ver does not consume the next row's", [r.found, r.source.includes('ver:"1.0.0"')], [0, true]);
  check("...and reports found:0 so the caller can fail loudly", r.found, 0);
}

// 4 — a NEIGHBOURING package is untouched
{
  const src = `[${row("@broberg/theme", "0.6.0")},${row("@broberg/pwa", "0.3.0")}]`;
  const r = bumpVersions(src, "@broberg/theme", "0.7.0");
  check("leaves other packages alone", [r.source.includes('ver:"0.3.0"'), r.rows], [true, 1]);
}

// 5 — a package whose NAME is a prefix of another. @broberg/lens vs
// @broberg/lens-engine: matching on the bare name would bump both.
{
  const src = `[${row("@broberg/lens", "0.1.3")},${row("@broberg/lens-engine", "0.7.0")}]`;
  const r = bumpVersions(src, "@broberg/lens", "0.2.0");
  check("a prefix name does not bump its longer sibling", [r.rows, r.source.includes('ver:"0.7.0"')], [1, true]);
}

// 6 — idempotent. The workflow may re-run; a second bump must be a no-op that
// reports itself rather than an error.
{
  const src = `[${row("@broberg/theme", "0.7.0")}]`;
  const r = bumpVersions(src, "@broberg/theme", "0.7.0");
  check("already correct → 0 changed, 1 found", [r.rows, r.alreadyCorrect, r.found], [0, 1, 1]);
}

// 7 — an unknown package changes nothing at all
{
  const src = `[${row("@broberg/theme", "0.6.0")}]`;
  const r = bumpVersions(src, "@broberg/nope", "1.0.0");
  check("unknown package: found 0 and the source is byte-identical", [r.found, r.source === src], [0, true]);
}

// 8 — the REAL roster parses and still bumps, so the synthetic rows above are
// not the only thing keeping this green.
{
  const { readFileSync } = await import("node:fs");
  const { ROSTER } = await import("./bump-roster-version.mjs");
  const real = readFileSync(ROSTER, "utf8");
  const r = bumpVersions(real, "@broberg/theme", "9.9.9");
  check("the real roster has theme rows and they bump", r.found >= 1, true);
  check("...and nothing else moved", real.length === r.source.length, true);
}

console.log(failed ? `\n${failed} failing\n` : `\nall green\n`);
process.exit(failed ? 1 : 0);
