#!/usr/bin/env bun
// F039.5 — owner-only session-key reset (the "ask components to reset it" flow
// the enroll 401 promises). Runs INSIDE the Fly machine over `flyctl ssh`;
// physical control of the box IS the auth, so there is deliberately NO
// network-reachable reset endpoint (that would be a TOFU-bypass surface).
//
//   flyctl ssh console -a broberg-discovery \
//     -C 'cd /app/apps/discovery && bun scripts/reset-session-key.mjs <session>'
//
// Clears ONLY the session's key binding so it can re-enroll with a fresh key.
// Its enrollments (adoptions) live in a SEPARATE table and are left intact.
// Reuses the EnrollStore methods — one source, no duplicated SQL.
import { getEnrollStore } from "../enroll.ts";

const session = process.argv[2];
if (!session) {
  console.error("usage: bun scripts/reset-session-key.mjs <session>");
  process.exit(2);
}

const store = await getEnrollStore();
if (!store) {
  console.error("enroll store not configured (no TURSO_DATABASE_URL / ENROLL_DB_URL) — cannot reset");
  process.exit(1);
}

// verify-before-delete: show the binding we're about to clear...
const bound = await store.sessionKeyHash(session);
if (!bound) {
  console.log(`no key binding for "${session}" — nothing to reset`);
  process.exit(0);
}
console.log(`BEFORE  session_keys["${session}"] = bound (sha256 ${bound.slice(0, 12)}…)`);

// ...and the enrollments that will be PRESERVED (separate table, untouched).
const enrollments = await store.bySession(session);
console.log(`enrollments (preserved, NOT touched): ${enrollments.length}`);
for (const e of enrollments) console.log(`  • ${e.pkg}@${e.version} (${e.role})`);

// reset ONLY this one session's key binding.
const removed = await store.resetSessionKey(session);
console.log(`DELETED ${removed} session_keys row(s) for "${session}"`);

// after-state: the binding is gone; the session re-binds its new key next enroll.
const after = await store.sessionKeyHash(session);
console.log(
  `AFTER   session_keys["${session}"] = ${after === null ? "cleared" : "STILL BOUND (?!)"} — ` +
    "re-binds its new key on the next POST /api/enroll",
);
