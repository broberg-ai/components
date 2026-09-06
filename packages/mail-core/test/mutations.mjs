#!/usr/bin/env node
// F023.13 — mutation pass for the contrast derivation.
//
//   node test/mutations.mjs
//
// THE ONE THING IT HAS TO PROVE, and it is the AC rather than a nicety:
// replacing the derivation with a constant #ffffff must redden a DIFFERENT
// named test than replacing it with a constant dark. A suite where one mutation
// kills everything cannot tell the two failure directions apart — and both
// directions are real: white is illegal on gold, dark is illegal on teal.
//
// Uses the fleet's mutation marker (F081.1): the source is edited ON DISK for a
// few seconds per mutation, so a reader who opens `git diff` mid-run must not
// see a defect that is not there, and a restore that FAILED must not look like
// a restore that was not needed.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeMarker, clearMarker, assertRestored } from "../../../scripts/mutation-marker.mjs";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(PKG, "src", "index.ts");
const HARNESS = "@broberg/mail-core test/mutations.mjs";
const original = readFileSync(SRC, "utf8");

const MUTATIONS = [
  {
    name: "the cta label is a constant #ffffff again (the shipped defect)",
    find: `  const ink = readableInk(opts.accentColor);`,
    replace: `  const ink = "#ffffff";`,
    expectRed: ["a light brand gets a dark label"],
    expectGreen: ["a dark brand keeps the white label"],
  },
  {
    name: "the cta label is a constant dark — the MIRROR defect",
    find: `  const ink = readableInk(opts.accentColor);`,
    replace: `  const ink = "#1a1a1a";`,
    // A DIFFERENT test dies. That is what makes the pair meaningful: neither
    // constant is safe, and the suite can say which one broke.
    expectRed: ["a dark brand keeps the white label"],
    expectGreen: ["a light brand gets a dark label"],
  },
  {
    name: "readableInk picks by BT.601 brightness instead of contrast",
    find: `  return dark > light ? "#1a1a1a" : "#ffffff";`,
    replace: `  return isDark(surface) ? "#ffffff" : "#1a1a1a";`,
    // #808080: brightness says light -> white at 3.95, contrast prefers dark at
    // 4.41. The boundary case is the whole reason we did not reuse isDark.
    expectRed: ["relative luminance, NOT the BT.601"],
  },
  {
    name: "readableAccent measures against WHITE instead of the real surface",
    find: `export function readableAccent(accent: string, surface: string): string {
  const current = contrastRatio(accent, surface);`,
    replace: `export function readableAccent(accent: string, surface: string): string {
  const current = contrastRatio(accent, "#ffffff");`,
    // cms's round-costing detail, as a mutation: #767676 clears AA on white and
    // fails on #f4f4f5, so a white stand-in ships an illegible footer link.
    expectRed: ["clears AA on WHITE but not on #f4f4f5"],
  },
  {
    name: "readableAccent always darkens, even on a dark background",
    find: `  const goDarker = relativeLuminance(...surf) > 0.5;`,
    replace: `  const goDarker = true;`,
    expectRed: ["a DARK footer backdrop lightens"],
  },
  {
    name: "the 4.5 floor is removed, so a legible brand is adjusted anyway",
    find: `  if (current >= 4.5) return accent;        // already legible: DO NOT TOUCH`,
    replace: `  if (false) return accent;`,
    // This is the byte-identity guarantee. Without the early return every
    // existing consumer's mail changes colour on upgrade.
    expectRed: ["a dark brand is returned UNCHANGED", "readableAccent is a NO-OP above the floor"],
  },
  {
    name: "an unparseable colour is half-adjusted instead of left alone",
    find: `  if (current === null) return accent;      // not a hex we parse — leave it alone`,
    replace: `  if (current === null) return "#1a1a1a";`,
    expectRed: ["left ALONE rather than half-adjusted"],
  },
  {
    name: "the derivation drops a channel, so the brand loses its hue",
    find: `      ? [rgb[0] * (1 - t), rgb[1] * (1 - t), rgb[2] * (1 - t)]`,
    replace: `      ? [rgb[0] * (1 - t), rgb[1] * (1 - t), rgb[2]]`,
    // A contrast-only assertion would stay green here: the colour IS legible,
    // it is just no longer the brand. That is why the hue test exists.
    expectRed: ["keeps the brand's hue"],
  },
  {
    name: "the top bar uses the derived colour, so the brand surface is lost",
    find: `        <tr><td bgcolor="\${accentColor}" style="background:\${accentColor};height:4px;line-height:4px;font-size:0;">&nbsp;</td></tr>`,
    replace: `        <tr><td bgcolor="\${readableAccent(accentColor, cardBg)}" style="background:\${readableAccent(accentColor, cardBg)};height:4px;line-height:4px;font-size:0;">&nbsp;</td></tr>`,
    expectRed: ["the top bar keeps the RAW brand colour"],
  },
  {
    name: "the cta background is darkened too — cms's workaround, in the package",
    find: `      <td bgcolor="\${opts.accentColor}" style="background:\${opts.accentColor};border-radius:999px;">`,
    replace: `      <td bgcolor="\${readableAccent(opts.accentColor, "#fffffe")}" style="background:\${readableAccent(opts.accentColor, "#fffffe")};border-radius:999px;">`,
    // The exact thing this card exists to make unnecessary: legible, and no
    // longer WebHouse gold.
    expectRed: ["still EXACTLY the brand colour"],
  },
];

function runSuite() {
  let out;
  try {
    out = execFileSync("npx", ["vitest", "run", "--reporter=verbose"], {
      cwd: PKG, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    out = String(e.stdout ?? "") + String(e.stderr ?? "");
  }
  return out.split("\n").filter((l) => /^\s*×/.test(l)).map((l) => l.trim().replace(/^×\s*/, ""));
}

writeMarker({ harness: HARNESS, file: SRC });
let failures = 0;
try {
  const baseline = runSuite();
  if (baseline.length) {
    console.log(`✗ the suite is RED before any mutation — nothing below means anything:\n  ${baseline.join("\n  ")}`);
    process.exit(1);
  }
  console.log("baseline: all green\n");

  for (const m of MUTATIONS) {
    const hits = original.split(m.find).length - 1;
    if (hits !== 1) {
      console.log(`  ✗ ${m.name}\n      ANCHOR matched ${hits} times, expected 1 — the mutation did not apply,`);
      console.log(`      which is indistinguishable from a surviving mutant unless asserted.`);
      failures++;
      continue;
    }

    writeFileSync(SRC, original.replace(m.find, m.replace));
    let red;
    try {
      red = runSuite();
    } finally {
      writeFileSync(SRC, original);
      assertRestored({ harness: HARNESS, file: SRC, expected: original });
    }

    const missingRed = (m.expectRed ?? []).filter((n) => !red.some((r) => r.includes(n)));
    const wrongGreen = (m.expectGreen ?? []).filter((n) => red.some((r) => r.includes(n)));

    if (!red.length) {
      console.log(`  ✗ ${m.name}\n      SURVIVED — no test noticed.`);
      failures++;
    } else if (missingRed.length || wrongGreen.length) {
      console.log(`  ✗ ${m.name}`);
      if (missingRed.length) console.log(`      expected RED and were not: ${missingRed.join(" · ")}`);
      if (wrongGreen.length) console.log(`      expected GREEN and went red: ${wrongGreen.join(" · ")}`);
      console.log(`      actually red (${red.length}): ${red.slice(0, 4).map((r) => r.slice(0, 60)).join(" · ")}`);
      failures++;
    } else {
      console.log(`  ✓ ${m.name}`);
      console.log(`      killed by ${red.length}: ${red.slice(0, 2).map((r) => r.split(" > ").pop().slice(0, 58)).join(" · ")}`);
    }
  }
} finally {
  writeFileSync(SRC, original);
  assertRestored({ harness: HARNESS, file: SRC, expected: original });
  clearMarker();
}

console.log(failures ? `\n${failures} mutation(s) unproven\n` : `\n${MUTATIONS.length} mutations, all killed\n`);
process.exit(failures ? 1 : 0);
