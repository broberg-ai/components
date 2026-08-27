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
    for (const field of ["dependencies", "peerDependencies"]) {
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
function satisfiesLatest(range, latest) {
  const [lMajor, lMinor] = latest.split(".").map(Number);
  const m = /^([\^~>]=?)?\s*(\d+)\.(\d+)\.(\d+)/.exec(range.trim());
  if (!m) return "unknown";
  const [, op = "", majS, minS] = m;
  const major = Number(majS);
  const minor = Number(minS);

  if (op === ">=" || op === ">") return lMajor > major || (lMajor === major && lMinor >= minor) ? "ok" : "stale";
  if (op === "^") {
    // THE TRAP: on 0.x a caret locks the minor, not the major.
    if (major === 0) return lMajor === 0 && lMinor === minor ? "ok" : "stale";
    return lMajor === major ? "ok" : "stale";
  }
  if (op === "~") return lMajor === major && lMinor === minor ? "ok" : "stale";
  return "unknown";
}

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
