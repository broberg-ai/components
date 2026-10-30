#!/usr/bin/env node
// F038.48 — every outcome of the "Just shipped" verdict, the red ones first.
//   node scripts/test-featured-verdict.mjs
import { featuredVerdict, releaseTag, OK, STALE, PENDING, FOREIGN } from "./featured-verdict.mjs";

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { console.log(`  ✗ ${name}\n      ${String(e.message).split("\n").join("\n      ")}`); failures++; }
};
const eq = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}\n  expected: ${JSON.stringify(b)}\n  actual:   ${JSON.stringify(a)}`); };

const own = new Set(["@broberg/bodymap", "@broberg/app-shell"]);
// Fixture shaped on run 40549835500 (27 Oct, started 17:21:39Z).
const card = { pkg: "@broberg/app-shell", version: "0.26.0" };
const newest = { pkg: "@broberg/bodymap", version: "0.13.3" };
const runStartedAt = "2026-10-27T17:21:39Z";

console.log("featured-verdict");

check("RED replay: ours, publish FINISHED BEFORE this run started → stale (1)", () => {
  const v = featuredVerdict({ card, newest, own, runStartedAt, laterRuns: [], publishRuns: [{ status: "completed", updated_at: "2026-10-27T17:10:00Z" }] });
  eq(v.code, STALE, "a genuinely stale card stays red");
});

check("RED: GitHub could not be asked → stale (1), never pending", () => {
  const v = featuredVerdict({ card, newest, own, runStartedAt, githubError: "HTTP 403" });
  eq(v.code, STALE, "an unanswered question is not evidence");
  if (!/could not ask GitHub/.test(v.message)) throw new Error(v.message);
});

check("RED: no publish run found for the tag → stale (1)", () => {
  eq(featuredVerdict({ card, newest, own, runStartedAt, publishRuns: [], laterRuns: [] }).code, STALE, "no evidence");
});

check("PENDING: ours, publish finished AFTER this run started (the real 25 Oct ui-controls-core case) → 3, names package + version", () => {
  const v = featuredVerdict({ card, newest, own, runStartedAt, laterRuns: [], publishRuns: [{ status: "completed", updated_at: "2026-10-27T17:22:06Z", html_url: "u" }] });
  eq(v.code, PENDING, "pending");
  if (!v.message.includes("@broberg/bodymap@0.13.3")) throw new Error(v.message);
});

check("PENDING: ours, publish still running → 3", () => {
  eq(featuredVerdict({ card, newest, own, runStartedAt, laterRuns: [], publishRuns: [{ status: "in_progress", updated_at: "2026-10-27T17:20:00Z" }] }).code, PENDING, "in flight");
});

check("PENDING: a LATER discovery run exists (the real 27 Oct bodymap case: publish finished 17:21:37, before this run) → 3", () => {
  const v = featuredVerdict({ card, newest, own, runStartedAt, publishRuns: [{ status: "completed", updated_at: "2026-10-27T17:21:37Z" }],
    laterRuns: [{ id: 2, event: "push", created_at: "2026-10-27T17:24:00Z" }] });
  eq(v.code, PENDING, "superseded by a later run");
  if (!/later discovery run/.test(v.message)) throw new Error(v.message);
});

check("RED: the later-runs question was not answered → stale, never pending", () => {
  eq(featuredVerdict({ card, newest, own, runStartedAt, publishRuns: [] }).code, STALE, "missing laterRuns is not evidence");
});

check("FOREIGN: published from another repo (the 30 Oct ai-sdk case) → 4, never silent", () => {
  const v = featuredVerdict({ card, newest: { pkg: "@broberg/ai-sdk", version: "0.69.1" }, own, runStartedAt });
  eq(v.code, FOREIGN, "foreign");
  if (!/another repo/.test(v.message)) throw new Error(v.message);
});

check("OK: the card names the newest → 0", () => {
  eq(featuredVerdict({ card: newest, newest, own }).code, OK, "ok");
});

check("the release tag is publish.yml's <short>-v<version>", () => {
  eq(releaseTag("@broberg/bodymap", "0.13.3"), "bodymap-v0.13.3", "tag");
});

console.log(failures ? `\n${failures} FAILED` : "\nall green");
process.exit(failures ? 1 : 0);
