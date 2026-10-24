#!/usr/bin/env node
// F103.1 — mutation pass for @broberg/realtime (two source files).
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
// Mutations must produce DIFFERENT red sets. If two matched, one test would be
// carrying both claims and neither would be pinned on its own.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// F081.1 — announce the mutated tree, and PROVE the restore took.
import { writeMarker, clearMarker, assertRestored } from "../../../scripts/mutation-marker.mjs";

const REPO = execFileSync("git", ["rev-parse", "--show-toplevel"]).toString().trim();
const PKG = join(REPO, "packages", "realtime");
const SERVER = join(PKG, "src", "server.ts");
const CLIENT = join(PKG, "src", "client.ts");
const originals = { [SERVER]: readFileSync(SERVER, "utf8"), [CLIENT]: readFileSync(CLIENT, "utf8") };

const MUTATIONS = [
  {
    name: "a closed stream keeps its listener (they pile up in the process)",
    file: SERVER,
    find: "            clearInterval(beat);\n            removeListener();",
    replace: "            clearInterval(beat);",
    expect: ["leaves no listener behind"],
  },
  {
    name: "no heartbeat",
    file: SERVER,
    find: "const beat = setInterval(() => write(frame({ type: PING })), heartbeatMs);",
    replace: "const beat = setInterval(() => {}, heartbeatMs);",
    expect: ["a visible $ping every heartbeatMs"],
  },
  {
    name: "live events are sent DURING the replay (order and duplicates break)",
    file: SERVER,
    find: "(e) => (replaying ? buffered.push(e) : send(e))",
    replace: "(e) => send(e)",
    expect: ["comes AFTER the replayed ones"],
  },
  {
    name: "an id already replayed is sent again from the buffer",
    file: SERVER,
    find: "if (!(e.id && replayedIds.has(e.id))) send(e);",
    replace: "send(e);",
    expect: ["BOTH replayed and published during the replay arrives exactly once"],
  },
  {
    name: "ephemeral events get an id line",
    file: SERVER,
    find: "${e.id ? `id: ${e.id}\\n` : \"\"}data:",
    replace: "id: ${e.id ?? \"x\"}\\ndata:",
    expect: ["an ephemeral one does not"],
  },
  {
    name: "a newline in an event type is accepted (frame injection)",
    file: SERVER,
    find: "|| /[\\r\\n]/.test(e.type)) throw",
    replace: ") throw",
    expect: ["refuses a $-type"],
  },
  {
    name: "the NOTIFY limit is not checked",
    file: SERVER,
    find: "      if (bytes > NOTIFY_MAX_BYTES) {",
    replace: "      if (false) {",
    expect: ["over the NOTIFY limit is refused"],
  },
  {
    name: "a failed LISTEN is left unhandled",
    file: SERVER,
    find: "        listening = null;\n        onError(err);",
    replace: "        listening = null;\n        throw err;",
    expect: ["reported through onError"],
  },
  {
    name: "a publish is also delivered locally besides the bus (twice on its own hub)",
    file: SERVER,
    find: "      await bus.publish({ channel, event });\n    },\n\n    stream(",
    replace: "      deliver(channel, event);\n      await bus.publish({ channel, event });\n    },\n\n    stream(",
    expect: ["A's own stream gets it exactly once"],
  },
  {
    name: "every touch announces a join",
    file: SERVER,
    find: "    if (!existing) deliver(channel, { type: PRESENCE, data: { action: \"join\", member: data.member } });",
    replace: "    deliver(channel, { type: PRESENCE, data: { action: \"join\", member: data.member } });",
    expect: ["ONE join (not one per touch)"],
  },
  {
    name: "a touch does not refresh the expiry",
    file: SERVER,
    find: "    if (existing) clearTimeout(existing.timer);\n    m.set(",
    replace: "    if (existing) return;\n    m.set(",
    expect: ["a touch REFRESHES the expiry"],
  },
  {
    name: "the client delivers the same id twice",
    file: CLIENT,
    find: "        if (seenData.get(id) === ev.data) return; // a replay overlapping what we had",
    replace: "        if (false) return; // a replay overlapping what we had",
    expect: ["never delivers the same id twice"],
  },
  {
    name: "F103.3 an inherited id is dropped again (the 0.1.2 behaviour jam measured)",
    file: CLIENT,
    find: "        id = undefined; // inherited: deliver it as the id-less event it is",
    replace: "        return;",
    expect: ["is delivered (without an id), and lastEventId stays on the real one"],
  },
  {
    name: "the client reopens without asking for what it missed",
    file: CLIENT,
    find: "const target = lastEventId ? `${url}${url.includes(\"?\") ? \"&\" : \"?\"}lastEventId=${encodeURIComponent(lastEventId)}` : url;",
    replace: "const target = url;",
    expect: ["REOPENS with ?lastEventId="],
  },
  {
    name: "visible again always reopens (even a fresh stream)",
    file: CLIENT,
    find: "    if (doc.visibilityState === \"visible\" && isStale()) open(\"reconnecting\");",
    replace: "    if (doc.visibilityState === \"visible\") open(\"reconnecting\");",
    expect: ["does NOT reopen"],
  },
  {
    name: "no reopen when the browser gave up",
    file: CLIENT,
    find: "      if (source.readyState === CLOSED) scheduleReopen();",
    replace: "",
    expect: ["reopened after a backoff"],
  },
  {
    name: "no watchdog",
    file: CLIENT,
    find: "    if (!closed && now() - lastSeen > staleMs) open(\"reconnecting\");",
    replace: "",
    expect: ["reopened by the watchdog"],
  },
  {
    name: "the outbox resurrects an item the echo already removed",
    file: CLIENT,
    find: "        if (!cur) return; // already reconciled",
    replace: "        if (!cur) { items.set(clientId, { clientId, payload: undefined as T, state: \"sent\" }); emit(); return; } // already reconciled",
    expect: ["not resurrected"],
  },
  {
    name: "a failed POST stays pending forever",
    file: CLIENT,
    find: "        cur.state = \"failed\";",
    replace: "        cur.state = \"pending\";",
    expect: ["visible as failed"],
  },
  {
    name: "typing is sent on every keystroke",
    file: CLIENT,
    find: "      if (now() - last >= interval) {",
    replace: "      if (true) {",
    expect: ["at most one 'typing' per interval"],
  },
];

const backup = mkdtempSync(join(tmpdir(), "rtmut-"));
for (const f of Object.keys(originals)) copyFileSync(f, join(backup, f.split("/").pop()));

let uncaught = 0;
const redSets = [];

// BEFORE the first mutation. Written after it, the marker would leave open the
// exact window it exists to close.
writeMarker({ harness: "@broberg/realtime test/mutations.mjs", file: SERVER });
try {
  for (const m of MUTATIONS) {
    for (const [f, text] of Object.entries(originals)) writeFileSync(f, text);
    const original = originals[m.file];
    if (!original.includes(m.find)) {
      console.log(`ANCHOR MISSING — ${m.name}\n  the substitution matched nothing, so this mutation was never applied`);
      uncaught++;
      continue;
    }
    const mutated = original.replace(m.find, m.replace);
    if (mutated === original) { console.log(`ANCHOR NO-OP — ${m.name}`); uncaught++; continue; }

    writeFileSync(m.file, mutated);
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
  for (const f of Object.keys(originals)) copyFileSync(join(backup, f.split("/").pop()), f);
  // The guard. A restore that FAILED is otherwise indistinguishable from one
  // that was not needed — which is how buddy's harness lost a file on
  // 2026-08-14 with a green run to show for it. Does not return on mismatch.
  for (const [f, text] of Object.entries(originals)) assertRestored({ harness: "@broberg/realtime test/mutations.mjs", file: f, expected: text });
  rmSync(backup, { recursive: true, force: true });
  clearMarker();
}

const identical = redSets.length !== new Set(redSets).size;
if (identical) console.log("\nWARNING: two mutations produced IDENTICAL red sets — one test may be carrying both");
console.log(`\n${MUTATIONS.length} mutations, ${uncaught} uncaught, ${identical ? 1 : 0} identical red sets`);
process.exit(uncaught === 0 && !identical ? 0 : 1);
