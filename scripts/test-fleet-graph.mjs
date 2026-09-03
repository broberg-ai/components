#!/usr/bin/env node
// F083.2 — the merge, and the staleness banner that stops this defect recurring.
//   node scripts/test-fleet-graph.mjs
import { fleetRows, consumersOf, scanAge, STALE_AFTER_HOURS, REPO_SESSION } from "./fleet-graph.mjs";
import { FLEET } from "./inventory-data.mjs";

let failures = 0;
const check = (n, f) => { try { f(); console.log(`  ✓ ${n}`); } catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); failures++; } };
const eq = (a, b, w) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${w}\n  expected: ${JSON.stringify(b)}\n  actual:   ${JSON.stringify(a)}`); };

const scanOf = (repos, scanned_at = new Date().toISOString()) => ({ scanned_at, repos });
const depsOf = (...names) => Object.fromEntries(names.map((n) => [n, [{ range: "1.0.0", field: "dependencies", at: "package.json" }]]));

console.log("fleet-graph");

check("a repo the hand-written roster never mentioned still gets a row", () => {
  const scan = scanOf({ "broberg-ai/contentpush": { manifests: 2, unreadable: 0, deps: depsOf("@broberg/ai-sdk", "@broberg/cron") } });
  const rows = fleetRows(scan);
  const cp = rows.find((r) => r.s === "contentpush");
  if (!cp) throw new Error("contentpush missing — it has 10 real deps and no roster row; that is the whole defect");
  eq(cp.uses, ["ai-sdk", "cron"], "its real dependencies");
});

check("hand-written role text and `pub` SURVIVE a changed dependency list", () => {
  const hand = FLEET.find((f) => f.s === "cardmem");
  const scan = scanOf({ "broberg-ai/cardmem": { manifests: 13, unreadable: 0, deps: depsOf("@broberg/auth", "@broberg/lens") } });
  const row = fleetRows(scan).find((r) => r.s === "cardmem");
  eq(row.r, hand.r, "role text kept");
  eq(row.uses, ["auth", "lens"], "uses replaced by the scan");
  // pub gates a session's reuse gap in server.ts — deriving it from dependencies
  // would tell a publisher to adopt its own package.
  eq(row.pub, hand.pub ?? [], "pub kept");
});

check("a hand-written row whose repo was NOT scanned is kept, not silently dropped", () => {
  const rows = fleetRows(scanOf({}));
  eq(rows.length, FLEET.length, "every hand-written row survives an empty scan");
  if (!rows.every((r) => r.unscanned)) throw new Error("and each is marked as unscanned rather than as having no deps");
});

check("a FAILED repo contributes no row — an error is not an empty result", () => {
  const scan = scanOf({ "o/broken": { error: "HTTP 404" }, "broberg-ai/contentpush": { manifests: 1, unreadable: 0, deps: depsOf("@broberg/mail") } });
  const rows = fleetRows(scan);
  if (rows.some((r) => r.repo === "o/broken")) throw new Error("a failed repo must not render as a row with zero uses");
  if (!rows.some((r) => r.s === "contentpush")) throw new Error("the healthy repo still renders");
});

check("an UNMAPPED repo renders under its repo name rather than vanishing", () => {
  const scan = scanOf({ "someone/brand-new": { manifests: 1, unreadable: 0, deps: depsOf("@broberg/mail") } });
  const row = fleetRows(scan).find((r) => r.repo === "someone/brand-new");
  if (!row) throw new Error("dropping an unmapped repo would read as 'no dependencies'");
  eq(row.s, "someone/brand-new", "named by its repo until someone maps it");
});

check("consumersOf answers the question the roster is actually asked", () => {
  const scan = scanOf({
    "broberg-ai/cardmem": { manifests: 1, unreadable: 0, deps: depsOf("@broberg/ai-sdk") },
    "cbroberg/moovyy": { manifests: 1, unreadable: 0, deps: depsOf("@broberg/ai-sdk", "@broberg/mail") },
    "broberg-ai/trail": { manifests: 1, unreadable: 0, deps: depsOf("@broberg/mail") },
  });
  eq(consumersOf(scan, "@broberg/ai-sdk"), ["cardmem", "moovyy"], "by session name");
  eq(consumersOf(scan, "@broberg/nobody"), [], "and an honest empty answer");
});

check("STALENESS: a fresh scan is not stale, an old one IS — both directions", () => {
  const now = Date.parse("2026-09-03T12:00:00Z");
  const fresh = scanAge({ scanned_at: "2026-09-03T06:00:00Z" }, now);
  if (fresh.stale) throw new Error("6 hours old must not be stale");
  const old = scanAge({ scanned_at: "2026-09-01T06:00:00Z" }, now);
  if (!old.stale) throw new Error(`54 hours old must be stale (threshold ${STALE_AFTER_HOURS}h)`);
});

check("a MISSING timestamp is stale, not fresh — the direction that matters", () => {
  // An absent date must never read as "just scanned". If the job dies and the
  // field is dropped, the page has to say so rather than look current.
  if (!scanAge({}).stale) throw new Error("no timestamp must be treated as stale");
  if (!scanAge({ scanned_at: "not a date" }).stale) throw new Error("an unparseable timestamp too");
});

check("every mapped repo name is unique — two repos sharing a session would silently merge", () => {
  const names = Object.values(REPO_SESSION);
  eq(names.length, new Set(names).size, "no duplicate session names in the mapping");
});

console.log(failures ? `\n${failures} FAILED` : "\nall green");
process.exit(failures ? 1 : 0);
