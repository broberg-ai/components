#!/usr/bin/env node
// F081.1 — a minimal harness, for the mutation pass only.
//
// It does exactly what a real one does to the marker (write before mutating,
// update, clear in a `finally`, read back after restoring) and nothing else. It
// exists because the mutation pass runs the gate's whole test SEVEN times, and
// the real stripe harness takes ~35 seconds a run.
//
// IT IS NOT A STAND-IN FOR AN EXTERNAL PARTY. Every mutation in the pass is in
// scripts/mutation-marker.mjs or the pre-commit hook — code this fixture calls
// exactly as the real harnesses do. The claim it supports is "the marker module
// behaves", not "the four real harnesses use it"; that second claim is asserted
// separately, and the plain test spawns a REAL harness for it.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeMarker, clearMarker, assertRestored } from "../mutation-marker.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
// argv: [holdMs, tag] — the concurrency test needs one long-running harness and
// one short one, so the durations are parameters rather than a constant.
const HOLD_MS = Number(process.argv[2] ?? 300);
const TAG = process.argv[3] ?? "";
const FILE = join(ROOT, "node_modules", `.f081-fixture-target${TAG}.ts`);
const HARNESS = `@broberg/stripe test/mutations.mjs (F081 fixture${TAG})`;

writeFileSync(FILE, "export const guard = (x) => x != null;\n");
const original = readFileSync(FILE, "utf8");

writeMarker({ harness: HARNESS, file: join(ROOT, "packages/stripe/src/fields.ts") });
try {
  writeFileSync(FILE, original.replace("x != null", "true"));
  await new Promise((r) => setTimeout(r, HOLD_MS)); // long enough for the poller to see it
  writeFileSync(FILE, original);
  assertRestored({ harness: HARNESS, file: FILE, expected: original });
} finally {
  clearMarker();
}
