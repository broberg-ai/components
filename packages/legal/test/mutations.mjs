#!/usr/bin/env node
// F110.4 — mutation pass for @broberg/legal's translation parity and staleness.
// Same harness as packages/call/test/mutations.mjs: each mutation is applied to the
// real file, the suite is run, and the original is restored and PROVEN restored.
// Every anchor must apply, and no two mutations may produce the same red set.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeMarker, clearMarker, assertRestored } from "../../../scripts/mutation-marker.mjs";

const REPO = execFileSync("git", ["rev-parse", "--show-toplevel"]).toString().trim();
const PKG = join(REPO, "packages", "legal");
const CORE = join(PKG, "src", "core.ts");
const TERMS_EN = join(PKG, "src", "content", "terms.en.ts");
const PSEUDO = join(PKG, "src", "pseudonymise.ts");
const originals = { [CORE]: readFileSync(CORE, "utf8"), [TERMS_EN]: readFileSync(TERMS_EN, "utf8"), [PSEUDO]: readFileSync(PSEUDO, "utf8") };

const MUTATIONS = [
  {
    name: "translations are never compared with their master",
    file: CORE,
    find: "    if (t.locale === MASTER_LOCALE) continue;\n    const m = sources",
    replace: "    continue;\n    const m = sources",
    expect: ["a missing paragraph", "an extra paragraph", "a translation with no master"],
  },
  {
    name: "the length of a list is not part of parity",
    file: CORE,
    find: "`${b.id} list:${b.items.length} items`",
    replace: "`${b.id} list`",
    expect: ["a list item dropped"],
  },
  {
    name: "a translation of an older master is served as current",
    file: CORE,
    find: "src.translationOf.sourceHash !== sourceHash(master)",
    replace: "false",
    expect: ["when the Danish master moves on", "the master moved on after translation"],
  },
  {
    name: "the English terms lose a paragraph",
    file: TERMS_EN,
    find: '        { id: "accept.p3", type: "p", text: "Our privacy policy is not part of what you accept. It explains how we process your information, and on which legal basis." },\n',
    replace: "",
    expect: ["every translation mirrors its master block for block"],
  },
  {
    name: "pseudonyms ignore the key (a plain hash — guessable)",
    file: PSEUDO,
    find: 'importKey("raw", enc.encode(key),',
    replace: 'importKey("raw", enc.encode("fixed-not-the-secret-key-000000000"),',
    expect: ["same value + same key → same pseudonym; a different key → a different one"],
  },
  {
    name: "health sentences reach the analysis copy",
    file: PSEUDO,
    find: '(HEALTH.test(s) ? (replaced.health++, "[HELBRED FJERNET]") : s)',
    replace: "s",
    expect: ["a health sentence is removed; the rest stays"],
  },
  {
    name: "a first name on its own is not linked to the person seen in full",
    file: PSEUDO,
    find: "    for (const p of parts) if (p.length >= 3 && !people.has(p.toLowerCase())) people.set(p.toLowerCase(), n);\n",
    replace: "",
    expect: ["a known name is replaced consistently", "recall on the Danish corpus"],
  },
  {
    name: "unknown names are passed as clean",
    file: PSEUDO,
    find: '    if (!opts.findNames) notExamined.unshift("names-not-known");\n',
    replace: "",
    expect: ["names it was not told about are NOT silently passed"],
  },
  {
    name: "retention above 6 months is accepted",
    file: PSEUDO,
    find: "months > MAX_RETENTION_MONTHS)",
    replace: "months > 120)",
    expect: ["keepUntil is at most 6 months after collection"],
  },
];

const backup = mkdtempSync(join(tmpdir(), "legalmut-"));
for (const f of Object.keys(originals)) copyFileSync(f, join(backup, f.split("/").pop()));

let uncaught = 0;
const redSets = [];

// BEFORE the first mutation. Written after it, the marker would leave open the
// exact window it exists to close.
writeMarker({ harness: "@broberg/legal test/mutations.mjs", file: CORE });
try {
  for (const m of MUTATIONS) {
    for (const [f, text] of Object.entries(originals)) writeFileSync(f, text);
    const original = originals[m.file];
    if (!original.includes(m.find)) {
      console.log(`ANCHOR MISSING — ${m.name}\n  the substitution matched nothing, so this mutation was never applied`);
      uncaught++;
      continue;
    }
    const mutated = original.replace(m.find, m.replace);
    if (mutated === original) { console.log(`ANCHOR NO-OP — ${m.name}`); uncaught++; continue; }

    writeFileSync(m.file, mutated);
    let out = "";
    let died = false;
    try {
      execFileSync("pnpm", ["vitest", "run"], { cwd: PKG, stdio: "pipe" });
    } catch (e) {
      out = (e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? "");
      died = true;
    }
    if (!died) {
      console.log(`UNCAUGHT — ${m.name}\n  the suite stayed GREEN with this mutation applied`);
      uncaught++;
      continue;
    }
    // STRIP ANSI FIRST. Under CI vitest keeps colour on (turbo sets FORCE_COLOR),
    // so a failing line arrives as "\u001b[31m×\u001b[39m name" and an anchored
    // /^\s*×/ matches nothing. Measured: this harness reported "2 mutations, 2
    // uncaught" on CI while both mutations had in fact been killed — it could not
    // READ the red it had caused. It failed in the safe direction, which is the
    // only reason it was merely noisy rather than a false all-clear.
    const clean = out.replace(/\u001B\[[0-9;]*m/g, "");
    const red = [...new Set(
      // STRIP THE DURATION (F080.4) — vitest appends "10ms", and the
      // identical-red-set check below compares these strings, so a collision
      // hid behind a millisecond. Measured in @broberg/mail.
      clean.split("\n").filter((l) => /^\s*(×|✕|FAIL)/.test(l)).map((l) => l.trim().replace(/\s+\d+(?:\.\d+)?m?s$/, "")),
    )];

    // "the suite died but I cannot see WHICH test" is a third state, and it must
    // not be reported as "the mutation survived". They are opposite facts.
    if (red.length === 0) {
      console.log(`UNREADABLE — ${m.name}`);
      console.log(`  the suite FAILED (so the mutation was caught) but no failing test line`);
      console.log(`  could be parsed from its output, so this harness cannot say WHICH test`);
      console.log(`  caught it. That is a defect in the harness, not evidence about the code.`);
      console.log(`  last output lines:`);
      clean.split("\n").filter(Boolean).slice(-6).forEach((l) => console.log(`     ${l.trim()}`));
      uncaught++;
      redSets.push(`unreadable:${m.name}`);
      continue;
    }

    const hit = m.expect.every((e) => red.some((l) => l.includes(e)));
    redSets.push(red.join("|"));
    console.log(`${hit ? "killed" : "WRONG RED"} — ${m.name}`);
    red.slice(0, 6).forEach((l) => console.log(`     ${l}`));
    if (!hit) {
      console.log(`     expected all of: ${m.expect.join(" · ")}`);
      uncaught++;
    }
  }
} finally {
  for (const f of Object.keys(originals)) copyFileSync(join(backup, f.split("/").pop()), f);
  // The guard. A restore that FAILED is otherwise indistinguishable from one
  // that was not needed — which is how buddy's harness lost a file on
  // 2026-08-14 with a green run to show for it. Does not return on mismatch.
  for (const [f, text] of Object.entries(originals)) assertRestored({ harness: "@broberg/legal test/mutations.mjs", file: f, expected: text });
  rmSync(backup, { recursive: true, force: true });
  clearMarker();
}

const identical = redSets.length !== new Set(redSets).size;
if (identical) console.log("\nWARNING: two mutations produced IDENTICAL red sets — one test may be carrying both");
console.log(`\n${MUTATIONS.length} mutations, ${uncaught} uncaught, ${identical ? 1 : 0} identical red sets`);
process.exit(uncaught === 0 && !identical ? 0 : 1);
