#!/usr/bin/env node
/**
 * F061.3 — every @broberg/* package must let a consumer read its own version.
 *
 *   node scripts/check-package-json-export.mjs
 *
 * A package with an `exports` map and no "./package.json" entry makes this throw:
 *
 *   require('@broberg/sms/package.json')   ERR_PACKAGE_PATH_NOT_EXPORTED
 *
 * WHICH IS INDISTINGUISHABLE FROM THE PACKAGE NOT BEING INSTALLED. That is the
 * whole reason this check exists rather than a lint rule nobody reads.
 *
 * Measured 2026-08-29: 39 of 39 packages blocked it, and both halves of the
 * damage showed up the same afternoon. Our own Discovery enrollment for
 * @broberg/sms said 0.2.0 while npm served 0.12.0 — ten minors of drift in our
 * self-report about our OWN package. fd-sundhed had reported 7 adoptions while
 * using 14, three of them on the wrong version. Neither was carelessness:
 * neither repo had a reliable way to look, because we had made looking throw.
 *
 * Their probe reported "NOT INSTALLED" for seven packages that were installed,
 * and their sentence for it is the one to keep: MEASURED THROUGH A LAYER, AND
 * THE LAYER ANSWERED.
 *
 * package.json's own `dependencies` is not a substitute — a declared RANGE and
 * the version actually in node_modules can disagree, and the installed one is
 * the only honest answer. Reading it is exactly what this unblocks.
 */
import { readFileSync, readdirSync } from "node:fs";

const PKGS = new URL("../packages/", import.meta.url);

const missing = [];
let checked = 0;

for (const dir of readdirSync(PKGS, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(new URL(`${dir.name}/package.json`, PKGS), "utf8"));
  } catch {
    continue;
  }
  if (!String(pkg.name ?? "").startsWith("@broberg/")) continue;
  // No exports map at all means deep imports already work — nothing to enforce.
  if (!pkg.exports) continue;
  checked++;
  if (pkg.exports["./package.json"] !== "./package.json") missing.push(pkg.name);
}

if (!checked) {
  // An empty sweep passes vacuously, and that must not read as a clean bill.
  console.error("\n  No @broberg/* packages with an exports map were found.\n  Nothing was checked; this is not a pass.\n");
  process.exit(1);
}

if (missing.length) {
  console.error(
    `\n  ✗ ${missing.length} of ${checked} package(s) cannot tell a consumer what version they are:\n` +
      missing.map((n) => `    ${n}`).join("\n") +
      `\n\n  Add to each exports map:  "./package.json": "./package.json"\n` +
      `  Without it, require('<pkg>/package.json') throws ERR_PACKAGE_PATH_NOT_EXPORTED,\n` +
      `  which a probe cannot tell apart from the package not being installed at all.\n`,
  );
  process.exit(1);
}

console.log(`✓ all ${checked} @broberg/* packages export ./package.json — a consumer can read its own installed version`);
