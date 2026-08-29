// F080.3 — tests for the VERDICT in check-internal-pins.mjs.
//
// The gate had no test at all, which is how it shipped a message that sent a
// reader to the wrong place for eleven pushes. satisfiesLatest is pure, so the
// only thing standing between it and a proof was that importing the file used
// to run the whole npm sweep. It no longer does.
//
//   node scripts/test-internal-pins.mjs
import { satisfiesLatest } from "./check-internal-pins.mjs";

let failed = 0;
const eq = (range, latest, want, why) => {
  const got = satisfiesLatest(range, latest);
  if (got === want) return;
  failed++;
  console.error(`✗ satisfiesLatest(${JSON.stringify(range)}, ${JSON.stringify(latest)})\n    want ${want}\n    got  ${got}\n    ${why}`);
};

// --- THE CARD'S OWN CASE: a bare exact version is decidable, not unknown -----
eq("0.1.1", "0.1.1", "ok", "an exact pin that IS latest is fine today");
eq("0.1.1", "0.1.2", "stale", "an exact pin can never resolve anything else — that is the whole point of it");
eq("0.1.1", "0.2.0", "stale", "a minor moved and the pin cannot follow");
eq("1.0.0", "1.0.0", "ok", "same, on a 1.x package");

// --- AND THE CONSERVATISM IS KEPT where it earns its keep --------------------
// A verdict this function genuinely cannot compute must still refuse. Widening
// the exact case must not widen these; that is the direction the fix could have
// gone wrong in, so it is asserted rather than assumed.
eq("1.x || 2.x", "1.5.0", "unknown", "an or-expression is not something this regex reads");
eq("*", "9.9.9", "unknown", "a wildcard says nothing this gate can check");
eq("workspace:^", "0.1.1", "unknown", "a protocol range is not a version range");
eq("", "0.1.1", "unknown", "an empty range parses to nothing");

// --- THE ORIGINAL TRAP (F061.2) still fires ---------------------------------
eq("^0.1.8", "0.5.1", "stale", "a caret on 0.x LOCKS THE MINOR — this is the defect the gate was built for");
eq("^0.1.8", "0.1.9", "ok", "within the same 0.x minor a caret does move");
eq("^1.2.0", "1.9.0", "ok", "on 1.x a caret does track the minor");
eq("^1.2.0", "2.0.0", "stale", "and stops at the major");
eq("~1.2.3", "1.2.9", "ok", "a tilde tracks the patch");
eq("~1.2.3", "1.3.0", "stale", "and stops at the minor");

// --- >= COMPARES THE PATCH TOO ----------------------------------------------
// Found while writing these: the >= branch compared major and minor only, so a
// floor NOBODY CAN MEET read as "ok". `>=0.1.1` against a registry whose newest
// is 0.1.0 is not merely stale — the package is uninstallable — and the gate
// said fine. Exactly the shape this card is about: a success-shaped non-answer.
eq(">=0.1.1", "0.2.0", "ok", "a floor the registry clears");
eq(">=0.1.1", "0.1.1", "ok", "a floor the registry meets exactly");
eq(">=0.1.1", "0.1.0", "stale", "a floor the registry CANNOT meet — npm has nothing to install");
eq(">=1.0.0", "0.9.9", "stale", "same across a major");
eq(">0.1.1", "0.1.1", "stale", "a STRICT floor is not met by equality — > and >= are different questions");
eq(">0.1.1", "0.1.2", "ok", "and is met by the next patch");

if (failed) {
  console.error(`\n${failed} assertion(s) failed.`);
  process.exit(1);
}
console.log("✓ satisfiesLatest: 22 verdicts correct (exact · unknown-stays-unknown · caret-0.x trap · >= floor)");
