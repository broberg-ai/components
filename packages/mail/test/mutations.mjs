#!/usr/bin/env node
// F005.11 - mutation pass for the status primitive.
//
// Two properties: no mutation may go UNCAUGHT, and no two may produce the SAME
// red set - a mutation that reddens everything proves the suite runs, not that
// it discriminates.
//
// Carried over from @broberg/secret-scan's harness, including the three things
// a naive one gets wrong:
//   - it REFUSES to run on an uncommitted source file. `finally` does not run
//     on a kill, and a killed run leaves the source mutated, which reads exactly
//     like working source.
//   - it asserts every mutation's ANCHOR applied. A substitution that silently
//     matched nothing reads exactly like a surviving mutant.
//   - it STRIPS ANSI before parsing the failing lines. Under CI vitest keeps
//     colour on, so an anchored /^\s*x/ matches nothing and a caught mutation
//     is reported as uncaught - a harness that cannot read the red it caused.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
// F081.1 — announce the mutated tree, and PROVE the restore took.
import { writeMarker, clearMarker, assertRestored } from "../../../scripts/mutation-marker.mjs";
import { fileURLToPath } from "node:url";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILES = {
  index: join(PKG, "src", "index.ts"),
  events: join(PKG, "src", "events.ts"),
};

// A mutant left on disk by a killed run is indistinguishable from real source.
for (const [name, file] of Object.entries(FILES)) {
  const dirty = execFileSync("git", ["status", "--porcelain", "--", file], { cwd: PKG })
    .toString()
    .trim();
  if (dirty) {
    console.error(
      `refusing to mutate an uncommitted file (src/${name}.ts).\n` +
        `  Commit first: a killed run skips the restore, and mutated source then\n` +
        `  reads exactly like working source.`,
    );
    process.exit(1);
  }
}

const MUTATIONS = [
  {
    // F005.13 — the defect, restored: an event outside the vocabulary returns
    // undefined while the signature promises a MailVerdict.
    name: "the off-vocabulary fall-through is dropped (undefined for a new event)",
    file: "events",
    from: "  return Object.prototype.hasOwnProperty.call(VERDICT, event as string)\n    ? VERDICT[event as MailEventType]\n    : 'unknown';",
    to: "  return VERDICT[event as MailEventType];",
    expect: ["answers \"unknown\", never undefined"],
  },
  {
    // ...and the OTHER direction, which looks like a fix and is not: answer
    // 'unknown' for everything. Every off-vocabulary test still passes.
    name: "everything answers unknown (the fix that stops discriminating)",
    file: "events",
    from: "  return Object.prototype.hasOwnProperty.call(VERDICT, event as string)\n    ? VERDICT[event as MailEventType]\n    : 'unknown';",
    to: "  return 'unknown';",
    expect: ["every documented event still maps exactly as it did", "NEGATIVE CONTROL"],
  },
  {
    // The own-property check removed: an object literal inherits
    // Object.prototype, so verdictForEvent('toString') hands back a FUNCTION.
    name: "the own-property check is dropped (an inherited member is returned)",
    file: "events",
    from: "  return Object.prototype.hasOwnProperty.call(VERDICT, event as string)\n    ? VERDICT[event as MailEventType]\n    : 'unknown';",
    to: "  return (VERDICT[event as MailEventType] ?? 'unknown') as MailVerdict;",
    expect: ["not a function, not an object"],
  },
  {
    // THE DEFECT THIS STORY EXISTS TO PREVENT. If "we could not look" renders as
    // "it failed", a consumer writes to a customer to say their address is wrong
    // when the real problem is our own API key.
    name: "unknown collapses into failed (a 401 reads as a bounce)",
    file: "index",
    from: `      ? { verdict: "unknown", reason }`,
    to: `      ? { verdict: "failed", reason }`,
    expect: ["could-not-look is never reported as failure"],
  },
  {
    // The privacy guard. The provider returns the entire message body on this
    // endpoint, and a status object is the first thing a consumer logs.
    name: "the body is returned whether or not the caller asked",
    file: "index",
    from: `      if (options?.includeBody) {`,
    to: `      if (true) {`,
    expect: ["is absent by default, even though the provider sent it"],
  },
  {
    // The mapping nobody gets right by intuition, in the direction that hurts.
    name: "complained is filed under failure (it ARRIVED)",
    file: "events",
    // Anchor updated with F005.13: the switch became a Record, so the same
    // decision now lives on one line. The decision is unchanged — a complaint
    // means the mail ARRIVED and the reader disliked it.
    from: "  complained: 'delivered',",
    to: "  complained: 'failed',",
    expect: ["complained is DELIVERED"],
  },
  {
    // One of the four events that used to be dropped, taken back out.
    name: "email.suppressed is dropped again (a non-delivery goes silent)",
    file: "events",
    from: `  'suppressed',\n];`,
    to: `];`,
    expect: ["email.suppressed"],
  },
];

const backup = mkdtempSync(join(tmpdir(), "mailmut-"));
const originals = {};
for (const [name, file] of Object.entries(FILES)) {
  originals[name] = readFileSync(file, "utf8");
  copyFileSync(file, join(backup, `${name}.ts`));
}

// Built from a char code so no literal escape byte lives in this file.
const ANSI = new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g");

let uncaught = 0;
const redSets = [];

// BEFORE the first mutation. Written after it, the marker would leave open the
// exact window it exists to close. The file named is the first of the several
// this harness rotates through; it is updated per mutation below.
writeMarker({ harness: "@broberg/mail test/mutations.mjs", file: Object.values(FILES)[0] });
try {
  for (const m of MUTATIONS) {
    const file = FILES[m.file];
    const original = originals[m.file];
    if (!original.includes(m.from)) {
      console.log(`ANCHOR MISSING - ${m.name}`);
      console.log("  the substitution matched nothing, so this mutation was never applied");
      uncaught++;
      continue;
    }
    const mutated = original.replace(m.from, m.to);
    if (mutated === original) {
      console.log(`ANCHOR NO-OP - ${m.name}`);
      uncaught++;
      continue;
    }

    // This harness rotates across several files, so the marker has to name the
    // one that is broken RIGHT NOW — a reader who opens it wants that file, not
    // the first one the run happened to touch.
    writeMarker({ harness: "@broberg/mail test/mutations.mjs", file });
    writeFileSync(file, mutated);
    let out = "";
    let died = false;
    try {
      execFileSync("pnpm", ["exec", "vitest", "run"], { cwd: PKG, stdio: "pipe" });
    } catch (e) {
      out = (e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? "");
      died = true;
    } finally {
      writeFileSync(file, original);
      // The guard. A restore that FAILED is otherwise indistinguishable from one
      // that was not needed — which is how buddy's harness lost a file on
      // 2026-08-14 with a green run to show for it. Does not return on mismatch.
      assertRestored({ harness: "@broberg/mail test/mutations.mjs", file, expected: original });
    }

    if (!died) {
      console.log(`UNCAUGHT - ${m.name}`);
      console.log("  the suite stayed GREEN with this mutation applied");
      uncaught++;
      continue;
    }

    const clean = out.replace(ANSI, "");
    const red = [
      ...new Set(
        clean
          .split("\n")
          .filter((l) => /^\s*(\u00d7|\u2715|FAIL)/.test(l))
          .map((l) => l.trim()),
      ),
    ];

    // "the suite died but I cannot see WHICH test" is a third state, and it must
    // not be reported as "the mutation survived". They are opposite facts.
    if (red.length === 0) {
      console.log(`UNREADABLE - ${m.name}`);
      console.log("  the suite FAILED (so the mutation WAS caught) but no failing test");
      console.log("  line could be parsed, so this harness cannot say which test caught");
      console.log("  it. That is a defect in the harness, not evidence about the code.");
      clean.split("\n").filter(Boolean).slice(-6).forEach((l) => console.log(`     ${l.trim()}`));
      uncaught++;
      redSets.push(`unreadable:${m.name}`);
      continue;
    }

    const hit = m.expect.every((e) => red.some((l) => l.includes(e)));
    redSets.push(red.join("|"));
    console.log(`  ${hit ? "caught   " : "WRONG RED"} ${m.name}  -> ${red.length} red`);
    red.slice(0, 3).forEach((l) => console.log(`               . ${l}`));
    if (!hit) {
      console.log(`     expected all of: ${m.expect.join(" . ")}`);
      uncaught++;
    }
  }
} finally {
  for (const [name, file] of Object.entries(FILES)) {
    copyFileSync(join(backup, `${name}.ts`), file);
    assertRestored({ harness: "@broberg/mail test/mutations.mjs", file, expected: originals[name] });
  }
  rmSync(backup, { recursive: true, force: true });
  clearMarker();
}

const identical = redSets.length !== new Set(redSets).size;
if (identical) {
  console.log("\nWARNING: two mutations produced IDENTICAL red sets - one test may carry both");
}
console.log(
  `\n${identical || uncaught ? "FAIL" : "OK"} - ${MUTATIONS.length} mutations, ${uncaught} uncaught, ${identical ? 1 : 0} identical red sets.`,
)
process.exit(uncaught === 0 && !identical ? 0 : 1);
