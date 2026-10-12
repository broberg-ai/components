#!/usr/bin/env node
// F038.26 — the three doors, with an injected ticket fetch (no network).
//   node scripts/test-discovery-auth.mjs
import { discoveryAuth } from "./discovery-auth.mjs";

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`);
};
const OIDC = { ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.actions" };
const KEYS = { DISCOVERY_SESSION: "components", DISCOVERY_KEY: "k" };
const ok = async () => "T";
const refused = async () => { throw new Error("no rule for this workflow"); };

check("ticket when the job has an id-token", await discoveryAuth({ env: { ...OIDC, ...KEYS }, getTicket: ok }),
  { door: "ticket", init: { headers: { authorization: "Bearer T" } } });
check("key when the ticket is refused, and says why", await discoveryAuth({ env: { ...OIDC, ...KEYS }, getTicket: refused }),
  { door: "key", init: { headers: { "x-discovery-session": "components", "x-enroll-key": "k" } }, note: "ticket refused, falling back: no rule for this workflow" });
check("key when there is no id-token at all (the ticket is never tried)", await discoveryAuth({ env: { ...KEYS }, getTicket: ok }),
  { door: "key", init: { headers: { "x-discovery-session": "components", "x-enroll-key": "k" } } });
check("none when neither", await discoveryAuth({ env: {}, getTicket: ok }), { door: "none", init: {} });

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log("\nall passed");
