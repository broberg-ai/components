#!/usr/bin/env node
// F040.2 — mutation pass for @broberg/mail-templates.
//
// Each mutation is applied to a COPY of src/index.ts and the suite is run against
// it. The real source is never written to, so an interrupted run cannot leave a
// mutant on disk — the failure mode where a harness kills itself mid-mutation and
// the "restore" never happens.
//
// Every mutation asserts its ANCHOR applied. A substitution that silently matched
// nothing reads exactly like a surviving mutant, and that is the lie this exists
// to not tell.
//
// Mutations must produce DIFFERENT red sets. If two matched, one test would be
// carrying both claims and neither would be pinned on its own.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// F081.1 — announce the mutated tree, and PROVE the restore took.
import { writeMarker, clearMarker, assertRestored } from "../../../scripts/mutation-marker.mjs";

const REPO = execFileSync("git", ["rev-parse", "--show-toplevel"]).toString().trim();
const PKG = join(REPO, "packages", "mail-templates");
const SRC = join(PKG, "src", "index.ts");
const original = readFileSync(SRC, "utf8");

const MUTATIONS = [
  {
    name: "fill BEFORE render (the double-escape order)",
    find: '    if (b.type !== "button") return b;\n    const f = fillPlaceholdersRaw(b.url, values);',
    replace: '    if (b.type !== "button") return "text" in b ? { ...b, text: fillPlaceholders(b.text, values).text } : b;\n    const f = fillPlaceholdersRaw(b.url, values);',
    expect: ["escaped exactly once in the body"],
  },
  {
    name: "the subject is escaped like the body",
    find: "  const subject = fillPlaceholdersRaw(template.subject, values);",
    replace: "  const subject = fillPlaceholders(template.subject, values);",
    expect: ["not at all in the subject"],
  },
  {
    name: "an empty value counts as missing (truthiness instead of `in`)",
    find: "    if (!(key in values)) {\n      missing.push(key);\n      return whole;\n    }\n    const v = values[key]",
    replace: "    if (!values[key]) {\n      missing.push(key);\n      return whole;\n    }\n    const v = values[key]",
    expect: ["EMPTY value is filled as empty"],
  },
  {
    name: "a placeholder that survived filling is accepted as a url",
    find: "  if (opts?.filled && /\\{\\{\\s*[a-zA-Z0-9_.]+\\s*\\}\\}/.test(u))",
    replace: "  if (false && /\\{\\{\\s*[a-zA-Z0-9_.]+\\s*\\}\\}/.test(u))",
    expect: ["unfilled placeholder in the url"],
  },
  {
    name: "any string is a brand colour",
    find: "  if (!s || s.length > 32) return false;",
    replace: "  return true;",
    expect: ["colorAccent with an injection string"],
  },
  {
    name: "an override for an unknown purpose is dropped silently",
    find: "  const unknownOverrides = Object.keys(overrides).filter((p) => !known.has(p) && overrides[p]);",
    replace: "  const unknownOverrides: string[] = [];",
    expect: ["unknown purpose is NAMED"],
  },
  {
    name: "canonical content keeps the caller's key order",
    find: "        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))\n",
    replace: "",
    expect: ["key ORDER does not change the hash"],
  },
  {
    name: "a missing button url renders as a link anyway",
    find: "        const check = checkUrl(b.url, { filled: true });",
    replace: "        const check = { ok: true } as const;",
    expect: ["relative url renders as plain text"],
  },
  {
    name: "emphasise BEFORE escaping (F040.3)",
    find: "        out.push(withClass(opts.primitives.noteBox(emphasize(escapeHtml(b.text)), {",
    replace: "        out.push(withClass(opts.primitives.noteBox(escapeHtml(emphasize(b.text)), {",
    expect: ["note: **<script>x</script>** is escaped INSIDE"],
  },
  {
    name: "a paragraph ignores paragraphHtml (F040.3)",
    find: "        if (html !== escaped && opts.primitives.paragraphHtml) {",
    replace: "        if (false && opts.primitives.paragraphHtml) {",
    expect: ["paragraph: render **Indtil nogen bekræfter** as <strong>"],
  },
];

const backup = mkdtempSync(join(tmpdir(), "mtplmut-"));
const safe = join(backup, "index.ts");
copyFileSync(SRC, safe);

let uncaught = 0;
const redSets = [];

// BEFORE the first mutation. Written after it, the marker would leave open the
// exact window it exists to close.
writeMarker({ harness: "@broberg/mail-templates test/mutations.mjs", file: SRC });
try {
  for (const m of MUTATIONS) {
    if (!original.includes(m.find)) {
      console.log(`ANCHOR MISSING — ${m.name}\n  the substitution matched nothing, so this mutation was never applied`);
      uncaught++;
      continue;
    }
    const mutated = original.replace(m.find, m.replace);
    if (mutated === original) { console.log(`ANCHOR NO-OP — ${m.name}`); uncaught++; continue; }

    writeFileSync(SRC, mutated);
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
  copyFileSync(safe, SRC);
  // The guard. A restore that FAILED is otherwise indistinguishable from one
  // that was not needed — which is how buddy's harness lost a file on
  // 2026-08-14 with a green run to show for it. Does not return on mismatch.
  assertRestored({ harness: "@broberg/mail-templates test/mutations.mjs", file: SRC, expected: original });
  rmSync(backup, { recursive: true, force: true });
  clearMarker();
}

const identical = redSets.length !== new Set(redSets).size;
if (identical) console.log("\nWARNING: two mutations produced IDENTICAL red sets — one test may be carrying both");
console.log(`\n${MUTATIONS.length} mutations, ${uncaught} uncaught, ${identical ? 1 : 0} identical red sets`);
process.exit(uncaught === 0 && !identical ? 0 : 1);
