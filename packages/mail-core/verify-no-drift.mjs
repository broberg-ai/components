#!/usr/bin/env node
// F023.13 — prove that a consumer whose brand was ALREADY legible gets
// byte-identical HTML from the new version.
//
//   node verify-no-drift.mjs
//
// AGAINST THE TARBALL ON NPM, not against our own previous build. Those are
// different artefacts, and treating one as evidence for the other is a mistake
// this repo made the same week: a registry document listed a version while an
// install of it answered ETARGET.
//
// Renders the same five shapes through the PUBLISHED package and through the
// local build, and requires the output to match byte for byte for #0f7391 —
// which measures 4.92:1 on the footer backdrop and 5.41:1 on the card, i.e.
// above the floor, so the derivation must return it untouched.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEAL = "#0f7391";

/** The shapes. Deliberately including a footerHref, which the SHELL_VERSION
 *  fixture does NOT have — so this covers the one call site that fixture is
 *  blind to, and the blindness is the reason it is spelled out here. */
const CASES = `
  const out = {};
  out.minimal  = m.renderShell({ subject:"s", accentColor:"${TEAL}", bodyHtml:"<p>x</p>" });
  out.footer   = m.renderShell({ subject:"s", accentColor:"${TEAL}", bodyHtml:"<p>x</p>", footerLines:["a","b"], footerHref:"https://x.dk", footerLabel:"x.dk" });
  out.logo     = m.renderShell({ subject:"s", accentColor:"${TEAL}", bodyHtml:"<p>x</p>", logoUrl:"https://x.dk/l.png", logoWidth:56 });
  out.cta      = m.cta("https://x.dk","Åbn",{ accentColor:"${TEAL}" });
  out.eyebrow  = m.eyebrow("PROJEKT",{ accentColor:"${TEAL}" });
  out.factBox  = m.factBox([{label:"L",value:"V"}],{ accentColor:"${TEAL}" });
  out.noteBox  = m.noteBox("<p>n</p>",{ accentColor:"${TEAL}" });
  process.stdout.write(JSON.stringify(out));
`;

function renderWith(importPath, cwd) {
  const script = join(cwd, `render-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(script, `const m = await import(${JSON.stringify(importPath)});\n${CASES}`);
  return JSON.parse(execFileSync("node", [script], { cwd, encoding: "utf8", maxBuffer: 32e6 }));
}

const published = process.argv[2] ?? "latest";
const dir = mkdtempSync(join(tmpdir(), "mail-core-drift-"));
execFileSync("npm", ["init", "-y"], { cwd: dir, stdio: "ignore" });
execFileSync("npm", ["i", "--silent", `@broberg/mail-core@${published}`], { cwd: dir, stdio: "inherit" });

const publishedVersion = JSON.parse(
  execFileSync("node", ["-p", "JSON.stringify(require('@broberg/mail-core/package.json'))"], { cwd: dir, encoding: "utf8" }),
).version;

const before = renderWith("@broberg/mail-core", dir);
const after = renderWith(join(process.cwd(), "dist", "index.js"), dir);

/** THREE OUTCOMES, NOT TWO. The shell stamps its own SHELL_VERSION into every
 *  render, and that marker moves on any release that changes the rendering for
 *  ANYONE — so a raw byte-compare would go red on every such release and stop
 *  meaning anything. Normalising it away silently would be the opposite
 *  mistake: real drift could then hide behind a version bump.
 *
 *  So: identical · identical-apart-from-the-marker · DIFFERS. The middle one is
 *  reported by name, never folded into the first. */
const unstamp = (s) => s.replace(/<!-- @broberg\/mail-core shell v\d+ -->/, "<!-- SHELL -->");

console.log(`\n  published ${publishedVersion}  vs  local dist, accent ${TEAL}\n`);
let drifted = 0, markerOnly = 0;
for (const key of Object.keys(before)) {
  const same = before[key] === after[key];
  const sameApartFromMarker = !same && unstamp(before[key]) === unstamp(after[key]);
  if (sameApartFromMarker) markerOnly++;
  else if (!same) drifted++;
  console.log(
    `    ${key.padEnd(13)} ${same ? "identical" : sameApartFromMarker ? "identical apart from the shell-version marker" : "DIFFERS"}` +
    `  (${before[key].length} → ${after[key].length} bytes)`,
  );
  if (!same && !sameApartFromMarker) {
    // Name the first differing offset. "They differ" is not actionable; the
    // byte is.
    let i = 0;
    while (i < before[key].length && before[key][i] === after[key][i]) i++;
    console.log(`      first difference at ${i}:`);
    console.log(`        was: …${before[key].slice(Math.max(0, i - 40), i + 40)}…`);
    console.log(`        now: …${after[key].slice(Math.max(0, i - 40), i + 40)}…`);
  }
}

// A run that rendered NOTHING would print no DIFFERS lines and exit 0 — the
// green that never looked. Assert the sample space instead.
if (Object.keys(before).length < 7) {
  console.log(`\n  ✗ only ${Object.keys(before).length} cases rendered; expected 7. Nothing above is evidence.`);
  process.exit(2);
}

const total = Object.keys(before).length;
console.log(
  drifted
    ? `\n  ✗ ${drifted} of ${total} shapes CHANGED for an already-legible brand.\n`
    : `\n  ✓ ${total} shapes unchanged for an already-legible brand (${publishedVersion} → local)` +
      (markerOnly ? `\n    — ${markerOnly} of them differ ONLY by the shell-version marker, which moved on purpose.\n` : `.\n`),
);
process.exit(drifted ? 1 : 0);
