// F061.2 — a caret on a 0.x version locks the MINOR, so `^0.1.8` can never
// resolve 0.2.0, let alone 0.5.1. Every @broberg/* package is 0.x, which means
// an internal dependency never updates by itself. Ever.
//
// That is not a tidiness problem. @broberg/logger promised it "cannot leak a
// secret" while shipping @broberg/secret-scan 0.1.8, four minors behind, through
// which a Stripe webhook secret walked untouched. Nothing caught it: the roster
// said logger was current (it was — the stale version is INSIDE it), its tests
// passed against the installed 0.1.8, and the consumer got a transitive
// dependency they never chose and could not see.
//
// So this gate asks npm what latest actually is, for every @broberg → @broberg
// edge in the workspace.
//
//   node scripts/check-internal-pins.mjs
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const PKGS = new URL("../packages/", import.meta.url);

/** Every @broberg → @broberg edge, across deps and peerDeps. */
function edges() {
  const out = [];
  for (const dir of readdirSync(PKGS, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(new URL(`${dir.name}/package.json`, PKGS), "utf8"));
    } catch {
      continue;
    }
    // devDependencies are in scope too. They ship nothing, so the transitive
    // harm above does not apply — but a CONFORMANCE TEST pinned by a caret
    // proves our types match 0.3.x while consumers install 0.7.x, which is a
    // test that stays green for the wrong reason. @broberg/chat's apikey +
    // forms-turnstile edges (F079.5) are the first of these in the workspace.
    for (const field of ["dependencies", "peerDependencies", "devDependencies"]) {
      for (const [name, range] of Object.entries(pkg[field] ?? {})) {
        if (name.startsWith("@broberg/")) out.push({ from: pkg.name, to: name, range, field });
      }
    }
  }
  return out;
}

function latestOnNpm(name) {
  try {
    return execFileSync("npm", ["view", name, "version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null; // could not ASK — a different fact from "the pin is fine"
  }
}

/**
 * Can this range ever resolve this version?
 *
 * Only the cases that actually occur here, and deliberately conservative: an
 * expression this gate cannot reason about is reported as UNKNOWN rather than
 * waved through. A pin-checker that silently approves what it does not
 * understand is the thing it exists to prevent.
 */
export function satisfiesLatest(range, latest) {
  const [lMajor, lMinor, lPatch] = latest.split(".").map(Number);
  const m = /^([\^~>]=?)?\s*(\d+)\.(\d+)\.(\d+)/.exec(range.trim());
  if (!m) return "unknown";
  const [, op = "", majS, minS, patS] = m;
  const major = Number(majS);
  const minor = Number(minS);
  const patch = Number(patS);

  /** -1 / 0 / 1 comparing latest against the range's own version. */
  const cmp =
    lMajor !== major ? Math.sign(lMajor - major) : lMinor !== minor ? Math.sign(lMinor - minor) : Math.sign(lPatch - patch);

  // THE PATCH USED TO BE IGNORED HERE, and that is not a rounding error: a floor
  // NOBODY CAN MEET read as "ok". `>=0.1.1` against a registry whose newest is
  // 0.1.0 does not mean the pin is behind — it means the package is
  // UNINSTALLABLE — and the gate called it fine. A success-shaped non-answer,
  // found by writing this function's first test (F080.3).
  if (op === ">=") return cmp >= 0 ? "ok" : "stale";
  if (op === ">") return cmp > 0 ? "ok" : "stale";
  if (op === "^") {
    // THE TRAP: on 0.x a caret locks the minor, not the major.
    if (major === 0) return lMajor === 0 && lMinor === minor ? "ok" : "stale";
    return lMajor === major ? "ok" : "stale";
  }
  if (op === "~") return lMajor === major && lMinor === minor ? "ok" : "stale";
  // A BARE EXACT VERSION IS THE MOST DECIDABLE RANGE THERE IS, and this used to
  // be the one it refused. `"0.1.1"` can only ever resolve 0.1.1, so the verdict
  // is arithmetic, not judgement.
  //
  // The old "unknown" was not merely imprecise, it was MISLEADING: it told the
  // reader THE GATE IS CONFUSED when the true finding was THE PIN IS THE WRONG
  // SHAPE. Measured 2026-08-29 — @broberg/notifications pinned ui-controls-core
  // at "0.1.1", the run went red with «cannot reason about that range», and
  // eleven pushes went past it because the message read as a gate problem.
  //
  // The conservatism above is kept exactly where it earns its keep: anything
  // this regex cannot parse at all (`1.x || 2.x`, a git url, `*`) still returns
  // "unknown" rather than being waved through.
  if (op === "") return cmp === 0 ? "ok" : "stale";
  return "unknown";
}

// Exported above so the pure verdict can be TESTED without this file's npm
// calls. Everything below only runs when the script is invoked directly —
// importing it must stay side-effect-free, or the test would hit the registry.
function main() {
  const rows = edges();
  if (!rows.length) {
    console.log("✓ no @broberg → @broberg dependencies to check");
    process.exit(0);
  }

  const stale = [];
  const unknown = [];
  const unreachable = [];

  for (const e of rows) {
    const latest = latestOnNpm(e.to);
    if (!latest) {
      unreachable.push(e);
      continue;
    }
    const verdict = satisfiesLatest(e.range, latest);
    if (verdict === "stale") stale.push({ ...e, latest });
    else if (verdict === "unknown") unknown.push({ ...e, latest });
  }

  // THREE STATES, NOT TWO. "npm could not answer" must never read as a clean bill
  // of health — that is this card's own defect one level up, and it is the whole
  // reason the counts are printed rather than just a tick.
  if (unreachable.length) {
    console.error(
      `✗ could not ASK npm about ${unreachable.length} package(s): ` +
        unreachable.map((e) => e.to).join(", ") +
        "\n  This did NOT verify the pins — it means the check could not look. Offline, or npm is down.",
    );
    process.exit(1);
  }

  for (const e of unknown) {
    console.error(`? ${e.from} → ${e.to} "${e.range}" — this gate cannot reason about that range (npm latest ${e.latest}). Refusing to call it fine.`);
  }

  if (stale.length || unknown.length) {
    for (const e of stale) {
      console.error(
        `✗ ${e.from} → ${e.to} is pinned "${e.range}", which can NEVER resolve npm latest ${e.latest}.` +
          (e.range.startsWith("^0.") ? "  (a caret on 0.x locks the MINOR)" : ""),
      );
    }
    console.error("\nA consumer installing the outer package gets the pinned version, not the current one.");
    process.exit(1);
  }

  console.log(`✓ all ${rows.length} internal @broberg pin(s) can resolve npm latest`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
