#!/usr/bin/env node
// F102.1 — mutation pass for @broberg/seal.
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
// The two mutations must produce DIFFERENT red sets. If they matched, one test
// would be carrying both claims and neither would be pinned on its own.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// F081.1 — announce the mutated tree, and PROVE the restore took.
import { writeMarker, clearMarker, assertRestored } from "../../../scripts/mutation-marker.mjs";

const REPO = execFileSync("git", ["rev-parse", "--show-toplevel"]).toString().trim();
const PKG = join(REPO, "packages", "seal");
const SRC = join(PKG, "src", "index.ts");
const original = readFileSync(SRC, "utf8");

const MUTATIONS = [
  {
    // F102.2 — the scope is ignored: tenant A's values are wrapped with the same key as tenant B's.
    name: "the scope is ignored (every tenant shares one key)",
    find: "    if (!keks.has(v)) keks.set(v, scope === undefined ? aesKey(bytes) : scopedKey(bytes, scope));",
    replace: "    if (!keks.has(v)) keks.set(v, aesKey(bytes));",
    expect: ["the KEY itself differs per scope"],
  },
  {
    // F102.2 — the bytes path loses its context binding: a file copied to another row opens there.
    name: "openBytes does not check the aad",
    find: "      return decrypt(await aesKey(dek), p.iv, p.data, payloadAad(o.aad));\n    },\n  };",
    replace: "      return decrypt(await aesKey(dek), p.iv, p.data, payloadAad(o.aad)).catch(() => new Uint8Array(0));\n    },\n  };",
    expect: ["the wrong aad and one flipped byte"],
  },
  {
    name: "the context is not bound (aad dropped from the payload)",
    find: "const payloadAad = (aad: string) => `${PREFIX}|${aad}`;",
    replace: "const payloadAad = (_aad: string) => `${PREFIX}|`;",
    expect: ["the wrong aad", "add key 2 as current"],
  },
  {
    name: "one data key for every value (no fresh DEK)",
    find: "    const dek = random(KEY_BYTES);\n    const iv = random(IV_BYTES);",
    replace: "    const dek = new Uint8Array(KEY_BYTES);\n    const iv = random(IV_BYTES);",
    expect: ["its OWN random data key"],
  },
  {
    name: "a key of any length is accepted",
    find: "    if (bytes.length !== KEY_BYTES) throw new SealError",
    replace: "    if (false) throw new SealError",
    expect: ["named errors"],
  },
  {
    name: "needsRewrap always false",
    find: "      return parse(sealed).version !== config.current;",
    replace: "      return false;",
    expect: ["needsRewrap: true for a value"],
  },
  {
    name: "rewrap re-encrypts the DEK under the OLD version",
    find: "      const v = config.current;\n      const wrapIv = random(IV_BYTES);\n      return join(",
    replace: "      const v = p.version;\n      const wrapIv = random(IV_BYTES);\n      return join(",
    expect: ["add key 2 as current"],
  },
  {
    name: "keysFromEnv accepts anything",
    find: "    if (!m) throw new SealError(\"bad_key\", \"a key-ring entry is not <version>:<base64>\");",
    replace: "    if (!m) continue;",
    expect: ["keysFromEnv parses a ring"],
  },
];

const backup = mkdtempSync(join(tmpdir(), "sealmut-"));
const safe = join(backup, "index.ts");
copyFileSync(SRC, safe);

let uncaught = 0;
const redSets = [];

// BEFORE the first mutation. Written after it, the marker would leave open the
// exact window it exists to close.
writeMarker({ harness: "@broberg/seal test/mutations.mjs", file: SRC });
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
  assertRestored({ harness: "@broberg/seal test/mutations.mjs", file: SRC, expected: original });
  rmSync(backup, { recursive: true, force: true });
  clearMarker();
}

const identical = redSets.length !== new Set(redSets).size;
if (identical) console.log("\nWARNING: two mutations produced IDENTICAL red sets — one test may be carrying both");
console.log(`\n${MUTATIONS.length} mutations, ${uncaught} uncaught, ${identical ? 1 : 0} identical red sets`);
process.exit(uncaught === 0 && !identical ? 0 : 1);
