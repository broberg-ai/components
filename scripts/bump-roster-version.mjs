#!/usr/bin/env node
// F038.16 — the release carries the roster bump.
//
//   node scripts/bump-roster-version.mjs @broberg/theme 0.7.0
//   node scripts/bump-roster-version.mjs @broberg/theme 0.7.0 --no-registry-check
//
// WHY THIS EXISTS. "Remember to bump the roster after publishing" failed twice in
// one night, four hours apart, in the same session — once costing twelve
// consecutive red Discovery deploys because a stale roster blocks the deploy of
// everything else too. The Harness-kontrakt already names the shape: a gate does
// not depend on an agent remembering anything. publish.yml already HOLDS the
// package and the version; requiring a second step to copy a number the pipeline
// owns is a duplicate fact with an owner.
//
// THE GUARD IS THE REGISTRY, NOT THE JOB GRAPH. A publish that FAILED must never
// bump the row — a roster naming a version npm does not serve is worse than one
// that is merely behind, because a session is then told to install something
// that does not exist (the webpush precedent). So this asks npm directly rather
// than trusting a `needs:` edge: the roster's whole claim is "npm serves this",
// so that is the thing to check.
//
// Exit 0 changed · 0 already correct (idempotent) · 1 a real failure · 2 could
// not reach the registry, which is not a verdict on anything.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROSTER = join(HERE, "inventory-data.mjs");

/** Every `ver:"…"` that belongs to the FIRST row after each `pkg:"<name>"`. */
export function bumpVersions(source, pkg, version) {
  const marker = `pkg:"${pkg}"`;
  let out = "";
  let rest = source;
  let rows = 0;
  let alreadyCorrect = 0;

  for (;;) {
    const at = rest.indexOf(marker);
    if (at === -1) break;
    // A roster row is one object literal; `ver` always follows `pkg` inside it,
    // and the next `}` closes the row. Bounding the search by that brace is what
    // stops a bump leaking into the NEXT package's row when this one has no ver.
    const rowEnd = rest.indexOf("}", at);
    const window = rest.slice(at, rowEnd === -1 ? rest.length : rowEnd);
    const m = /ver:"([^"]*)"/.exec(window);
    if (!m) {
      out += rest.slice(0, at + marker.length);
      rest = rest.slice(at + marker.length);
      continue;
    }
    const verAt = at + m.index;
    if (m[1] === version) alreadyCorrect++;
    else rows++;
    out += rest.slice(0, verAt) + `ver:"${version}"`;
    rest = rest.slice(verAt + m[0].length);
  }
  out += rest;
  return { source: out, rows, alreadyCorrect, found: rows + alreadyCorrect };
}

/** Does the registry actually serve it? Three outcomes, never two. */
function servedByNpm(pkg, version) {
  try {
    const out = execFileSync("npm", ["view", `${pkg}@${version}`, "version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return out === version ? "yes" : "no";
  } catch (e) {
    const text = String(e.stderr ?? "") + String(e.stdout ?? "");
    // npm distinguishes these, and so must we: a version that does not exist is
    // a VERDICT (do not bump); a network failure is not.
    if (/E404|notarget|No matching version/i.test(text)) return "no";
    return "unreachable";
  }
}

const [, , pkg, version, ...flags] = process.argv;
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  if (!pkg || !version) {
    console.error("usage: bump-roster-version.mjs <@broberg/pkg> <version> [--no-registry-check]");
    process.exit(1);
  }

  if (!flags.includes("--no-registry-check")) {
    const served = servedByNpm(pkg, version);
    if (served === "unreachable") {
      console.error(
        `✗ could not reach the npm registry to confirm ${pkg}@${version}.\n` +
          `  NOT a verdict on the release — the roster is unchanged and check-roster-versions\n` +
          `  will catch it on the next Discovery run.`,
      );
      process.exit(2);
    }
    if (served === "no") {
      console.error(
        `✗ npm does not serve ${pkg}@${version}, so the roster must NOT name it.\n` +
          `  A row pointing at a version nobody can install is worse than one that is behind:\n` +
          `  a session is told to install something that does not exist.`,
      );
      process.exit(1);
    }
  }

  const before = readFileSync(ROSTER, "utf8");
  const { source, rows, alreadyCorrect, found } = bumpVersions(before, pkg, version);

  if (found === 0) {
    console.error(
      `✗ no roster row for ${pkg}. A published package the roster does not list is invisible\n` +
        `  to every repo told to read Discovery first — add the row by hand, with its desc.`,
    );
    process.exit(1);
  }
  if (rows === 0) {
    console.log(`= ${pkg} already at ${version} in ${alreadyCorrect} row(s) — nothing to do.`);
    process.exit(0);
  }

  writeFileSync(ROSTER, source);
  console.log(`✓ ${pkg} → ${version} in ${rows} row(s)${alreadyCorrect ? ` (${alreadyCorrect} already correct)` : ""}.`);
}
